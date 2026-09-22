import type { SupabaseClient } from "@supabase/supabase-js";

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
  handoff_requested_at: string;
  takeover_at: string | null;
  bots: { name: string; client_name: string; client_id: string | null } | null;
}

/** Conversas em que o visitante pediu atendente e ninguém encerrou (últimos 7 dias). */
export async function getPendingHandoffs(supabase: SupabaseClient, botIds?: string[]): Promise<PendingHandoff[]> {
  let q = supabase
    .from("conversations")
    .select("id, bot_id, handoff_requested_at, takeover_at, bots(name, client_name, client_id)")
    .not("handoff_requested_at", "is", null)
    .is("handled_at", null)
    .gte("handoff_requested_at", new Date(Date.now() - 7 * 86400000).toISOString())
    .order("handoff_requested_at", { ascending: false })
    .limit(20);
  if (botIds) q = q.in("bot_id", botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q;
  return ((data ?? []) as Array<Omit<PendingHandoff, "bots"> & { bots: PendingHandoff["bots"] | PendingHandoff["bots"][] }>).map((r) => ({ ...r, bots: Array.isArray(r.bots) ? r.bots[0] ?? null : r.bots }));
}
