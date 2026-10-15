import type { SupabaseClient } from "@supabase/supabase-js";
import { queueLeadEvent } from "./message-events";
import { openNullable, scopeOfBot, sealNullable } from "./field-cipher";

/*
 * Camada única dos leads (contatos capturados pelo assistente ou pelo formulário do widget): só
 * este arquivo usa a tabela (um teste confere). Leva S: telefone e interesse vão cifrados com a
 * chave do cliente (phone_enc, notes_enc); nome e e-mail ficam sem cifra, como na ficha do
 * contato. As colunas antigas (phone, notes) só têm o que veio antes da cifra, até a recifra do
 * histórico passar (ler funciona nos dois casos).
 *
 * Um lead por contato em cada chatbot (15/10): o mesmo contato, achado pela conversa, pela ficha
 * do contato, pelo telefone ou pelo e-mail, não vira outro lead; o pedido novo entra no histórico
 * (requests_enc, cifrado como o interesse) e notes fica com o pedido mais recente.
 */

/** Um pedido do contato: quando, por onde e o que pediu (null: deixou o contato sem dizer). */
export interface LeadRequest {
  at: string;
  channel: string | null;
  conversation_id: string | null;
  text: string | null;
}

export interface Lead {
  id: string;
  bot_id: string;
  /** a conversa do pedido mais recente */
  conversation_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  /** @ do Instagram (digitado ou o da conta que escreveu pelo Direct) */
  instagram: string | null;
  /** onde foi capturado: widget, whatsapp, instagram… (antigos: null) */
  channel: string | null;
  /** o pedido mais recente */
  notes: string | null;
  /** todos os pedidos, do mais antigo para o mais novo */
  requests: LeadRequest[];
  created_at: string;
  last_request_at: string;
  updated_at: string;
}

const COLS = "id, bot_id, conversation_id, name, phone, phone_enc, email, instagram_enc, channel, notes, notes_enc, requests_enc, created_at, last_request_at, updated_at";
/** Para achar e atualizar o lead do mesmo contato. */
const MATCH_COLS = `${COLS}, conversation_ids, contact_id, phone_hash`;

/** Pedidos guardados por lead (os mais antigos saem). */
export const MAX_LEAD_REQUESTS = 30;

/** O histórico gravado; sem ele (lead de antes de 15/10), o pedido único da criação. Pura. */
export function parseLeadRequests(raw: string | null, first: LeadRequest): LeadRequest[] {
  if (raw) {
    try {
      const list = JSON.parse(raw) as unknown;
      if (Array.isArray(list)) {
        const ok = list.filter((x): x is LeadRequest => Boolean(x) && typeof (x as LeadRequest).at === "string");
        if (ok.length) return ok.map((x) => ({ at: x.at, channel: x.channel ?? null, conversation_id: x.conversation_id ?? null, text: x.text ?? null }));
      }
    } catch {
      // ilegível (chave apagada): fica o pedido da criação
    }
  }
  return [first];
}

async function opened(r: Record<string, unknown>): Promise<Lead> {
  const notes = (await openNullable("leads.notes_enc", r.notes_enc)) ?? ((r.notes as string | null) || null);
  const channel = (r.channel as string | null) ?? null;
  const created = r.created_at as string;
  return {
    id: r.id as string,
    bot_id: r.bot_id as string,
    conversation_id: (r.conversation_id as string | null) ?? null,
    name: (r.name as string | null) ?? null,
    phone: (await openNullable("leads.phone_enc", r.phone_enc)) ?? ((r.phone as string | null) || null),
    email: (r.email as string | null) ?? null,
    instagram: await openNullable("leads.instagram_enc", r.instagram_enc),
    channel,
    notes,
    requests: parseLeadRequests(await openNullable("leads.requests_enc", r.requests_enc), { at: created, channel, conversation_id: (r.conversation_id as string | null) ?? null, text: notes }),
    created_at: created,
    last_request_at: (r.last_request_at as string | null) ?? created,
    updated_at: (r.updated_at as string | null) ?? created,
  };
}

