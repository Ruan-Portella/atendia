import type { SupabaseClient } from "@supabase/supabase-js";
import { CATEGORIES, type GateCategory } from "./rules";

/*
 * "Isto não é {categoria}" (L1): a agência pede revisão de um item que o portão acusou numa
 * conversa; só o BoaVoz aprova, e a exceção vale só para aquele chatbot. Com a exceção, o portão
 * não trata a categoria no chatbot (entrada, base, histórico e saída). Service role.
 */

export const isGateCategory = (v: string): v is GateCategory => v in CATEGORIES;

/** Categorias liberadas pelo BoaVoz para este chatbot. Erro de leitura: nenhuma (o portão segue inteiro). */
export async function botGateExemptions(db: SupabaseClient, botId: string): Promise<GateCategory[]> {
  try {
    const { data, error } = await db.from("bot_gate_exceptions").select("category").eq("bot_id", botId);
    if (error) return [];
    return (data ?? []).map((r) => String(r.category)).filter(isGateCategory);
  } catch {
    return [];
  }
}

/** Categorias que o portão acusou nesta conversa (entrada ou saída), sem as já liberadas. */
export async function conversationGateCategories(db: SupabaseClient, conversationId: string, exempt: GateCategory[] = []): Promise<GateCategory[]> {
  const { data } = await db.from("gate_detections").select("categories").eq("conversation_id", conversationId).limit(200);
  const all = new Set<GateCategory>();
  for (const r of data ?? []) for (const c of (r.categories as string[] | null) ?? []) if (isGateCategory(c) && !exempt.includes(c)) all.add(c);
  return [...all];
}
