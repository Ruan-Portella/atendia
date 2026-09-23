import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORS_HEADERS, type BotRow } from "@/lib/chat";
import { notifyLead } from "@/lib/notify";
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
  const { data: lead } = await db
    .from("leads")
    .insert({ bot_id: bot.id, conversation_id: conversationId, name: d.name, phone: d.phone ?? null, email: d.email ?? null, notes: d.notes ?? null })
    .select("id")
    .single();
  notifyLead({ db, bot, lead: { id: lead?.id, nome: d.name, whatsapp: d.phone, email: d.email, interesse: d.notes } }).catch(() => {});
  return Response.json({ ok: true }, { headers: CORS_HEADERS });
}
