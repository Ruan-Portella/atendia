import { ANSWERS_PER_ATENDIMENTO, BOT_SIZES, OVERAGE_PRICE_BRL, isBotSize, type BotSize } from "./plans";
import { currentPeriodBR } from "./utils";

/* Cota por atendimento, por chatbot: definições puras (servem ao painel, ao site e ao servidor). */

export const ATENDIMENTO_DEFINITION = `1 atendimento = cada período de 24 horas em que a IA respondeu a um contato, contado a partir da primeira resposta da IA, por contato, chatbot e canal, com até ${ANSWERS_PER_ATENDIMENTO} respostas da IA; a seguinte abre outro atendimento. Conversa nova, troca de contexto ou logout dentro das 24 horas não abrem outro. Não contam: respostas da equipe (painel ou celular), mensagens pela API, campanhas e lembretes, textos fixos do BoaVoz e períodos com a IA ou o bot pausados.`;

export interface BotQuotaFields {
  size?: string | null;
  volume_packs?: number | null;
  quota_override?: number | null;
  /** Mês ('AAAA-MM-01') em que o chatbot ganhou ou subiu de tamanho, e a cota proporcional dele. */
  prorated_month?: string | null;
  prorated_quota?: number | null;
}

/**
 * Cota do mês do chatbot: a combinada fora da tabela (sob medida); no mês em que ganhou ou subiu
 * de tamanho, a proporcional; senão a do tamanho. Sem tamanho, zero. (Como open_atendimento.)
 */
export function botQuota(bot: BotQuotaFields, period = currentPeriodBR()): number {
  if (bot.quota_override !== null && bot.quota_override !== undefined) return bot.quota_override;
  if (!isBotSize(bot.size)) return 0;
  if (bot.prorated_month && bot.prorated_quota !== null && bot.prorated_quota !== undefined && bot.prorated_month.slice(0, 7) === period) return bot.prorated_quota;
  if (bot.size === "volume") return (bot.volume_packs ?? 0) * BOT_SIZES.volume.atendimentos;
  return BOT_SIZES[bot.size].atendimentos;
}

/** Cota de cada tamanho, como a abertura do atendimento recebe (o banco não guarda a tabela). */
export const SIZE_QUOTAS: Record<string, number> = Object.fromEntries(Object.values(BOT_SIZES).map((s) => [s.id, s.atendimentos]));

/** Atendimentos a mais que cabem no teto do excedente (em centavos, como o banco: sem erro de vírgula). */
export function overageMax(capBrl: number | null | undefined): number {
  if (!capBrl || capBrl <= 0) return 0;
  return Math.floor(Math.round(capBrl * 100) / Math.round(OVERAGE_PRICE_BRL * 100));
}

/** Teto do excedente que a agência escolhe, em reais por mês. */
export const OVERAGE_CAP_MIN_BRL = 10;
export const OVERAGE_CAP_MAX_BRL = 100_000;

/** Teto digitado ("49", "1.000", "R$ 49,90") em reais, ou null fora da faixa. Função pura. */
export function parseCapBrl(raw: string): number | null {
  let v = raw.replace(/R\$|\s/g, "");
  if (!/^[\d.,]+$/.test(v)) return null;
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, "");
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100) / 100;
  return cents >= OVERAGE_CAP_MIN_BRL && cents <= OVERAGE_CAP_MAX_BRL ? cents : null;
}

/** Situação de um chatbot no mês: dentro da cota, no excedente ou parado (cota sem excedente, ou teto). */
export function quotaPhase(b: { quota: number; used: number; overageEnabled: boolean; overageUsed: number; overageMax: number }): "cota" | "excedente" | "parado" {
  if (b.used < b.quota) return "cota";
  if (b.quota > 0 && b.overageEnabled && b.overageUsed < b.overageMax) return "excedente";
  return "parado";
}

/** Aviso do teto do excedente (80% e 95%; o "teto" é o último atendimento a mais que cabe). */
export function overageAlertLevel(extraUsed: number, max: number): 80 | 95 | "teto" | null {
  if (max <= 0) return null;
  if (extraUsed === max) return "teto";
  if (extraUsed === Math.ceil(max * 0.95) && extraUsed < max) return 95;
  if (extraUsed === Math.ceil(max * 0.8) && extraUsed < Math.ceil(max * 0.95)) return 80;
  return null;
}

export interface SizeSuggestion {
  size: BotSize;
  volumePacks: number | null;
  /** Quanto o mês teria saído (tamanho + excedente que sobrasse). */
  monthlyBrl: number;
  savingBrl: number;
}

/** Preço do mês com um tamanho e o excedente que sobrar acima da cota dele. */
function monthCost(price: number, quota: number, total: number): number {
  return price + Math.max(0, total - quota) * OVERAGE_PRICE_BRL;
}

/**
 * Tamanho que teria saído mais barato no mês, quando o excedente pagou a diferença (só sugere
 * subir). Compara o mês como foi (tamanho atual + excedente) com cada tamanho maior.
 */
export function suggestSize(current: { size: BotSize | null; volumePacks: number | null }, total: number): SizeSuggestion | null {
  if (!current.size) return null;
  const nowQuota = botQuota({ size: current.size, volume_packs: current.volumePacks });
  if (total <= nowQuota) return null;
  const nowPrice = current.size === "volume" ? (current.volumePacks ?? 0) * BOT_SIZES.volume.priceBrl : BOT_SIZES[current.size].priceBrl;
  const paid = monthCost(nowPrice, nowQuota, total);
  const ladder: Array<{ size: BotSize; packs: number | null; quota: number; price: number }> = [];
  for (const s of ["P", "M", "G"] as const) ladder.push({ size: s, packs: null, quota: BOT_SIZES[s].atendimentos, price: BOT_SIZES[s].priceBrl });
  for (let k = 1; k <= Math.ceil(total / BOT_SIZES.volume.atendimentos); k++) ladder.push({ size: "volume", packs: k, quota: k * BOT_SIZES.volume.atendimentos, price: k * BOT_SIZES.volume.priceBrl });
  let best: SizeSuggestion | null = null;
  for (const o of ladder) {
    if (o.quota <= nowQuota) continue;
    const cost = monthCost(o.price, o.quota, total);
    if (paid - cost >= 1 && (!best || cost < best.monthlyBrl)) best = { size: o.size, volumePacks: o.packs, monthlyBrl: Math.round(cost * 100) / 100, savingBrl: Math.round((paid - cost) * 100) / 100 };
  }
  return best;
}

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
