import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORS_HEADERS, type BotRow } from "@/lib/chat";
import { notifyLead } from "@/lib/notify";

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
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400, headers: CORS_HEADERS });
  const d = parsed.data;
  if (!d.phone && !d.email) return Response.json({ error: "contact_required", message: "Informe WhatsApp ou e-mail." }, { status: 400, headers: CORS_HEADERS });

  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("public_key", d.key).maybeSingle<BotRow>();
  if (!bot) return Response.json({ error: "bot_not_found" }, { status: 404, headers: CORS_HEADERS });

  const { data: lead } = await db
    .from("leads")
    .insert({ bot_id: bot.id, conversation_id: d.conversationId ?? null, name: d.name, phone: d.phone ?? null, email: d.email ?? null, notes: d.notes ?? null })
    .select("id")
    .single();
  notifyLead({ db, bot, lead: { id: lead?.id, nome: d.name, whatsapp: d.phone, email: d.email, interesse: d.notes } }).catch(() => {});
  return Response.json({ ok: true }, { headers: CORS_HEADERS });
}
