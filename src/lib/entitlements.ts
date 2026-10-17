import type { SupabaseClient } from "@supabase/supabase-js";
import { isPackId, type PackId } from "./plans";

/*
 * O que a conta pode usar (revisão de preços, parte 5): a conta é grátis; cada chatbot no ar tem um
 * tamanho; os pacotes liberam recursos da conta toda. Integrações: ações e webhooks em chatbots no
 * ar, a API e a identificação de usuários (cadastrar e usar o botão Testar não precisa do pacote).
 * Plataforma (exige o Integrações): segredo de identidade para todos os clientes, chatbot modelo
 * e lojas pela API. Domínio próprio: o painel e o chat no domínio da agência. Tirar um pacote não
 * apaga nada: o recurso para de funcionar e volta igual quando o pacote volta.
 */

export const NEEDS_INTEGRATIONS = "Isso faz parte do pacote Integrações. Assine em Cobrança → Assinatura.";
export const NEEDS_PLATFORM = "Isso faz parte do pacote Plataforma. Assine em Cobrança → Assinatura.";
export const NEEDS_DOMAIN = "O domínio próprio é um pacote. Assine em Cobrança → Assinatura.";

/** Pacotes ativos da conta (os que saem no dia 1º seguem valendo até lá). */
export async function activePacks(db: SupabaseClient, agencyId: string): Promise<PackId[]> {
  const { data, error } = await db.from("agency_packs").select("pack, ends_at").eq("agency_id", agencyId);
  if (error) throw new Error(`pacotes da conta: ${error.message}`);
  return activeOf(data ?? []);
}

/** Pacotes que ainda valem agora. Função pura. */
export function activeOf(rows: Array<{ pack: unknown; ends_at: unknown }>, now = Date.now()): PackId[] {
  return rows.filter((r) => isPackId(r.pack) && (!r.ends_at || Date.parse(String(r.ends_at)) > now)).map((r) => r.pack as PackId);
}

export async function hasPack(db: SupabaseClient, agencyId: string, pack: PackId): Promise<boolean> {
  return (await activePacks(db, agencyId)).includes(pack);
}

/**
 * Webhooks que a conta cadastra: um por chatbot no ar (com tamanho), no mínimo 2. Cadastrar e
 * testar não precisa do pacote; entregar, sim (webhooks.ts). Função pura.
 */
export function webhookLimit(liveBots: number): number {
  return Math.max(2, liveBots);
}