const openAll = (rows: unknown[] | null) => Promise.all(((rows ?? []) as Array<Record<string, unknown>>).map(opened));

export interface LeadInput {
  botId: string;
  conversationId: string | null;
  name: string;
  phone?: string | null;
  phoneHash: string | null;
  email?: string | null;
  instagram?: string | null;
  channel?: string | null;
  /** o que a pessoa quer agora (vira um pedido no histórico) */
  notes?: string | null;
}

export interface SavedLead {
  id: string;
  /** primeiro pedido deste contato no chatbot */
  created: boolean;
  /** entrou um pedido no histórico (sempre no lead novo; não entra o repetido na mesma conversa) */
  newRequest: boolean;
  /** primeiro pedido do contato nesta conversa (ou formulário sem conversa): a equipe é avisada */
  newConversation: boolean;
}

const clean = (v: string | null | undefined) => v?.trim() || null;

/**
 * O que muda no lead que já existe com um pedido novo do mesmo contato. Pura: o nome, o telefone,
 * o e-mail e o @ mais recentes valem (vazio não apaga); o pedido entra no histórico, a não ser que
 * seja o mesmo texto (ou nenhum) na mesma conversa.
 */
export function mergeLead(
  prev: { name: string | null; phone: string | null; email: string | null; instagram: string | null; conversationIds: string[]; requests: LeadRequest[] },
  input: { name: string; phone?: string | null; email?: string | null; instagram?: string | null; channel?: string | null; conversationId: string | null; notes?: string | null },
  now: string,
): { newRequest: boolean; newConversation: boolean; name: string | null; phone: string | null; email: string | null; instagram: string | null; requests: LeadRequest[]; conversationIds: string[]; changed: boolean } {
  const conv = input.conversationId;
  const newConversation = !conv || !prev.conversationIds.includes(conv);
  const text = clean(input.notes);
  const lastHere = [...prev.requests].reverse().find((r) => r.conversation_id === conv) ?? null;
  const newRequest = newConversation || (text !== null && text !== lastHere?.text);
  const name = clean(input.name) ?? prev.name;
  const phone = clean(input.phone) ?? prev.phone;
  const email = clean(input.email) ?? prev.email;
  const instagram = clean(input.instagram) ?? prev.instagram;
  const requests = newRequest ? [...prev.requests, { at: now, channel: input.channel ?? null, conversation_id: conv, text }].slice(-MAX_LEAD_REQUESTS) : prev.requests;
  const conversationIds = conv && !prev.conversationIds.includes(conv) ? [...prev.conversationIds, conv] : prev.conversationIds;
  const changed = newRequest || name !== prev.name || phone !== prev.phone || email?.toLowerCase() !== prev.email?.toLowerCase() || instagram !== prev.instagram;
  return { newRequest, newConversation, name, phone, email, instagram, requests, conversationIds, changed };
}

/** O lead do mesmo contato no chatbot (o de pedido mais recente), pela ordem: conversa, ficha, telefone, e-mail. */
async function sameContactLead(db: SupabaseClient, botId: string, by: { conversationId: string | null; contactId: string | null; phoneHash: string | null; email: string | null }): Promise<Record<string, unknown> | null> {
  const base = () => db.from("leads").select(MATCH_COLS).eq("bot_id", botId);
  const first = async (q: ReturnType<typeof base>) => {
    const { data } = await q.order("last_request_at", { ascending: false }).limit(1);
    return ((data ?? []) as Array<Record<string, unknown>>)[0] ?? null;
  };
  // conversation_id cobre o lead gravado entre a migração e o deploy (conversation_ids vazio)
  if (by.conversationId) {
    const hit = await first(base().or(`conversation_id.eq.${by.conversationId},conversation_ids.cs.{${by.conversationId}}`));
    if (hit) return hit;
  }
  if (by.contactId) {
    const hit = await first(base().eq("contact_id", by.contactId));
    if (hit) return hit;
  }
  if (by.phoneHash) {
    const hit = await first(base().eq("phone_hash", by.phoneHash));
    if (hit) return hit;
  }
  if (by.email) {
    // % e _ são curingas no ilike: o e-mail compara ao pé da letra
    const hit = await first(base().ilike("email", by.email.replace(/[\\%_]/g, "\\$&")));
    if (hit) return hit;
  }
  return null;
}

