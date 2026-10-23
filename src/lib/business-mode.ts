import type { SupabaseClient } from "@supabase/supabase-js";
import { isBusinessMode, type AccountProfile } from "./first-access";

/**
 * O perfil "Para o meu negócio" na conta (23/10/2026): o cliente único (o próprio negócio; null
 * antes do primeiro chatbot) ou null quando a conta é de agência (o perfil, ou mais de um cliente).
 * `db` com a RLS de quem está logado.
 */
export async function businessMode(db: SupabaseClient, agency: { id: string; profile?: AccountProfile | null }): Promise<{ clientId: string | null } | null> {
  if (agency.profile !== "business") return null;
  const { data, count } = await db.from("clients").select("id", { count: "exact" }).eq("agency_id", agency.id).order("created_at").limit(2);
  return isBusinessMode(agency.profile, count ?? (data ?? []).length) ? { clientId: (data?.[0]?.id as string | undefined) ?? null } : null;
}
