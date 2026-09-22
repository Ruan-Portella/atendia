import { z } from "zod";
import type { UIMessage } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORS_HEADERS, runChat, type BotRow } from "@/lib/chat";

export const maxDuration = 60;

const bodySchema = z.object({
  key: z.string().min(8),
  conversationId: z.string().uuid().nullable().optional(),
  visitorId: z.string().max(80).nullable().optional(),
  channel: z.enum(["widget", "demo", "painel"]).default("widget"),
  messages: z.array(z.any()).min(1),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Chat público do widget e da demo. Autenticação = chave pública do bot. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400, headers: CORS_HEADERS });
  const { key, conversationId, visitorId, channel, messages } = parsed.data;

  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("public_key", key).maybeSingle<BotRow>();
  if (!bot) return Response.json({ error: "bot_not_found" }, { status: 404, headers: CORS_HEADERS });
  if (bot.status !== "live" && !bot.is_demo && channel !== "painel") {
    return Response.json({ error: "bot_offline", message: "Este assistente ainda não foi publicado." }, { status: 403, headers: CORS_HEADERS });
  }

  try {
    const { result, conversationId: convId } = await runChat({
      db,
      bot,
      messages: messages as UIMessage[],
      conversationId: conversationId ?? null,
      visitorId: visitorId ?? null,
      channel: bot.is_demo ? "demo" : channel,
    });
    return result.toUIMessageStreamResponse({
      headers: { ...CORS_HEADERS, "X-Conversation-Id": convId, "Access-Control-Expose-Headers": "X-Conversation-Id" },
      onError: (e) => (e instanceof Error ? e.message : "erro"),
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "quota_exceeded") return Response.json({ error: msg, message: "Limite de conversas do plano atingido." }, { status: 402, headers: CORS_HEADERS });
    if (msg === "trial_expired") return Response.json({ error: msg, message: "Período de teste encerrado." }, { status: 402, headers: CORS_HEADERS });
    console.error(e);
    return Response.json({ error: "chat_failed", message: msg }, { status: 500, headers: CORS_HEADERS });
  }
}
