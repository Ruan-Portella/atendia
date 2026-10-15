import type { SupabaseClient } from "@supabase/supabase-js";
import { queueHandoffRequested } from "./message-events";
import { nextOpening } from "./handoff-hours";
import type { BotRow } from "./chat";
import { appUrl } from "./utils";
import { agencyBaseUrl } from "./domain";
import { markLeadNotified } from "./leads";

const CHANNEL_NAME: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "chat do site", demo: "chat de demonstração", painel: "teste no painel" };

/**
 * Pedido deixado para a equipe (lead novo, ou pedido novo de um lead que já existia), tratado como
 * um pedido de atendente: a conversa entra em "esperando atendente" (a IA segue respondendo; o
 * webhook handoff.requested sai com reason lead) e a equipe recebe o e-mail uma vez por conversa,
 * com as mesmas pessoas do pedido de atendente. O e-mail leva só o nome, o canal e o link (leva S):
 * telefone, e-mail e o que a pessoa pediu ficam no painel.
 */
export async function notifyLead(opts: {
  db: SupabaseClient;
  bot: BotRow;
  lead: { id: string; nome: string; created: boolean; newRequest: boolean; newConversation: boolean };
  channel: string;
  conversationId: string | null;
}) {
  const { db, bot, lead, conversationId } = opts;
  if (!lead.newRequest) return;
  if (conversationId) await markLeadWaiting(db, bot, conversationId);
  if (!lead.newConversation) return;
  const where = CHANNEL_NAME[opts.channel] ?? "chat";
  const sent = await emailTeam(db, bot, {
    subject: lead.created ? `Novo pedido no chatbot de ${bot.client_name}: ${lead.nome}` : `${lead.nome} voltou com um pedido novo · ${bot.client_name}`,
    conversationId,
    lines: (link) => [
      lead.created ? `${lead.nome} deixou um pedido para a equipe pelo ${where} (assistente ${bot.name}, ${bot.client_name}).` : `${lead.nome}, que já tinha deixado contato, fez um pedido novo pelo ${where} (assistente ${bot.name}, ${bot.client_name}).`,
      ``,
      `O que a pessoa pediu, o telefone e o e-mail estão no painel (por segurança, não vão por e-mail):`,
      link,
    ],
  });
  if (sent) await markLeadNotified(db, lead.id);
}

/** A conversa com pedido novo de lead entra em "esperando atendente", sem pausar a IA (como requestHandoff). */
async function markLeadWaiting(db: SupabaseClient, bot: BotRow, conversationId: string): Promise<void> {
  const { data: updated } = await db
    .from("conversations")
    .update({ needs_human: true, handoff_requested_at: new Date().toISOString(), handled_at: null })
    .eq("id", conversationId)
    .or("handoff_requested_at.is.null,handled_at.not.is.null")
    .select("id");
  // já esperando: nada muda (nem webhook de novo)
  if (updated?.length) await queueHandoffRequested(db, conversationId, { lead: true, outsideHours: nextOpening(bot.human_handoff?.hours) !== null });
}

/**
 * E-mails da equipe da agência que atende este chatbot (leva B1': todo papel atende, dentro do
 * escopo) e do aviso configurado no bot, sem duplicar.
 */
async function recipients(db: SupabaseClient, bot: BotRow): Promise<string[]> {
  const { data: members } = await db.from("agency_members").select("id, email, scope").eq("agency_id", bot.agency_id).is("removed_at", null).not("accepted_at", "is", null).is("paused_by_plan_at", null);
  const rows = (members ?? []) as Array<{ id: string; email: string; scope: string }>;
  const selected = rows.filter((m) => m.scope === "selected").map((m) => m.id);
  const inScope = new Set<string>();
  if (selected.length) {
    const { data: scopes } = await db.from("agency_member_scopes").select("member_id, client_id, bot_id").in("member_id", selected);
    for (const sc of (scopes ?? []) as Array<{ member_id: string; client_id: string | null; bot_id: string | null }>) {
      if (sc.bot_id === bot.id || (bot.client_id && sc.client_id === bot.client_id)) inScope.add(sc.member_id);
    }
  }
  const team = rows.filter((m) => m.scope === "all" || inScope.has(m.id)).map((m) => m.email);
  return [...new Set([bot.lead_capture?.notify_email, ...team].filter((x): x is string => Boolean(x)).map((e) => e.toLowerCase()))];
}

/**
 * Avisa na hora que um visitante pediu para falar com alguém:
 *  - a agência (e o e-mail de aviso do bot), com link para o painel;
 *  - as pessoas do cliente, se ele pode atender, com link para a área do cliente e a marca
 *    da agência. Ninguém recebe o aviso duas vezes.
 */
