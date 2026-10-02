import { getPlan } from "./plans";

/* Cota por atendimento: definições puras (servem ao painel, ao site e ao servidor). */

export const ATENDIMENTO_DEFINITION =
  "1 atendimento = cada período de 24 horas em que a IA respondeu a um contato, contado a partir da primeira resposta da IA, por contato, bot e canal. Conversa nova, troca de contexto ou logout dentro das 24 horas não abrem outro. Não contam: respostas da equipe (painel ou celular), mensagens pela API, campanhas e lembretes, textos fixos do BoaVoz e períodos com a IA ou o bot pausados.";

/** Tolerância fixa sobre a cota do plano, uma vez por mês, antes do modo só humano. */
export const QUOTA_TOLERANCE = 0.1;

/** Cota do mês da agência: a combinada fora do plano, se houver; senão a do plano. */
export function quotaOf(agency: { plan: string; quota_override?: number | null }): number {
  return agency.quota_override ?? getPlan(agency.plan).atendimentos;
}

/** Até onde vai antes do modo só humano: a cota mais a tolerância. */
export const hardLimitOf = (quota: number) => quota + Math.floor(quota * QUOTA_TOLERANCE);
