import type { SupabaseClient } from "@supabase/supabase-js";
import { RULES_VERSION, type GateCategory } from "./rules";

/** Registro do portão (gate_detections): o que foi barrado, em que etapa. Nunca derruba a resposta. */
export async function logGate(db: SupabaseClient, row: { botId: string; conversationId: string | null; stage: "entrada" | "saida"; decision: string; categories: GateCategory[] }) {
  const { error } = await db.from("gate_detections").insert({ bot_id: row.botId, conversation_id: row.conversationId, stage: row.stage, decision: row.decision, categories: row.categories, rules_version: RULES_VERSION });
  if (error) console.error("portão: registro não gravado", error.message);
}
