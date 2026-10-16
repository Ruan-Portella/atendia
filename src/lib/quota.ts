import { ANSWERS_PER_ATENDIMENTO, BOT_SIZES, isBotSize } from "./plans";

/* Cota por atendimento, por chatbot: definições puras (servem ao painel, ao site e ao servidor). */

export const ATENDIMENTO_DEFINITION = `1 atendimento = cada período de 24 horas em que a IA respondeu a um contato, contado a partir da primeira resposta da IA, por contato, chatbot e canal, com até ${ANSWERS_PER_ATENDIMENTO} respostas da IA; a seguinte abre outro atendimento. Conversa nova, troca de contexto ou logout dentro das 24 horas não abrem outro. Não contam: respostas da equipe (painel ou celular), mensagens pela API, campanhas e lembretes, textos fixos do BoaVoz e períodos com a IA ou o bot pausados.`;

export interface BotQuotaFields {
  size?: string | null;
  volume_packs?: number | null;
  quota_override?: number | null;
}

/** Cota do mês do chatbot: a combinada fora da tabela (sob medida), senão a do tamanho; sem tamanho, zero. */
export function botQuota(bot: BotQuotaFields): number {
  if (bot.quota_override !== null && bot.quota_override !== undefined) return bot.quota_override;
  if (!isBotSize(bot.size)) return 0;
  if (bot.size === "volume") return (bot.volume_packs ?? 0) * BOT_SIZES.volume.atendimentos;
  return BOT_SIZES[bot.size].atendimentos;
}

/** Cota de cada tamanho, como a abertura do atendimento recebe (o banco não guarda a tabela). */
export const SIZE_QUOTAS: Record<string, number> = Object.fromEntries(Object.values(BOT_SIZES).map((s) => [s.id, s.atendimentos]));

/** Avisos ao dono, por chatbot: cada um sai uma vez por mês (o contador sobe de 1 em 1). */
export type QuotaLevel = 80 | 95 | 100;

/** Qual aviso este atendimento novo dispara (o 100% é o último que cabe na cota). */
export function quotaAlertLevel(used: number, quota: number): QuotaLevel | null {
  if (quota <= 0) return null;
  if (used === quota) return 100;
  if (used === Math.ceil(quota * 0.95) && used < quota) return 95;
  if (used === Math.ceil(quota * 0.8) && used < Math.ceil(quota * 0.95)) return 80;
  return null;
}
