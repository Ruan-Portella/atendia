import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotRow } from "./chat";
import { appUrl } from "./utils";
import { agencyBaseUrl } from "./domain";
import { markLeadNotified } from "./leads";

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
    from: process.env.EMAIL_FROM ?? "Boavoz <onboarding@resend.dev>",
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
  if (lead.id) await markLeadNotified(db, lead.id);
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
export async function notifyHandoff(opts: { db: SupabaseClient; bot: BotRow; conversationId: string; reason?: string; urgent?: boolean }) {
  const { db, bot, conversationId, reason, urgent } = opts;
  // risco à vida: assunto destacado e a agência sempre avisada (mesmo com o atendimento delegado)
  const urgentTag = urgent ? "URGENTE (possível risco à vida) · " : "";
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const said = reason ? `\nO que ele disse: "${reason.slice(0, 300)}"` : "";

  // pessoas do cliente com permissão de atender
  let memberEmails: string[] = [];
  let delegated = false; // a agência escolheu: só as pessoas do cliente recebem
  if (bot.client_id) {
    const { data: client } = await db.from("clients").select("id, allow_handoff, handoff_notify, agencies(name, custom_domain, custom_domain_verified_at)").eq("id", bot.client_id).maybeSingle();
    if (client?.allow_handoff) {
      const { data: members } = await db.from("client_members").select("email").eq("client_id", client.id);
      memberEmails = (members ?? []).map((m) => m.email as string);
      const agency = (Array.isArray(client.agencies) ? client.agencies[0] : client.agencies) as { name: string; custom_domain: string | null; custom_domain_verified_at: string | null } | null;
      if (memberEmails.length && agency) {
        const fromAddress = process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? process.env.EMAIL_FROM ?? "onboarding@resend.dev";
        const { error } = await resend.emails.send({
          from: `${agency.name.replace(/["<>]/g, "")} <${fromAddress}>`,
          to: memberEmails,
          subject: `${urgentTag}Um visitante quer falar com alguém · ${bot.client_name}`,
          text: [
            `Um visitante do site de ${bot.client_name} pediu para falar com uma pessoa.`,
            said,
            `\nResponda por aqui (o assistente pausa enquanto você atende):\n${agencyBaseUrl(agency)}/cliente/${bot.client_id}/conversas/${conversationId}`,
            `\n${agency.name}`,
          ].join("\n"),
        });
        // só deixa de avisar a agência se o e-mail para o cliente saiu mesmo
        delegated = client.handoff_notify === "client" && !error;
      }
    }
  }
  if (delegated && !urgent) return;

  const to = (await recipients(db, bot)).filter((e) => !memberEmails.includes(e.toLowerCase()));
  if (!to.length) return;
  const link = appUrl(`/painel/bots/${bot.id}/conversas/${conversationId}`);
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "Boavoz <onboarding@resend.dev>",
    to,
    subject: `${urgentTag}Um visitante quer falar com alguém · ${bot.client_name}`,
    text: [
      `Um visitante do chatbot ${bot.name} (${bot.client_name}) pediu para falar com uma pessoa.`,
      said,
      `\nResponda por aqui (o assistente pausa enquanto você atende):\n${link}`,
      memberEmails.length ? `\nAs pessoas do cliente também foram avisadas e podem responder pela área do cliente.` : "",
    ].join("\n"),
  });
}

/** E-mail simples para o dono da agência (avisos de plano, cota, teste). */
export async function notifyAgencyOwner(db: SupabaseClient, agencyId: string, subject: string, lines: string[]): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const { data: agency } = await db.from("agencies").select("owner_id").eq("id", agencyId).maybeSingle();
  if (!agency?.owner_id) return false;
  const { data: owner } = await db.auth.admin.getUserById(agency.owner_id);
  const to = owner?.user?.email;
  if (!to) return false;
  const { Resend } = await import("resend");
  const { error } = await new Resend(apiKey).emails.send({ from: process.env.EMAIL_FROM ?? "Boavoz <onboarding@resend.dev>", to, subject, text: lines.join("\n") });
  return !error;
}

/** E-mail às pessoas do cliente (área do cliente e e-mail do relatório), com o nome da agência. */
export async function notifyClientPeople(db: SupabaseClient, clientId: string, subject: string, lines: string[]): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const [{ data: client }, { data: members }] = await Promise.all([
    db.from("clients").select("report_email, agencies(name)").eq("id", clientId).maybeSingle(),
    db.from("client_members").select("email").eq("client_id", clientId),
  ]);
  const to = [...new Set([...(members ?? []).map((m) => String(m.email).toLowerCase()), ...(client?.report_email ? [String(client.report_email).toLowerCase()] : [])])];
  if (!to.length) return false;
  const agency = (Array.isArray(client?.agencies) ? client.agencies[0] : client?.agencies) as { name: string } | null | undefined;
  const fromAddress = process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? process.env.EMAIL_FROM ?? "onboarding@resend.dev";
  const { Resend } = await import("resend");
  const { error } = await new Resend(apiKey).emails.send({ from: `${(agency?.name ?? "Boavoz").replace(/["<>]/g, "")} <${fromAddress}>`, to, subject, text: lines.join("\n") });
  return !error;
}

/** Alerta para quem opera a plataforma (PLATFORM_ALERT_EMAIL, padrão contato@boavoz.com). */
export async function notifyPlatform(subject: string, lines: string[]): Promise<boolean> {
  const text = lines.join("\n");
  console.error(`[alerta] ${subject}\n${text}`);
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const { Resend } = await import("resend");
  const to = process.env.PLATFORM_ALERT_EMAIL ?? "contato@boavoz.com";
  const { error } = await new Resend(apiKey).emails.send({ from: process.env.EMAIL_FROM ?? "Boavoz <onboarding@resend.dev>", to, subject: `[Boavoz] ${subject}`, text });
  return !error;
}

/** E-mail em texto para quem é da agência ou do cliente final: o remetente é a agência (white-label). */
export async function sendAsAgency(agencyName: string, to: string, subject: string, lines: string[]): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const { Resend } = await import("resend");
  const fromAddress = process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? process.env.EMAIL_FROM ?? "onboarding@resend.dev";
  const { error } = await new Resend(apiKey).emails.send({ from: `${agencyName.replace(/["<>]/g, "")} <${fromAddress}>`, to, subject, text: lines.join("\n") });
  return !error;
}
