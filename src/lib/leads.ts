import type { SupabaseClient } from "@supabase/supabase-js";
import { openNullable, scopeOfBot, sealNullable } from "./field-cipher";

/*
 * Camada única dos leads (contatos capturados pelo assistente ou pelo formulário do widget): só
 * este arquivo usa a tabela (um teste confere). Leva S: telefone e interesse vão cifrados com a
 * chave do cliente (phone_enc, notes_enc); nome e e-mail ficam sem cifra, como na ficha do
 * contato. As colunas antigas (phone, notes) só têm o que veio antes da cifra, até a recifra do
 * histórico passar (ler funciona nos dois casos).
 */

export interface Lead {
  id: string;
  bot_id: string;
  conversation_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
}

const COLS = "id, bot_id, conversation_id, name, phone, phone_enc, email, notes, notes_enc, created_at";

async function opened(r: Record<string, unknown>): Promise<Lead> {
  return {
    id: r.id as string,
    bot_id: r.bot_id as string,
    conversation_id: (r.conversation_id as string | null) ?? null,
    name: (r.name as string | null) ?? null,
    phone: (await openNullable("leads.phone_enc", r.phone_enc)) ?? ((r.phone as string | null) || null),
    email: (r.email as string | null) ?? null,
    notes: (await openNullable("leads.notes_enc", r.notes_enc)) ?? ((r.notes as string | null) || null),
    created_at: r.created_at as string,
  };
}

const openAll = (rows: unknown[] | null) => Promise.all(((rows ?? []) as Array<Record<string, unknown>>).map(opened));

/** Grava um lead novo; devolve o id (ou null, se não gravou). */
export async function createLead(
  db: SupabaseClient,
  lead: { botId: string; conversationId: string | null; name: string; phone?: string | null; phoneHash: string | null; email?: string | null; notes?: string | null },
): Promise<string | null> {
  const scope = await scopeOfBot(lead.botId);
  const { data, error } = await db
    .from("leads")
    .insert({
      bot_id: lead.botId,
      conversation_id: lead.conversationId,
      name: lead.name,
      phone_enc: await sealNullable("leads.phone_enc", lead.phone, scope),
      phone_hash: lead.phoneHash,
      email: lead.email || null,
      notes_enc: await sealNullable("leads.notes_enc", lead.notes, scope),
    })
    .select("id")
    .single();
  if (error) console.error("lead não gravado", error.message);
  return (data?.id as string | undefined) ?? null;
}

/** Leads destes chatbots, mais novos primeiro; from/to limitam pela data de criação. */
export async function listLeads(db: SupabaseClient, opts: { botIds: string[]; from?: string; to?: string; limit: number }): Promise<Lead[]> {
  if (!opts.botIds.length) return [];
  let q = db.from("leads").select(COLS).in("bot_id", opts.botIds);
  if (opts.from) q = q.gte("created_at", opts.from);
  if (opts.to) q = q.lt("created_at", opts.to);
  const { data } = await q.order("created_at", { ascending: false }).limit(opts.limit);
  return openAll(data);
}

/** Leads capturados numa conversa. */
export async function leadsOfConversation(db: SupabaseClient, conversationId: string): Promise<Lead[]> {
  const { data } = await db.from("leads").select(COLS).eq("conversation_id", conversationId).order("created_at");
  return openAll(data);
}

export async function countLeads(db: SupabaseClient, botId: string): Promise<number> {
  const { count } = await db.from("leads").select("id", { count: "exact", head: true }).eq("bot_id", botId);
  return count ?? 0;
}

export async function markLeadNotified(db: SupabaseClient, id: string): Promise<void> {
  await db.from("leads").update({ notified_at: new Date().toISOString() }).eq("id", id);
}

/** Ids dos leads capturados nestas conversas. */
export async function leadIdsOfConversations(db: SupabaseClient, conversationIds: string[]): Promise<string[]> {
  if (!conversationIds.length) return [];
  const { data } = await db.from("leads").select("id").in("conversation_id", conversationIds);
  return (data ?? []).map((l) => l.id as string);
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

/** Retenção: ids dos leads do chatbot criados antes do corte. */
export async function leadIdsBefore(db: SupabaseClient, botId: string, cutoff: string, limit = 200): Promise<string[]> {
  const { data } = await db.from("leads").select("id").eq("bot_id", botId).lt("created_at", cutoff).limit(limit);
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
