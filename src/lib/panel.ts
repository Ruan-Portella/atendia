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
