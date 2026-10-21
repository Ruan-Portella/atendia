import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type ActionResult } from "./action-result";
import { leadsOfConversation } from "./leads";
import { loadMessages, saveMessage } from "./messages";
import { agencyBaseUrl } from "./domain";
import type { Attendant } from "./authors";
import { isTicketStatus, type TicketStatus } from "./tickets";

/*
 * O chamado depois de aberto (Chamados, parte 7c). A equipe muda o status pela conversa (aberto,
 * em andamento, aguardando o cliente, resolvido); assumir passa de aberto para em andamento. A
 * resposta da equipe vai por e-mail para quem abriu, com o protocolo e o link para acompanhar, e o
 * status vira aguardando o cliente. No chat do site, a pessoa acompanha pelo protocolo e pelo
 * e-mail e pode escrever de novo, o que devolve o chamado para a equipe (e reabre o resolvido).
 */

export interface TicketRow {
  id: string;
  bot_id: string;
  ticket_protocol: string;
  ticket_status: TicketStatus;
  ticket_subject: string | null;
  handled_at: string | null;
  assigned_to_id: string | null;
}

const COLS = "id, bot_id, ticket_protocol, ticket_status, ticket_subject, handled_at, assigned_to_id";

/** O chamado do protocolo neste chatbot, só se o e-mail for o de quem abriu. */
export async function ticketByProtocol(db: SupabaseClient, botId: string, protocol: string, email: string): Promise<TicketRow | null> {
  const { data } = await db.from("conversations").select(COLS).eq("bot_id", botId).eq("ticket_protocol", protocol).maybeSingle<TicketRow>();
  if (!data) return null;
  const want = email.trim().toLowerCase();
  const leads = await leadsOfConversation(db, data.id).catch(() => []);
  return leads.some((l) => l.email?.trim().toLowerCase() === want) ? data : null;
}

export interface TicketThreadMessage {
  from: "cliente" | "equipe";
  name: string | null;
  text: string;
  at: string;
}

/** As mensagens do chamado para quem abriu: as dela e as da equipe (as notas internas nunca). */
export async function ticketThread(db: SupabaseClient, conversationId: string): Promise<TicketThreadMessage[]> {
  const rows = await loadMessages(db, { conversationId, roles: ["user", "agent"], delivered: true }, ["role", "content", "author_display_name", "announce_chars", "created_at"] as const);
  return rows.map((m) => ({ from: m.role === "user" ? "cliente" : "equipe", name: m.role === "agent" ? (m.author_display_name ?? null) : null, text: m.role === "agent" ? m.content.slice(m.announce_chars ?? 0).trim() || m.content : m.content, at: m.created_at }));
}

/** A pessoa escreveu de novo pelo acompanhamento: a mensagem entra e o chamado volta para a equipe. */
export async function addTicketMessage(db: SupabaseClient, t: TicketRow, rawText: string, now = new Date()): Promise<ActionResult> {
  const text = rawText.trim();
  if (text.length < 2) return fail("Escreva a mensagem.");
  if (text.length > 2000) return fail("Mensagem muito longa (até 2.000 caracteres).");
  await saveMessage(db, { conversation_id: t.id, role: "user", content: text }, { touch: "visitante" });
  const at = now.toISOString();
  // resolvido reabre como pedido novo; aguardando o cliente volta para quem está com ele
  const reopened = t.ticket_status === "resolvido" || Boolean(t.handled_at);
  const status: TicketStatus = reopened || !t.assigned_to_id ? "aberto" : "em_andamento";
  await db
    .from("conversations")
    .update({ ticket_status: status, ...(reopened ? { ticket_resolved_at: null, handled_at: null, needs_human: true, handoff_requested_at: at, takeover_at: null, assigned_to_type: null, assigned_to_id: null, assigned_to_name: null, assigned_at: null } : {}) })
    .eq("id", t.id);
  return ok("Mensagem enviada. A equipe responde no seu e-mail.");
}

