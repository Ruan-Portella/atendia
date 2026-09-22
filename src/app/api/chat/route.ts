import { z } from "zod";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORS_HEADERS, lastUserText, runChat, type BotRow } from "@/lib/chat";
import { clientIp, firstExceeded, hashId, tooMany } from "@/lib/rate-limit";

const MAX_MESSAGE_CHARS = 2000;

export const maxDuration = 60;

const bodySchema = z.object({
  key: z.string().min(8),
  conversationId: z.string().uuid().nullable().optional(),
  visitorId: z.string().max(80).nullable().optional(),
  channel: z.enum(["widget", "demo", "painel"]).default("widget"),
  messages: z.array(z.any()).min(1).max(200),
});

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
  const { key, conversationId, visitorId, channel, messages } = parsed.data;

  if (lastUserText(messages as UIMessage[]).length > MAX_MESSAGE_CHARS) {
    return Response.json({ error: "message_too_long", message: `Mensagem muito longa. Resuma em até ${MAX_MESSAGE_CHARS} caracteres.` }, { status: 413, headers: CORS_HEADERS });
  }

  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("public_key", key).maybeSingle<BotRow>();
  if (!bot) return Response.json({ error: "bot_not_found" }, { status: 404, headers: CORS_HEADERS });
  if (bot.status !== "live" && !bot.is_demo && channel !== "painel") {
    return Response.json({ error: "bot_offline", message: "Este assistente ainda não foi publicado." }, { status: 403, headers: CORS_HEADERS });
  }

  // Só continua uma conversa que seja deste bot; qualquer outro id vira conversa nova.
  let convId = conversationId ?? null;
  let handoff: "requested" | "agent" | null = null;
  if (convId) {
    const { data: conv } = await db.from("conversations").select("id, handoff_requested_at, takeover_at, handled_at").eq("id", convId).eq("bot_id", bot.id).maybeSingle();
    if (!conv) convId = null;
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
    const text = lastUserText(messages as UIMessage[]);
    if (text) await db.from("messages").insert({ conversation_id: convId, role: "user", content: text });
    const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", convId);
    await db.from("conversations").update({ last_message_at: new Date().toISOString(), message_count: count ?? 0 }).eq("id", convId);
    return createUIMessageStreamResponse({
      stream: createUIMessageStream({ execute: () => {} }),
      headers: { ...CORS_HEADERS, "X-Conversation-Id": convId, "X-Handoff": "agent", "Access-Control-Expose-Headers": "X-Conversation-Id, X-Handoff" },
    });
  }

  try {
    const { result, conversationId: activeId } = await runChat({
      db,
      bot,
      messages: messages as UIMessage[],
      conversationId: convId,
      visitorId: visitorId ?? null,
      channel: bot.is_demo ? "demo" : channel,
    });
    return result.toUIMessageStreamResponse({
      headers: { ...CORS_HEADERS, "X-Conversation-Id": activeId, ...(handoff ? { "X-Handoff": handoff } : {}), "Access-Control-Expose-Headers": "X-Conversation-Id, X-Handoff" },
      onError: (e) => (e instanceof Error ? e.message : "erro"),
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "quota_exceeded") return Response.json({ error: msg, message: "Limite de conversas do plano atingido." }, { status: 402, headers: CORS_HEADERS });
    if (msg === "trial_expired") return Response.json({ error: msg, message: "Período de teste encerrado." }, { status: 402, headers: CORS_HEADERS });
    console.error(e);
    return Response.json({ error: "chat_failed", message: "Não consegui responder agora. Tente de novo em instantes." }, { status: 500, headers: CORS_HEADERS });
  }
}
