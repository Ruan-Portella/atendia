import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUSPENDED_NOTICE, isChannelSuspended } from "@/lib/conversation-mode";
import { typedPhoneHash } from "@/lib/contacts";
import { CORS_HEADERS, type BotRow } from "@/lib/chat";
import { notifyLead } from "@/lib/notify";
import { createLead } from "@/lib/leads";
import { clientIp, firstExceeded, hashId, tooMany } from "@/lib/rate-limit";

/** Formulário de contato dentro do widget (quando o visitante prefere preencher em vez de conversar). */
const schema = z.object({
  key: z.string().min(8),
  conversationId: z.string().uuid().nullable().optional(),
  name: z.string().min(2).max(80),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional(),
  notes: z.string().max(500).optional(),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body", message: "Confira o nome (pelo menos 2 letras) e o WhatsApp ou e-mail." }, { status: 400, headers: CORS_HEADERS });
  const d = parsed.data;
  if (!d.phone && !d.email) return Response.json({ error: "contact_required", message: "Informe WhatsApp ou e-mail." }, { status: 400, headers: CORS_HEADERS });

  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("public_key", d.key).maybeSingle<BotRow>();
  if (!bot) return Response.json({ error: "bot_not_found" }, { status: 404, headers: CORS_HEADERS });
  // canal suspenso pela BoaVoz (regra de estado, degrau 2): nem o formulário recebe contato
  if (await isChannelSuspended(db, bot, "widget")) return Response.json({ error: "channel_suspended", message: SUSPENDED_NOTICE }, { status: 403, headers: CORS_HEADERS });
  const exceeded = await firstExceeded(db, [
    { key: `lead:${bot.id}:ip:${hashId(clientIp(req))}`, max: 5, windowSeconds: 3600, message: "Recebemos vários contatos seus agora. Nossa equipe já vai retornar." },
  ]);
  if (exceeded) return tooMany(exceeded, CORS_HEADERS);

  // só vincula a uma conversa que seja deste bot
  let conversationId = d.conversationId ?? null;
  if (conversationId) {
    const { data: conv } = await db.from("conversations").select("id").eq("id", conversationId).eq("bot_id", bot.id).maybeSingle();
    if (!conv) conversationId = null;
  }
  const leadId = await createLead(db, { botId: bot.id, conversationId, name: d.name, phone: d.phone, phoneHash: typedPhoneHash(d.phone), email: d.email, notes: d.notes });
  notifyLead({ db, bot, lead: { id: leadId ?? undefined, nome: d.name }, channel: "widget", conversationId }).catch(() => {});
  return Response.json({ ok: true }, { headers: CORS_HEADERS });
}