/** A equipe mudou o status (resolvido encerra o atendimento da conversa; outro status reabre). */
export async function setTicketStatus(db: SupabaseClient, conversationId: string, status: unknown, now = new Date()): Promise<ActionResult & { before?: string | null }> {
  if (!isTicketStatus(status)) return fail("Status inválido.");
  const { data: conv } = await db.from("conversations").select("ticket_protocol, ticket_status, handled_at").eq("id", conversationId).maybeSingle();
  if (!conv?.ticket_protocol) return fail("Esta conversa não é um chamado.");
  if (conv.ticket_status === status) return ok("O chamado já está com esse status.");
  const at = now.toISOString();
  const patch =
    status === "resolvido"
      ? { ticket_status: status, ticket_resolved_at: at, handled_at: at, takeover_at: null, assigned_to_type: null, assigned_to_id: null, assigned_to_name: null, assigned_at: null, announce_pending: false, transfer_from_name: null, snoozed_until: null, snoozed_at: null }
      : { ticket_status: status, ticket_resolved_at: null, ...(conv.handled_at ? { handled_at: null, needs_human: true, handoff_requested_at: at } : {}) };
  const { error } = await db.from("conversations").update(patch).eq("id", conversationId);
  if (error) return fail("Não foi possível mudar o status. Tente de novo.");
  return { ...ok(status === "resolvido" ? "Chamado resolvido: ele sai da Caixa de entrada." : "Status do chamado atualizado."), before: (conv.ticket_status as string | null) ?? null };
}

/** Assumir o chamado aberto o deixa em andamento (sem efeito em conversa que não é chamado). */
export async function markTicketInProgress(db: SupabaseClient, conversationId: string): Promise<void> {
  await Promise.resolve(db.from("conversations").update({ ticket_status: "em_andamento" }).eq("id", conversationId).eq("ticket_status", "aberto")).catch(() => undefined);
}

/** O texto do e-mail da resposta da equipe. Pura. */
export function ticketReplyEmail(o: { protocol: string; subject: string | null; requester: string | null; agent: string; text: string; company: string; signature: string; link: string }): { subject: string; text: string } {
  const first = o.requester?.trim().split(/\s+/)[0];
  return {
    subject: `Resposta ao seu chamado ${o.protocol} · ${o.company}`,
    text: [
      first ? `Olá, ${first}!` : "Olá!",
      "",
      `${o.agent} respondeu ao seu chamado ${o.protocol}${o.subject ? ` (${o.subject})` : ""}:`,
      "",
      o.text,
      "",
      `Para responder ou acompanhar, abra ${o.link} e use o protocolo ${o.protocol} com este e-mail.`,
      "",
      o.signature,
    ].join("\n"),
  };
}

/**
 * Depois de a equipe responder pelo painel: a resposta vai por e-mail para quem abriu e o chamado
 * fica aguardando o cliente. Sem a Resend (dev), só o status muda.
 */
export async function afterTicketReply(db: SupabaseClient, conversationId: string, text: string, who: Attendant): Promise<void> {
  const { data: conv } = await db.from("conversations").select("ticket_protocol, ticket_subject, ticket_status, bots(public_key, client_name, agencies(name, custom_domain, custom_domain_verified_at))").eq("id", conversationId).maybeSingle();
  if (!conv?.ticket_protocol) return;
  await db.from("conversations").update({ ticket_status: "aguardando_cliente" }).eq("id", conversationId);
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const bot = (Array.isArray(conv.bots) ? conv.bots[0] : conv.bots) as { public_key: string; client_name: string; agencies: { name: string; custom_domain: string | null; custom_domain_verified_at: string | null } | Array<{ name: string; custom_domain: string | null; custom_domain_verified_at: string | null }> | null } | null;
  const agency = bot ? (Array.isArray(bot.agencies) ? bot.agencies[0] : bot.agencies) : null;
  const lead = (await leadsOfConversation(db, conversationId).catch(() => [])).find((l) => l.email);
  if (!bot || !agency || !lead?.email) return;
  const protocol = conv.ticket_protocol as string;
  const mail = ticketReplyEmail({ protocol, subject: (conv.ticket_subject as string | null) ?? null, requester: lead.name, agent: who.name, text, company: bot.client_name, signature: `${bot.client_name}\n${agency.name}`, link: `${agencyBaseUrl(agency)}/w/${bot.public_key}?chamado=${protocol}` });
  const fromAddress = process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? process.env.EMAIL_FROM ?? "onboarding@resend.dev";
  const { Resend } = await import("resend");
  const { error } = await new Resend(apiKey).emails.send({ from: `${bot.client_name.replace(/["<>]/g, "")} <${fromAddress}>`, to: [lead.email], subject: mail.subject, text: mail.text });
  if (error) console.error("chamado: e-mail da resposta não saiu", error.message);
}
