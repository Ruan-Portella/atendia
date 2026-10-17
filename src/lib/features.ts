import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Recursos liberados por agência, sem deploy (L1; spec "agencies.features"): o BoaVoz liga e
 * desliga no backoffice (Liberação), com auditoria. Substitui as listas WHATSAPP_BETA_EMAILS e
 * INSTAGRAM_BETA_EMAILS. Abertura geral de um canal (platform_flags.*_open_at): abre para todas
 * as contas. O chatbot só atende nos canais com um tamanho (a cota; ver atendimentos.ts).
 */

export type Feature = "whatsapp" | "instagram";

export const FEATURES: Record<Feature, { label: string; description: string }> = {
  whatsapp: { label: "WhatsApp", description: "Conectar números do WhatsApp (beta, antes da abertura geral)" },
  instagram: { label: "Instagram", description: "Conectar contas do Instagram (beta)" },
};

export const isFeature = (v: string): v is Feature => v in FEATURES;

export interface FeatureAgency {
  features?: string[] | null;
}

/** Abertura geral dos canais (backoffice → Liberação). */
export interface ChannelOpening {
  whatsappOpenAt: string | null;
  instagramOpenAt: string | null;
}

export const hasFeature = (agency: FeatureAgency, f: Feature) => (agency.features ?? []).includes(f);

/** Situação do canal para a agência. */
export type ChannelAccess = "liberado" | "fechado";

/** Função pura: liberação da agência primeiro; depois, a abertura geral. */
export function channelAccess(agency: FeatureAgency, channel: Feature, opening: ChannelOpening): ChannelAccess {
  if (hasFeature(agency, channel)) return "liberado";
  if (channel === "instagram") return opening.instagramOpenAt ? "liberado" : "fechado";
  return opening.whatsappOpenAt ? "liberado" : "fechado";
}

export async function channelOpening(db: SupabaseClient): Promise<ChannelOpening> {
  const { data } = await db.from("platform_flags").select("whatsapp_open_at, instagram_open_at").eq("id", 1).maybeSingle();
  return { whatsappOpenAt: (data?.whatsapp_open_at as string | null) ?? null, instagramOpenAt: (data?.instagram_open_at as string | null) ?? null };
}

/** Os dois canais da Meta para a agência (abas do chatbot, conversas). */
export async function channelAccessOf(db: SupabaseClient, agency: FeatureAgency): Promise<Record<Feature, ChannelAccess>> {
  const opening = await channelOpening(db);
  return { whatsapp: channelAccess(agency, "whatsapp", opening), instagram: channelAccess(agency, "instagram", opening) };
}

/** Por que a agência não pode usar (ou conectar) este canal agora; null = pode. */
export async function channelBlock(db: SupabaseClient, agencyId: string, channel: Feature): Promise<string | null> {
  const [{ data: agency }, opening] = await Promise.all([db.from("agencies").select("features").eq("id", agencyId).maybeSingle(), channelOpening(db)]);
  if (!agency) return "Conta não encontrada.";
  if (channelAccess(agency as FeatureAgency, channel, opening) === "fechado") return `O ${FEATURES[channel].label} ainda não está disponível na sua conta.`;
  return null;
}