export async function notifyHandoff(opts: { db: SupabaseClient; bot: BotRow; conversationId: string; reason?: string; urgent?: boolean; aiUnavailable?: boolean }) {
  // o motivo (o que o contato disse) não vai por e-mail (leva S): a conversa fica no painel
  const { db, bot, conversationId, urgent } = opts;
  // webhooks: handoff.requested (com ou sem e-mail configurado)
  await queueHandoffRequested(db, conversationId, { urgent, aiUnavailable: opts.aiUnavailable, outsideHours: nextOpening(bot.human_handoff?.hours) !== null });
  // risco à vida: assunto destacado e a agência sempre avisada (mesmo com o atendimento delegado)
  const urgentTag = urgent ? "URGENTE (possível risco à vida) · " : "";
  await emailTeam(db, bot, {
    subject: `${urgentTag}Um visitante quer falar com alguém · ${bot.client_name}`,
    conversationId,
    urgent,
    lines: (link) => [`Um visitante do chatbot ${bot.name} (${bot.client_name}) pediu para falar com uma pessoa.`, `\nResponda por aqui (o assistente pausa enquanto você atende):\n${link}`],
    clientLines: (link) => [`Um visitante do site de ${bot.client_name} pediu para falar com uma pessoa.`, `\nResponda por aqui (o assistente pausa enquanto você atende):\n${link}`],
  });
}

/**
 * E-mail para quem atende o chatbot (pedido de atendente e pedido de lead): as pessoas do cliente,
 * se ele pode atender, com a marca da agência e o link da área do cliente; a agência (equipe no
 * escopo e o e-mail de aviso do bot), com o link do painel, a não ser que ela tenha delegado o
 * atendimento ao cliente e o e-mail dele tenha saído (urgente: a agência sempre). Sem conversa
 * (formulário do site), só a agência, com o link dos leads. Devolve se algum e-mail saiu.
 */
async function emailTeam(
  db: SupabaseClient,
  bot: BotRow,
  o: { subject: string; conversationId: string | null; urgent?: boolean; lines: (link: string) => string[]; clientLines?: (link: string) => string[] },
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  let sent = false;

  // pessoas do cliente com permissão de atender
  let memberEmails: string[] = [];
  let delegated = false; // a agência escolheu: só as pessoas do cliente recebem
  if (bot.client_id && o.conversationId) {
    const { data: client } = await db.from("clients").select("id, allow_handoff, handoff_notify, agencies(name, custom_domain, custom_domain_verified_at)").eq("id", bot.client_id).maybeSingle();
    if (client?.allow_handoff) {
      const { data: members } = await db.from("client_members").select("email").eq("client_id", client.id);
      memberEmails = (members ?? []).map((m) => m.email as string);
      const agency = (Array.isArray(client.agencies) ? client.agencies[0] : client.agencies) as { name: string; custom_domain: string | null; custom_domain_verified_at: string | null } | null;
      if (memberEmails.length && agency) {
        const fromAddress = process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? process.env.EMAIL_FROM ?? "onboarding@resend.dev";
        const link = `${agencyBaseUrl(agency)}/cliente/${bot.client_id}/conversas/${o.conversationId}`;
        const { error } = await resend.emails.send({
          from: `${agency.name.replace(/["<>]/g, "")} <${fromAddress}>`,
          to: memberEmails,
          subject: o.subject,
          text: [...(o.clientLines ?? o.lines)(link), `\n${agency.name}`].join("\n"),
        });
        sent = !error;
        // só deixa de avisar a agência se o e-mail para o cliente saiu mesmo
        delegated = client.handoff_notify === "client" && !error;
      }
    }
  }
  if (delegated && !o.urgent) return sent;

  const clientPeople = memberEmails.map((m) => m.toLowerCase());
  const to = (await recipients(db, bot)).filter((e) => !clientPeople.includes(e));
  if (!to.length) return sent;
  const link = o.conversationId ? appUrl(`/painel/bots/${bot.id}/conversas/${o.conversationId}`) : appUrl(bot.client_id ? `/painel/clientes/${bot.client_id}?tab=leads` : `/painel/bots/${bot.id}?tab=leads`);
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "Boavoz <onboarding@resend.dev>",
    to,
    subject: o.subject,
    text: [...o.lines(link), memberEmails.length ? `\nAs pessoas do cliente também foram avisadas e podem responder pela área do cliente.` : ""].filter(Boolean).join("\n"),
  });
  return sent || !error;
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

/** E-mail aos gestores do portal do cliente e ao e-mail do relatório, com o nome da agência (atendente não recebe). */
export async function notifyClientPeople(db: SupabaseClient, clientId: string, subject: string, lines: string[]): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const [{ data: client }, { data: members }] = await Promise.all([
    db.from("clients").select("report_email, agencies(name)").eq("id", clientId).maybeSingle(),
    db.from("client_members").select("email").eq("client_id", clientId).eq("role", "manager"),
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
