import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * IA pausada pelo backoffice: a chave geral (todas as agências, emergência) ou a pausa desta
 * agência. Na dúvida (erro ao ler), não pausa: a pausa é decisão explícita de alguém.
 */
export async function isAiPaused(db: SupabaseClient, agencyId: string): Promise<boolean> {
  const [{ data: flags }, { data: agency }] = await Promise.all([
    db.from("platform_flags").select("ai_paused_at").eq("id", 1).maybeSingle(),
    db.from("agencies").select("ai_paused_at").eq("id", agencyId).maybeSingle(),
  ]);
  return Boolean(flags?.ai_paused_at || agency?.ai_paused_at);
}
