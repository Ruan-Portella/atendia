import type { SupabaseClient } from "@supabase/supabase-js";
import { exportContactsPage, findContactIds, typedPhoneHash } from "./contacts";
import { exportLeadsPage, findLeadsByContact } from "./leads";
import { loadMessages } from "./messages";
import { isEmail } from "./validation";

/*
 * Pedido de titular pelo painel (LGPD): achar a pessoa pelo e-mail ou telefone nos chatbots de um
 * cliente, para apagar (com a prévia) ou para exportar o que existe dela (acesso e portabilidade,
 * relatório de segurança de 23/10/2026, M11). O telefone vai com o DDD e compara o número inteiro;
 * o e-mail, ao pé da letra.
 */

export interface PersonMatch {
  byEmail: boolean;
  botIds: string[];
  contactIds: string[];
  leads: Array<{ id: string; conversation_id: string | null }>;
  /** As conversas dos leads (para apagar junto). */
  leadConvs: string[];
  /** Todas as conversas da pessoa: as das fichas e as dos leads. */
  conversationIds: string[];
}

const digitsOf = (v: string) => v.replace(/\D/g, "");

/**
 * Os dados da pessoa nos chatbots do cliente. `session` lê os chatbots (a RLS confere o escopo de
 * quem pede); `admin` lê fichas e conversas.
 */
export async function findPerson(session: SupabaseClient, admin: SupabaseClient, clientId: string, raw: string): Promise<{ ok: false; message: string } | ({ ok: true } & PersonMatch)> {
  const contact = raw.trim().toLowerCase();
  const byEmail = isEmail(contact);
  if (!byEmail && digitsOf(contact).length < 10) return { ok: false, message: "Informe um e-mail ou o telefone com DDD." };
  const { data: bots } = await session.from("bots").select("id").eq("client_id", clientId);
  const botIds = (bots ?? []).map((b) => b.id as string);
  if (!botIds.length) return { ok: true, byEmail, botIds, contactIds: [], leads: [], leadConvs: [], conversationIds: [] };
  const ph = byEmail ? null : typedPhoneHash(contact);
  const leads = await findLeadsByContact(session, botIds, byEmail ? { email: contact } : { phone: contact, phoneHash: ph });
  const contactIds = byEmail ? await findContactIds(admin, botIds, { email: contact }) : ph ? await findContactIds(admin, botIds, { phoneHash: ph }) : [];
  const leadConvs = leads.map((l) => l.conversation_id).filter((c): c is string => Boolean(c));
  const convs = new Set(leadConvs);
  if (contactIds.length) {
    const { data } = await admin.from("conversations").select("id").in("contact_id", contactIds).in("bot_id", botIds);
    for (const c of data ?? []) convs.add(c.id as string);
  }
  return { ok: true, byEmail, botIds, contactIds, leads, leadConvs, conversationIds: [...convs] };
}

const CHANNEL: Record<string, string> = { widget: "site", whatsapp: "WhatsApp", instagram: "Instagram" };
const WHO: Record<string, string> = { user: "pessoa", assistant: "assistente", agent: "equipe" };

/** O documento do pedido de acesso: as fichas, os leads e as conversas da pessoa, com as mensagens. */
export async function personExportDoc(db: SupabaseClient, o: { match: PersonMatch; bots: Array<{ id: string; name: string }>; who: string; now?: Date }): Promise<Record<string, unknown>> {
  const { match } = o;
  const botName = new Map(o.bots.map((b) => [b.id, b.name]));
  const fichas = match.contactIds.length ? await exportContactsPage(db, match.botIds, null, 500, match.contactIds) : [];
  const leads = match.leads.length ? await exportLeadsPage(db, match.botIds, null, 500, match.leads.map((l) => l.id)) : [];
  const conversas: Array<Record<string, unknown>> = [];
  if (match.conversationIds.length) {
    const { data } = await db.from("conversations").select("id, bot_id, channel, started_at").in("id", match.conversationIds).in("bot_id", match.botIds).order("started_at");
    for (const c of (data ?? []) as Array<{ id: string; bot_id: string; channel: string | null; started_at: string }>) {
      const messages = await loadMessages(db, { conversationId: c.id }, ["role", "content", "created_at", "deleted_at"] as const);
      conversas.push({
        conversa: c.id,
        assistente: botName.get(c.bot_id) ?? null,
        canal: CHANNEL[c.channel ?? "widget"] ?? c.channel,
        inicio: c.started_at,
        mensagens: messages.map((m) => ({ data: m.created_at, de: WHO[m.role] ?? m.role, texto: m.deleted_at ? "(mensagem apagada pela pessoa)" : m.content })),
      });
    }
  }
  return {
    pedido: "Acesso aos dados pessoais (LGPD, art. 18)",
    pessoa: o.who,
    gerado_em: (o.now ?? new Date()).toISOString(),
    fichas: fichas.map((f) => ({ ...f, assistente: botName.get(f.bot_id ?? "") ?? null })),
    leads: leads.map((l) => ({ data: l.created_at, assistente: botName.get(l.bot_id) ?? null, nome: l.name, telefone: l.phone, email: l.email, instagram: l.instagram, canal: l.channel, interesse: l.notes, pedidos: l.requests, conversa: l.conversation_id })),
    conversas,
  };
}
