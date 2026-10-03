import type { SupabaseClient } from "@supabase/supabase-js";
import { handoffOrder } from "./handoff-status";

export interface BotStats {
  conversations: number;
  needsHuman: number;
  leads: number;
}

const EMPTY: BotStats = { conversations: 0, needsHuman: 0, leads: 0 };

/**
 * Conversas, pedidos de atendente e leads por chatbot desde `since`, contados no banco
 * (função `bot_stats`, migração 0004). Devolve um leitor por id e o total somado.
 */
export async function getBotStats(supabase: SupabaseClient, since: string, botIds?: string[]) {
  const { data } = await supabase.rpc("bot_stats", { p_since: since });
  const map = new Map<string, BotStats>();
  for (const r of (data ?? []) as Array<{ bot_id: string; conversations: number; needs_human: number; leads: number }>) {
    if (botIds && !botIds.includes(r.bot_id)) continue;
    map.set(r.bot_id, { conversations: r.conversations, needsHuman: r.needs_human, leads: r.leads });
  }
  const total = [...map.values()].reduce<BotStats>((t, s) => ({ conversations: t.conversations + s.conversations, needsHuman: t.needsHuman + s.needsHuman, leads: t.leads + s.leads }), { ...EMPTY });
  return { of: (id: string) => map.get(id) ?? EMPTY, total };
}

/** % de conversas resolvidas sem pedir atendente (100% quando ainda não há conversas). */
export const resolvedPct = (s: BotStats) => (s.conversations ? Math.round(100 - (s.needsHuman / s.conversations) * 100) : 100);

export interface ClientOption {
  id: string;
  name: string;
}

export async function getClientOptions(supabase: SupabaseClient, agencyId: string): Promise<ClientOption[]> {
  const { data } = await supabase.from("clients").select("id, name").eq("agency_id", agencyId).order("name");
  return data ?? [];
}

export interface PendingHandoff {
  id: string;
  bot_id: string;
  handoff_requested_at: string | null;
  takeover_at: string | null;
  handled_at: string | null;
  handoff_urgent_at: string | null;
  last_contact_at: string | null;
  last_reply_at: string | null;
  last_message_at: string;
  visitor_seen_at: string | null;
  bots: { name: string; client_name: string; client_id: string | null } | null;
}

/**
 * Atendimento humano aberto (últimos 7 dias): pediu atendente ou alguém assumiu, e ninguém
 * encerrou. Urgentes primeiro, depois quem espera (inclusive "assumida, sem resposta").
 */
export async function getPendingHandoffs(supabase: SupabaseClient, botIds?: string[]): Promise<PendingHandoff[]> {
  let q = supabase
    .from("conversations")
    .select("id, bot_id, handoff_requested_at, takeover_at, handled_at, handoff_urgent_at, last_contact_at, last_reply_at, last_message_at, visitor_seen_at, bots(name, client_name, client_id)")
    .or("handoff_requested_at.not.is.null,takeover_at.not.is.null")
    .is("handled_at", null)
    .gte("last_message_at", new Date(Date.now() - 7 * 86400000).toISOString())
    .order("last_message_at", { ascending: false })
    .limit(40);
  if (botIds) q = q.in("bot_id", botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q;
  const rows = ((data ?? []) as Array<Omit<PendingHandoff, "bots"> & { bots: PendingHandoff["bots"] | PendingHandoff["bots"][] }>).map((r) => ({ ...r, bots: Array.isArray(r.bots) ? r.bots[0] ?? null : r.bots }));
  return rows.sort((x, y) => handoffOrder(x, y));
}
