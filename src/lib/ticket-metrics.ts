import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Os números dos chamados no relatório (Chamados, parte 7b): abertos no mês (as conversas com
 * protocolo), resolvidos pela equipe e os evitados pela sugestão da base ("Resolveu, não preciso
 * abrir"). As sugestões mostradas dão a taxa.
 */

export async function recordSuggestionEvent(db: SupabaseClient, e: { botId: string; kind: "mostrada" | "resolveu"; subject: string | null }): Promise<void> {
  const { error } = await db.from("ticket_suggestion_events").insert({ bot_id: e.botId, kind: e.kind, subject: e.subject });
  if (error) console.error("chamado: evento da sugestão não gravado", error.message);
}

export interface TicketMonth {
  opened: number;
  resolved: number;
  suggested: number;
  avoided: number;
}

/** Os chamados de um período (início e fim em ISO) nos chatbots informados. */
export async function ticketMonth(db: SupabaseClient, botIds: string[], from: string, to: string): Promise<TicketMonth> {
  if (!botIds.length) return { opened: 0, resolved: 0, suggested: 0, avoided: 0 };
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [opened, resolved, suggested, avoided] = await Promise.all([
    count(db.from("conversations").select("id", { count: "exact", head: true }).in("bot_id", botIds).gte("ticket_opened_at", from).lt("ticket_opened_at", to)),
    count(db.from("conversations").select("id", { count: "exact", head: true }).in("bot_id", botIds).gte("ticket_resolved_at", from).lt("ticket_resolved_at", to)),
    count(db.from("ticket_suggestion_events").select("id", { count: "exact", head: true }).in("bot_id", botIds).eq("kind", "mostrada").gte("created_at", from).lt("created_at", to)),
    count(db.from("ticket_suggestion_events").select("id", { count: "exact", head: true }).in("bot_id", botIds).eq("kind", "resolveu").gte("created_at", from).lt("created_at", to)),
  ]);
  return { opened, resolved, suggested, avoided };
}
