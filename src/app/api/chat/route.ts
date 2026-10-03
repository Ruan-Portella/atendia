import { z } from "zod";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CORS_HEADERS, conversationHistory, lastUserText, runChat, withoutToolParts, type BotRow } from "@/lib/chat";
import { SUSPENDED_NOTICE, resolveMode } from "@/lib/conversation-mode";
import { logWidgetAccess } from "@/lib/access-log";
import { clientIp, firstExceeded, hashId, tooMany } from "@/lib/rate-limit";
import { isResumable } from "@/lib/presence";
import { openAtendimento } from "@/lib/atendimentos";
import { saveMessage } from "@/lib/messages";

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
  let conv: { id: string; takeover_at: string | null; handled_at: string | null } | null = null;
  if (convId) {
    const { data } = await db.from("conversations").select("id, visitor_id, handoff_requested_at, takeover_at, handled_at, last_message_at").eq("id", convId).eq("bot_id", bot.id).maybeSingle();
    // outra conversa ou parada há horas: começa uma nova
    if (!data || data.visitor_id !== (visitorId ?? null) || !isResumable(data.last_message_at)) convId = null;
    else {
      conv = data;
      if (!data.handled_at) handoff = data.takeover_at ? "agent" : data.handoff_requested_at ? "requested" : null;
    }
  }

  const ip = hashId(clientIp(req));
  const exceeded = await firstExceeded(db, [
    { key: `chat:${bot.id}:ip:${ip}:m`, max: 15, windowSeconds: 60, message: "Você está mandando mensagens rápido demais. Espere um minutinho." },
    { key: `chat:${bot.id}:ip:${ip}:d`, max: 300, windowSeconds: 86400, message: "Limite de mensagens por hoje atingido. Tente de novo amanhã." },
    ...(convId
      ? []
      : [
          { key: `chat:${bot.id}:ip:${ip}:conv`, max: 10, windowSeconds: 3600, message: "Muitas conversas novas em pouco tempo. Tente de novo mais tarde." },
          // 30 conversas novas por dia por IP e bot: quem tenta esgotar a cota da agência pelo site
          { key: `chat:${bot.id}:ip:${ip}:convd`, max: 30, windowSeconds: 86400, message: "Muitas conversas novas hoje. Tente de novo amanhã." },
        ]),
  ]);
  if (exceeded) return tooMany(exceeded, CORS_HEADERS);

  // regra única de estado (conversation-mode): suspensão, equipe na conversa, pausa e modo só humano
  const mode = await resolveMode(db, { bot, channel: "widget", conversation: conv });
  if (mode.step === 2) return Response.json({ error: "channel_suspended", message: SUSPENDED_NOTICE }, { status: 403, headers: CORS_HEADERS });

  // Uma pessoa da agência assumiu: o assistente fica quieto; a mensagem vai para o painel
  // e a resposta chega ao widget por /api/chat/updates.
  if (convId && mode.step === 3) {
    const activeConv = convId;
    if (channel !== "painel") after(() => logWidgetAccess(db, { botId: bot.id, conversationId: activeConv, ip: clientIp(req), isNew: false }));
    await saveMessage(db, { conversation_id: convId, role: "user", content: text }, { touch: "visitante" });
    return createUIMessageStreamResponse({
      stream: createUIMessageStream({ execute: () => {} }),
      headers: { ...CORS_HEADERS, "X-Conversation-Id": convId, "X-Handoff": "agent", "Access-Control-Expose-Headers": "X-Conversation-Id, X-Handoff" },
    });
  }

  // bot pausado pelo dono, IA pausada pelo backoffice, plano, teste ou cota: o widget mostra o
  // formulário de contato (o lead não se perde)
  if (mode.handoff) {
    const reason = mode.blockReason ?? "paused";
    return contactFallback(reason === "paused" ? "ai_paused" : reason, reason === "paused" || reason === "bot_paused" ? 503 : 402);
  }

  // cota do mês: o atendimento deste visitante (24 horas) abre antes de chamar a IA; o teste ao
  // vivo do painel e as demos não contam. Sem vaga: formulário de contato
  const slot = channel === "widget" && !bot.is_demo ? await openAtendimento(db, bot, { channel: "widget", contactKey: visitorId ?? convId ?? crypto.randomUUID(), conversationId: convId }) : null;
  if (slot?.blocked) return contactFallback(slot.blocked, 402);

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
    // registro de acesso do visitante (Marco Civil): IP quando a conversa começa e quando muda;
    // o teste ao vivo do painel já fica no registro de acesso do painel
    if (channel !== "painel") after(() => logWidgetAccess(db, { botId: bot.id, conversationId: activeId, ip: clientIp(req), isNew: !convId }));
    // atendimento aberto antes da conversa existir: liga a primeira conversa a ele
    if (slot?.isNew && slot.id && !convId) after(async () => void (await db.from("atendimentos").update({ first_conversation_id: activeId }).eq("id", slot.id)));
    return createUIMessageStreamResponse({
      stream: result.toUIMessageStream({ onError: () => "erro" }).pipeThrough(withoutToolParts()),
      headers: { ...CORS_HEADERS, "X-Conversation-Id": activeId, ...(handoff ? { "X-Handoff": handoff } : {}), "Access-Control-Expose-Headers": "X-Conversation-Id, X-Handoff" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    // Sem cota, teste vencido ou falha do provedor de IA: o visitante nunca vê erro técnico nem
    // assunto de plano. O widget troca o chat por um formulário de contato (o lead não se perde).
    if (msg === "trial_expired") return contactFallback(msg, 402);
    console.error(e);
    return contactFallback("chat_failed", 503);
  }
}
