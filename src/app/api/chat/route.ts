import { z } from "zod";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CORS_HEADERS, conversationHistory, lastUserText, runChat, withoutToolParts, type BotRow } from "@/lib/chat";
import { isAiPaused } from "@/lib/ai-pause";
import { clientIp, firstExceeded, hashId, tooMany } from "@/lib/rate-limit";
import { isResumable } from "@/lib/presence";

const MAX_MESSAGE_CHARS = 2000;

export const maxDuration = 60;

const bodySchema = z.object({
  key: z.string().min(8),
  conversationId: z.string().uuid().nullable().optional(),
  visitorId: z.string().max(80).nullable().optional(),
  channel: z.enum(["widget", "demo", "painel"]).default("widget"),
  /** Só o texto novo; o histórico vem do banco. */
  text: z.string().optional(),
  /** Formato antigo (aba aberta antes da atualização): só a última fala do visitante é usada. */
  messages: z.array(z.any()).max(200).optional(),
});

const FALLBACK_MESSAGE = "No momento não consigo responder por aqui. Deixe seu contato que a equipe retorna em breve.";
const contactFallback = (error: string, status: number) => Response.json({ error, fallback: "contact", message: FALLBACK_MESSAGE }, { status, headers: CORS_HEADERS });

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Chat público do widget e da demo. Autenticação = chave pública do bot.
 * Limites por IP (mensagens e conversas novas) protegem a cota mensal da agência de quem
 * tentar esgotá-la de propósito a partir do site do cliente.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400, headers: CORS_HEADERS });
  const { key, conversationId, visitorId, messages } = parsed.data;
  const text = (parsed.data.text ?? lastUserText((messages ?? []) as UIMessage[])).trim();
  if (!text) return Response.json({ error: "invalid_body" }, { status: 400, headers: CORS_HEADERS });
  if (text.length > MAX_MESSAGE_CHARS) {
    return Response.json({ error: "message_too_long", message: `Mensagem muito longa. Resuma em até ${MAX_MESSAGE_CHARS} caracteres.` }, { status: 413, headers: CORS_HEADERS });
  }

  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("public_key", key).maybeSingle<BotRow>();
  if (!bot) return Response.json({ error: "bot_not_found" }, { status: 404, headers: CORS_HEADERS });
  // "painel" (teste ao vivo, funciona com o bot em rascunho) só com sessão de quem enxerga o bot
  let channel = parsed.data.channel;
  if (channel === "painel") {
    const { data: own } = await (await createClient()).from("bots").select("id").eq("id", bot.id).maybeSingle();
    if (!own) channel = "widget";
  }
  if (bot.status !== "live" && !bot.is_demo && channel !== "painel") {
    return Response.json({ error: "bot_offline", message: "Este assistente ainda não foi publicado." }, { status: 403, headers: CORS_HEADERS });
  }

  // Só continua uma conversa deste bot e do mesmo visitante; qualquer outro id vira conversa nova.
  let convId = conversationId ?? null;
  let handoff: "requested" | "agent" | null = null;
  if (convId) {
    const { data: conv } = await db.from("conversations").select("id, visitor_id, handoff_requested_at, takeover_at, handled_at, last_message_at").eq("id", convId).eq("bot_id", bot.id).maybeSingle();
    // outra conversa ou parada há horas: começa uma nova
    if (!conv || conv.visitor_id !== (visitorId ?? null) || !isResumable(conv.last_message_at)) convId = null;
    else if (!conv.handled_at) handoff = conv.takeover_at ? "agent" : conv.handoff_requested_at ? "requested" : null;
  }

  const ip = hashId(clientIp(req));
  const exceeded = await firstExceeded(db, [
    { key: `chat:${bot.id}:ip:${ip}:m`, max: 15, windowSeconds: 60, message: "Você está mandando mensagens rápido demais. Espere um minutinho." },
    { key: `chat:${bot.id}:ip:${ip}:d`, max: 300, windowSeconds: 86400, message: "Limite de mensagens por hoje atingido. Tente de novo amanhã." },
    ...(convId ? [] : [{ key: `chat:${bot.id}:ip:${ip}:conv`, max: 10, windowSeconds: 3600, message: "Muitas conversas novas em pouco tempo. Tente de novo mais tarde." }]),
  ]);
  if (exceeded) return tooMany(exceeded, CORS_HEADERS);

  // Uma pessoa da agência assumiu: o assistente fica quieto; a mensagem vai para o painel
  // e a resposta chega ao widget por /api/chat/updates.
  if (convId && handoff === "agent") {
    await db.from("messages").insert({ conversation_id: convId, role: "user", content: text });
    const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", convId);
    const now = new Date().toISOString();
    await db.from("conversations").update({ last_message_at: now, visitor_seen_at: now, message_count: count ?? 0 }).eq("id", convId);
    return createUIMessageStreamResponse({
      stream: createUIMessageStream({ execute: () => {} }),
      headers: { ...CORS_HEADERS, "X-Conversation-Id": convId, "X-Handoff": "agent", "Access-Control-Expose-Headers": "X-Conversation-Id, X-Handoff" },
    });
  }

  // IA pausada pelo backoffice (esta agência ou a chave geral): o widget mostra o formulário de contato
  if (await isAiPaused(db, bot.agency_id)) return contactFallback("ai_paused", 503);

  try {
    const history = convId ? await conversationHistory(db, convId, 11, MAX_MESSAGE_CHARS) : [];
    const { result, conversationId: activeId } = await runChat({
      db,
      bot,
      messages: [...history, { id: "novo", role: "user", parts: [{ type: "text", text }] }],
      conversationId: convId,
      visitorId: visitorId ?? null,
      channel: bot.is_demo ? "demo" : channel,
    });
    return createUIMessageStreamResponse({
      stream: result.toUIMessageStream({ onError: () => "erro" }).pipeThrough(withoutToolParts()),
      headers: { ...CORS_HEADERS, "X-Conversation-Id": activeId, ...(handoff ? { "X-Handoff": handoff } : {}), "Access-Control-Expose-Headers": "X-Conversation-Id, X-Handoff" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    // Sem cota, teste vencido ou falha do provedor de IA: o visitante nunca vê erro técnico nem
    // assunto de plano. O widget troca o chat por um formulário de contato (o lead não se perde).
    if (msg === "quota_exceeded" || msg === "trial_expired") return contactFallback(msg, 402);
    console.error(e);
    return contactFallback("chat_failed", 503);
  }
}
