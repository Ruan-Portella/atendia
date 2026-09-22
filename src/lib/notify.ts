import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotRow } from "./chat";
import { appUrl } from "./utils";
import { agencyBaseUrl } from "./domain";

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

/** E-mails da agência e do aviso configurado no bot (sem duplicar). */
async function recipients(db: SupabaseClient, bot: BotRow): Promise<string[]> {
  const { data: agency } = await db.from("agencies").select("owner_id").eq("id", bot.agency_id).single();
  const { data: owner } = agency ? await db.auth.admin.getUserById(agency.owner_id) : { data: null };
  return [...new Set([bot.lead_capture?.notify_email, owner?.user?.email].filter((x): x is string => Boolean(x)))];
}

/** Avisa na hora que um visitante pediu para falar com alguém, com o link para responder. */
/**
 * Avisa na hora que um visitante pediu para falar com alguém:
 *  - a agência (e o e-mail de aviso do bot), com link para o painel;
 *  - as pessoas do cliente, se ele pode atender, com link para a área do cliente e a marca
 *    da agência. Ninguém recebe o aviso duas vezes.
 */
export async function notifyHandoff(opts: { db: SupabaseClient; bot: BotRow; conversationId: string; reason?: string }) {
  const { db, bot, conversationId, reason } = opts;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const said = reason ? `\nO que ele disse: "${reason.slice(0, 300)}"` : "";

  // pessoas do cliente com permissão de atender
  let memberEmails: string[] = [];
  if (bot.client_id) {
    const { data: client } = await db.from("clients").select("id, allow_handoff, agencies(name, custom_domain, custom_domain_verified_at)").eq("id", bot.client_id).maybeSingle();
    if (client?.allow_handoff) {
      const { data: members } = await db.from("client_members").select("email").eq("client_id", client.id);
      memberEmails = (members ?? []).map((m) => m.email as string);
      const agency = (Array.isArray(client.agencies) ? client.agencies[0] : client.agencies) as { name: string; custom_domain: string | null; custom_domain_verified_at: string | null } | null;
      if (memberEmails.length && agency) {
        const fromAddress = process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? process.env.EMAIL_FROM ?? "onboarding@resend.dev";
        await resend.emails.send({
          from: `${agency.name.replace(/["<>]/g, "")} <${fromAddress}>`,
          to: memberEmails,
          subject: `Um visitante quer falar com alguém · ${bot.client_name}`,
          text: [
            `Um visitante do site de ${bot.client_name} pediu para falar com uma pessoa.`,
            said,
            `\nResponda por aqui (o assistente pausa enquanto você atende):\n${agencyBaseUrl(agency)}/cliente/${bot.client_id}/conversas/${conversationId}`,
            `\n${agency.name}`,
          ].join("\n"),
        });
      }
    }
  }

  const to = (await recipients(db, bot)).filter((e) => !memberEmails.includes(e.toLowerCase()));
  if (!to.length) return;
  const link = appUrl(`/painel/bots/${bot.id}/conversas/${conversationId}`);
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "Atendia <onboarding@resend.dev>",
    to,
    subject: `Um visitante quer falar com alguém · ${bot.client_name}`,
    text: [
      `Um visitante do chatbot ${bot.name} (${bot.client_name}) pediu para falar com uma pessoa.`,
      said,
      `\nResponda por aqui (o assistente pausa enquanto você atende):\n${link}`,
      memberEmails.length ? `\nAs pessoas do cliente também foram avisadas e podem responder pela área do cliente.` : "",
    ].join("\n"),
  });
}