/**
 * Grava o pedido de contato: atualiza o lead do mesmo contato no chatbot ou cria um novo. Devolve
 * o que aconteceu (para avisar a equipe), ou null se não gravou. Webhooks: lead.created no novo,
 * lead.updated quando o lead que já existia mudou.
 */
export async function saveLead(db: SupabaseClient, lead: LeadInput): Promise<SavedLead | null> {
  const scope = await scopeOfBot(lead.botId);
  const now = new Date().toISOString();
  const text = clean(lead.notes);
  const email = clean(lead.email);
  let contactId: string | null = null;
  if (lead.conversationId) {
    const { data: conv } = await db.from("conversations").select("contact_id").eq("id", lead.conversationId).maybeSingle();
    contactId = (conv?.contact_id as string | null | undefined) ?? null;
  }
  const event = { conversationId: lead.conversationId };

  const found = await sameContactLead(db, lead.botId, { conversationId: lead.conversationId, contactId, phoneHash: lead.phoneHash, email });
  if (!found) {
    const request: LeadRequest = { at: now, channel: lead.channel ?? null, conversation_id: lead.conversationId, text };
    const { data, error } = await db
      .from("leads")
      .insert({
        bot_id: lead.botId,
        conversation_id: lead.conversationId,
        conversation_ids: lead.conversationId ? [lead.conversationId] : [],
        contact_id: contactId,
        name: lead.name,
        phone_enc: await sealNullable("leads.phone_enc", clean(lead.phone), scope),
        phone_hash: lead.phoneHash,
        email,
        instagram_enc: await sealNullable("leads.instagram_enc", clean(lead.instagram), scope),
        channel: lead.channel ?? null,
        notes_enc: await sealNullable("leads.notes_enc", text, scope),
        requests_enc: await sealNullable("leads.requests_enc", JSON.stringify([request]), scope),
        last_request_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    if (error) console.error("lead não gravado", error.message);
    const id = (data?.id as string | undefined) ?? null;
    if (!id) return null;
    // webhooks: lead.created para o sistema do cliente
    await queueLeadEvent(db, { id, name: lead.name, phone: clean(lead.phone), email, notes: text }, { ...event, kind: "created" });
    return { id, created: true, newRequest: true, newConversation: true };
  }

  const prev = await opened(found);
  const m = mergeLead(
    { name: prev.name, phone: prev.phone, email: prev.email, instagram: prev.instagram, conversationIds: [...new Set([...((found.conversation_ids as string[] | null) ?? []), ...(prev.conversation_id ? [prev.conversation_id] : [])])], requests: prev.requests },
    { ...lead, email },
    now,
  );
  const id = prev.id;
  if (!m.changed) return { id, created: false, newRequest: false, newConversation: false };
  const patch: Record<string, unknown> = {
    name: m.name,
    email: m.email,
    conversation_ids: m.conversationIds,
    updated_at: now,
  };
  if (lead.conversationId) patch.conversation_id = lead.conversationId;
  if (!found.contact_id && contactId) patch.contact_id = contactId;
  if (m.phone !== prev.phone) {
    patch.phone_enc = await sealNullable("leads.phone_enc", m.phone, scope);
    patch.phone_hash = lead.phoneHash ?? found.phone_hash ?? null;
  }
  if (m.instagram !== prev.instagram) patch.instagram_enc = await sealNullable("leads.instagram_enc", m.instagram, scope);
  if (m.newRequest) {
    patch.requests_enc = await sealNullable("leads.requests_enc", JSON.stringify(m.requests), scope);
    patch.last_request_at = now;
    if (text) patch.notes_enc = await sealNullable("leads.notes_enc", text, scope);
  }
  const { error } = await db.from("leads").update(patch).eq("id", id);
  if (error) {
    console.error("lead não atualizado", error.message);
    return null;
  }
  // webhooks: lead.updated (pedido novo ou contato mudou)
  await queueLeadEvent(db, { id, name: m.name ?? lead.name, phone: m.phone, email: m.email, notes: m.newRequest && text ? text : prev.notes }, { ...event, kind: "updated", request: m.newRequest ? m.requests[m.requests.length - 1] : null });
  return { id, created: false, newRequest: m.newRequest, newConversation: m.newConversation };
}

/** Leads destes chatbots, pedido mais recente primeiro; from/to limitam pela data de criação. */
export async function listLeads(db: SupabaseClient, opts: { botIds: string[]; from?: string; to?: string; limit: number }): Promise<Lead[]> {
  if (!opts.botIds.length) return [];
  let q = db.from("leads").select(COLS).in("bot_id", opts.botIds);
  if (opts.from) q = q.gte("created_at", opts.from);
  if (opts.to) q = q.lt("created_at", opts.to);
  const { data } = await q.order("last_request_at", { ascending: false }).limit(opts.limit);
  return openAll(data);
}

/** Exportação dos dados do negócio: uma página de leads destes chatbots, abertos (por id, depois de `after`). */
export async function exportLeadsPage(db: SupabaseClient, botIds: string[], after: string | null, limit = 500): Promise<Lead[]> {
  if (!botIds.length) return [];
  let q = db.from("leads").select(COLS).in("bot_id", botIds);
  if (after) q = q.gt("id", after);
  const { data } = await q.order("id").limit(limit);
  return openAll(data);
}

/** Leads com algum pedido nesta conversa. */
export async function leadsOfConversation(db: SupabaseClient, conversationId: string): Promise<Lead[]> {
  const { data } = await db.from("leads").select(COLS).or(`conversation_id.eq.${conversationId},conversation_ids.cs.{${conversationId}}`).order("created_at");
  return openAll(data);
}

export async function countLeads(db: SupabaseClient, botId: string): Promise<number> {
  const { count } = await db.from("leads").select("id", { count: "exact", head: true }).eq("bot_id", botId);
  return count ?? 0;
}

export async function markLeadNotified(db: SupabaseClient, id: string): Promise<void> {
  await db.from("leads").update({ notified_at: new Date().toISOString() }).eq("id", id);
}

/** Ids dos leads com algum pedido nestas conversas. */
export async function leadIdsOfConversations(db: SupabaseClient, conversationIds: string[]): Promise<string[]> {
  const ids = new Set<string>();
  // a lista vai duas vezes no endereço: lotes de 100
  for (let i = 0; i < conversationIds.length; i += 100) {
    const list = conversationIds.slice(i, i + 100).join(",");
    const { data } = await db.from("leads").select("id").or(`conversation_id.in.(${list}),conversation_ids.ov.{${list}}`);
    for (const l of data ?? []) ids.add(l.id as string);
  }
  return [...ids];
}

/** Apaga leads (quem chama já gravou no registro de exclusões); devolve quantos saíram, ou null com erro. */
export async function deleteLeads(db: SupabaseClient, ids: string[]): Promise<number | null> {
  if (!ids.length) return 0;
  const { error, count } = await db.from("leads").delete({ count: "exact" }).in("id", ids);
  if (error) {
    console.error("exclusão de leads", error.message);
    return null;
  }
  return count ?? 0;
}

/** Retenção: ids dos leads do chatbot sem pedido desde o corte. */
export async function leadIdsBefore(db: SupabaseClient, botId: string, cutoff: string, limit = 200): Promise<string[]> {
  const { data } = await db.from("leads").select("id").eq("bot_id", botId).lt("last_request_at", cutoff).limit(limit);
  return (data ?? []).map((l) => l.id as string);
}

const digitsOf = (v: string) => v.replace(/\D/g, "");

/**
 * Leads destes chatbots com este e-mail, ou com este telefone (pedido de titular, LGPD).
 * Telefone: pelo hash do número canônico e, para os digitados de outro jeito, comparando só os
 * números pelo final (com ou sem +55 e DDD formatado), com o telefone aberto.
 */
export async function findLeadsByContact(db: SupabaseClient, botIds: string[], by: { email: string } | { phone: string; phoneHash: string | null }): Promise<Array<{ id: string; conversation_id: string | null }>> {
  if (!botIds.length) return [];
  const pick = (r: Record<string, unknown>) => ({ id: r.id as string, conversation_id: (r.conversation_id as string | null) ?? null });
  if ("email" in by) {
    // % e _ são curingas no ilike: o e-mail compara ao pé da letra
    const { data } = await db.from("leads").select("id, conversation_id").in("bot_id", botIds).ilike("email", by.email.replace(/[\\%_]/g, "\\$&"));
    return ((data ?? []) as Array<Record<string, unknown>>).map(pick);
  }
  const found = new Map<string, { id: string; conversation_id: string | null }>();
  if (by.phoneHash) {
    const { data } = await db.from("leads").select("id, conversation_id").in("bot_id", botIds).eq("phone_hash", by.phoneHash);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) found.set(r.id as string, pick(r));
  }
  const tail = digitsOf(by.phone).slice(-10);
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data } = await db.from("leads").select("id, conversation_id, phone, phone_enc").in("bot_id", botIds).or("phone.not.is.null,phone_enc.not.is.null").order("id").range(from, from + PAGE - 1);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of rows) {
      const phone = (await openNullable("leads.phone_enc", r.phone_enc)) ?? String(r.phone ?? "");
      if (tail && digitsOf(phone).endsWith(tail)) found.set(r.id as string, pick(r));
    }
    if (rows.length < PAGE) break;
  }
  return [...found.values()];
}

