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
          subject: `Um visitante quer falar com alguém · ${bot.client_name}`,
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
  if (delegated) return;

  const to = (await recipients(db, bot)).filter((e) => !memberEmails.includes(e.toLowerCase()));
  if (!to.length) return;
  const link = appUrl(`/painel/bots/${bot.id}/conversas/${conversationId}`);
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "Boavoz <onboarding@resend.dev>",
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

/**
 * Avisos de cota do mês, disparados pelo contador de conversas: exatamente ao chegar em 80%
 * e na primeira conversa acima do limite (o contador sobe de 1 em 1, então cada aviso sai
 * uma vez por mês sem precisar guardar nada).
 */
/** Qual aviso de cota disparar para este valor do contador (cada um sai uma vez por mês). */
export function usageAlertLevel(used: number, limit: number): 80 | 100 | null {
  if (limit <= 0) return null;
  if (used === Math.ceil(limit * 0.8)) return 80;
  if (used === limit + 1) return 100;
  return null;
}

export async function notifyUsageThreshold(db: SupabaseClient, agencyId: string, used: number, limit: number) {
  const level = usageAlertLevel(used, limit);
  if (!level) return;
  const billing = appUrl("/painel/cobranca");
  if (level === 80) {
    await notifyAgencyOwner(db, agencyId, "Você já usou 80% das conversas do mês", [
      `Seus chatbots já tiveram ${used} de ${limit} conversas neste mês.`,
      "",
      "Quando o limite acabar, o chat dos seus clientes passa a mostrar só um formulário de contato (os contatos continuam chegando, mas o assistente para de responder).",
      "",
      `Para não parar, faça upgrade do plano: ${billing}`,
    ]);
  } else {
    await notifyAgencyOwner(db, agencyId, "Limite de conversas do mês atingido", [
      `Seus chatbots chegaram a ${limit} conversas neste mês.`,
      "",
      "A partir de agora, quem abre o chat no site dos seus clientes vê um formulário de contato em vez do assistente. Os contatos continuam chegando no painel.",
      "",
      `Faça upgrade para o assistente voltar a responder na hora: ${billing}`,
    ]);
  }
}
