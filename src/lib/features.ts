import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Recursos liberados por agência, sem deploy (L1; spec "agencies.features"): o BoaVoz liga e
 * desliga no backoffice (Liberação), com auditoria. Substitui as listas WHATSAPP_BETA_EMAILS e
 * INSTAGRAM_BETA_EMAILS. Abertura geral de um canal (platform_flags.*_open_at): o WhatsApp abre
 * para os planos pagos, e o teste grátis com WhatsApp continua na liberação manual até existir a
 * análise do bot; o Instagram abre para todos.
 */

export type Feature = "whatsapp" | "instagram";

export const FEATURES: Record<Feature, { label: string; description: string }> = {
  whatsapp: { label: "WhatsApp", description: "Conectar números do WhatsApp (beta, ou teste grátis depois da abertura)" },
  instagram: { label: "Instagram", description: "Conectar contas do Instagram (beta)" },
};

export const isFeature = (v: string): v is Feature => v in FEATURES;

export interface FeatureAgency {
  plan: string;
  features?: string[] | null;
}

/** Abertura geral dos canais (backoffice → Liberação). */
export interface ChannelOpening {
  whatsappOpenAt: string | null;
  instagramOpenAt: string | null;
}

export const hasFeature = (agency: FeatureAgency, f: Feature) => (agency.features ?? []).includes(f);

/** Situação do canal para a agência. "aguardando": teste grátis com o WhatsApp aberto, esperando a liberação manual. */
export type ChannelAccess = "liberado" | "aguardando" | "fechado";

/** Função pura: liberação da agência primeiro; depois, a abertura geral. */
export function channelAccess(agency: FeatureAgency, channel: Feature, opening: ChannelOpening): ChannelAccess {
  if (hasFeature(agency, channel)) return "liberado";
  if (channel === "instagram") return opening.instagramOpenAt ? "liberado" : "fechado";
  if (!opening.whatsappOpenAt) return "fechado";
  return agency.plan === "trial" ? "aguardando" : "liberado";
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

export const TRIAL_WHATSAPP_LOCKED = "No teste grátis, o WhatsApp é liberado pela equipe BoaVoz, conta por conta. Fale com o suporte para pedir a liberação.";

/**
 * Teste grátis: o número real só conecta com conteúdo mínimo (pelo menos 1 fonte pronta e as
 * instruções do assistente escritas). Função pura; null = pode conectar.
 */
export function trialContentProblem(readySources: number, instructions: string | null | undefined): string | null {
  if (readySources < 1) return "No teste grátis, o WhatsApp só conecta depois que a base de conhecimento tem pelo menos 1 fonte pronta (aba Base de conhecimento).";
  if (!instructions?.trim()) return "No teste grátis, o WhatsApp só conecta depois que as instruções do assistente estão escritas (aba Personalidade).";
  return null;
}

/**
 * Por que a agência não pode usar (ou conectar) este canal agora; null = pode. Com connectBotId,
 * confere também o conteúdo mínimo do teste grátis para conectar o WhatsApp neste chatbot.
 */
export async function channelBlock(db: SupabaseClient, agencyId: string, channel: Feature, connectBotId?: string): Promise<string | null> {
  const [{ data: agency }, opening] = await Promise.all([db.from("agencies").select("plan, features").eq("id", agencyId).maybeSingle(), channelOpening(db)]);
  if (!agency) return "Conta não encontrada.";
  const access = channelAccess(agency as FeatureAgency, channel, opening);
  if (access === "aguardando") return TRIAL_WHATSAPP_LOCKED;
  if (access === "fechado") return `O ${FEATURES[channel].label} ainda não está disponível na sua conta.`;
  if (!connectBotId || channel !== "whatsapp" || agency.plan !== "trial") return null;
  const [{ count }, { data: bot }] = await Promise.all([
    db.from("sources").select("id", { count: "exact", head: true }).eq("bot_id", connectBotId).eq("status", "ready"),
    db.from("bots").select("persona").eq("id", connectBotId).maybeSingle(),
  ]);
  return trialContentProblem(count ?? 0, (bot?.persona as { instructions?: string } | null)?.instructions);
}
