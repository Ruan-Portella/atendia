import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotRow } from "./chat";

/**
 * Avisa a agência (e opcionalmente o cliente final) de um lead novo.
 * V1: e-mail via Resend quando configurado. WhatsApp entra na V2 (API oficial da Meta).
 */
export async function notifyLead(opts: {
  db: SupabaseClient;
  bot: BotRow;
  lead: { id?: string; nome: string; whatsapp?: string; email?: string; interesse?: string };
}) {
  const { db, bot, lead } = opts;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const { data: agency } = await db.from("agencies").select("name, owner_id").eq("id", bot.agency_id).single();
  const { data: owner } = agency ? await db.auth.admin.getUserById(agency.owner_id) : { data: null };
  const to = [bot.lead_capture?.notify_email, owner?.user?.email].filter((x): x is string => Boolean(x));
  if (!to.length) return;

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "Atendia <onboarding@resend.dev>",
    to,
    subject: `Novo lead no chatbot de ${bot.client_name}: ${lead.nome}`,
    text: [
      `O assistente ${bot.name} (${bot.client_name}) capturou um contato.`,
      ``,
      `Nome: ${lead.nome}`,
      lead.whatsapp ? `WhatsApp: ${lead.whatsapp}` : null,
      lead.email ? `E-mail: ${lead.email}` : null,
      lead.interesse ? `Interesse: ${lead.interesse}` : null,
      ``,
      `Veja a conversa no painel.`,
    ]
      .filter((l) => l !== null)
      .join("\n"),
  });
  if (lead.id) await db.from("leads").update({ notified_at: new Date().toISOString() }).eq("id", lead.id);
}
