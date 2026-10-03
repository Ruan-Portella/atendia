import { z } from "zod";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CORS_HEADERS, SYSTEM_AUTHOR, openConversation, requestHandoff, type BotRow } from "@/lib/chat";
import { SUSPENDED_NOTICE, resolveMode } from "@/lib/conversation-mode";
import { saveMessage } from "@/lib/messages";
import { logWidgetAccess } from "@/lib/access-log";
import { clientIp, firstExceeded, hashId, tooMany } from "@/lib/rate-limit";
import { isResumable } from "@/lib/presence";

/** Fala do visitante que fica na conversa quando ele usa o botão. */
const HANDOFF_BUTTON_TEXT = "Quero falar com uma pessoa";

const bodySchema = z.object({
  key: z.string().min(8),
  conversationId: z.string().uuid().nullable().optional(),
  visitorId: z.string().max(80).nullable().optional(),
  channel: z.enum(["widget", "demo", "painel"]).default("widget"),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Botão "Falar com uma pessoa" do chat do site: pede atendente sem passar pela IA (não conta
 * atendimento). Grava a fala do visitante e o aviso, marca a conversa e avisa a equipe, como a
 * ferramenta chamar_atendente faz quando o visitante escreve o pedido.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400, headers: CORS_HEADERS });
  const { key, conversationId, visitorId } = parsed.data;

  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("public_key", key).maybeSingle<BotRow>();
  if (!bot) return Response.json({ error: "bot_not_found" }, { status: 404, headers: CORS_HEADERS });
  let channel = parsed.data.channel;
  if (channel === "painel") {
    const { data: own } = await (await createClient()).from("bots").select("id").eq("id", bot.id).maybeSingle();
    if (!own) channel = "widget";
  }
  if (bot.status !== "live" && !bot.is_demo && channel !== "painel") return Response.json({ error: "bot_offline" }, { status: 403, headers: CORS_HEADERS });

  const ip = hashId(clientIp(req));
  const exceeded = await firstExceeded(db, [{ key: `chat:${bot.id}:ip:${ip}:handoff`, max: 5, windowSeconds: 3600, message: "Você já pediu atendimento. A equipe responde por aqui assim que possível." }]);
  if (exceeded) return tooMany(exceeded, CORS_HEADERS);

  // só continua uma conversa deste bot e do mesmo visitante; senão, abre outra (sem IA, não conta atendimento)
  let convId: string | null = null;
  if (conversationId) {
    const { data } = await db.from("conversations").select("id, visitor_id, last_message_at, takeover_at, handled_at").eq("id", conversationId).eq("bot_id", bot.id).maybeSingle();
    if (data && data.visitor_id === (visitorId ?? null) && isResumable(data.last_message_at)) convId = data.id;
  }
  const mode = await resolveMode(db, { bot, channel: "widget", conversation: null });
  if (mode.step === 2) return Response.json({ error: "channel_suspended", message: SUSPENDED_NOTICE }, { status: 403, headers: CORS_HEADERS });

  try {
    convId ??= await openConversation(db, bot, { channel: bot.is_demo ? "demo" : channel, visitorId: visitorId ?? null });
  } catch {
    return Response.json({ error: "chat_failed", fallback: "contact", message: "No momento não consigo responder por aqui. Deixe seu contato que a equipe retorna em breve." }, { status: 402, headers: CORS_HEADERS });
  }
  await saveMessage(db, { conversation_id: convId, role: "user", content: HANDOFF_BUTTON_TEXT }, { touch: "visitante" });
  const notice = await requestHandoff(db, bot, convId, "pediu pelo botão do chat do site");
  await saveMessage(db, { conversation_id: convId, role: "assistant", content: notice, author: SYSTEM_AUTHOR }, { touch: "visitante" });
  const active = convId;
  if (channel !== "painel") after(() => logWidgetAccess(db, { botId: bot.id, conversationId: active, ip: clientIp(req), isNew: !conversationId }));
  return Response.json({ conversationId: convId, userText: HANDOFF_BUTTON_TEXT, notice }, { headers: CORS_HEADERS });
}