/* ------------------------------------------------------------------ recifra do histórico */

const PLAIN = "phone.not.is.null,notes.not.is.null";

/** Leads com telefone ou interesse ainda sem cifra (de antes da leva S). */
export async function countPlainLeads(db: SupabaseClient): Promise<number> {
  const { count } = await db.from("leads").select("id", { count: "exact", head: true }).or(PLAIN);
  return count ?? 0;
}

/** Move telefone e interesse sem cifra para as colunas cifradas, com a chave do cliente; devolve quantos leads. */
export async function reencryptLeads(db: SupabaseClient, limit = 200): Promise<number> {
  const { data, error } = await db.from("leads").select("id, bot_id, phone, phone_enc, notes, notes_enc").or(PLAIN).limit(limit);
  if (error) throw new Error(`recifra dos leads: ${error.message}`);
  let done = 0;
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const scope = await scopeOfBot(r.bot_id as string);
    const patch: Record<string, string | null> = { phone: null, notes: null };
    // já cifrado (gravado de novo depois): fica o cifrado
    if (r.phone && !r.phone_enc) patch.phone_enc = await sealNullable("leads.phone_enc", r.phone as string, scope);
    if (r.notes && !r.notes_enc) patch.notes_enc = await sealNullable("leads.notes_enc", r.notes as string, scope);
    const { data: upd } = await db.from("leads").update(patch).eq("id", r.id as string).select("id");
    if (upd?.length) done++;
  }
  return done;
}

/**
 * Uma página de leads destes chatbots para a API (C pública, parte 4a), do mais antigo para o mais
 * novo. after: [created_at, id] do último da página anterior; since: criados a partir dela;
 * updatedSince: com mudança (pedido novo ou contato) a partir dela.
 */
export async function apiLeadsPage(db: SupabaseClient, o: { botIds: string[]; channel?: string | null; since?: string | null; updatedSince?: string | null; after?: [string, string] | null; limit: number }): Promise<Lead[]> {
  if (!o.botIds.length) return [];
  let q = db.from("leads").select(COLS).in("bot_id", o.botIds);
  if (o.channel) q = q.eq("channel", o.channel);
  if (o.since) q = q.gte("created_at", o.since);
  if (o.updatedSince) q = q.gte("updated_at", o.updatedSince);
  if (o.after) q = q.or(`created_at.gt."${o.after[0]}",and(created_at.eq."${o.after[0]}",id.gt.${o.after[1]})`);
  const { data, error } = await q.order("created_at").order("id").limit(o.limit);
  if (error) throw new Error(`leads da API: ${error.message}`);
  return openAll(data);
}
