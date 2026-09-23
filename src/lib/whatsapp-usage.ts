import type { SupabaseClient } from "@supabase/supabase-js";
import { currentPeriodBR } from "./utils";

/**
 * Consumo do WhatsApp por cliente: a Meta informa em cada status de mensagem enviada se ela foi
 * cobrada e em qual categoria (webhook, campo pricing). Guardamos uma linha por mensagem e somamos
 * por mês. Serve para mostrar o custo à agência hoje e para cobrar "WhatsApp incluso" no futuro.
 */

export interface StatusPricing {
  billable?: boolean;
  pricing_model?: string;
  category?: string;
  type?: string;
}

export interface MessageStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  pricing?: StatusPricing;
}

export const CATEGORY_LABEL: Record<string, string> = {
  service: "Respostas (serviço)",
  utility: "Modelos de utilidade",
  marketing: "Modelos de marketing",
  authentication: "Autenticação",
  authentication_international: "Autenticação internacional",
  referral_conversion: "Vindas de anúncio (grátis)",
};

/** Linha de consumo a partir de um status; null se ele não traz preço. */
export function usageRow(botId: string, phoneNumberId: string, s: MessageStatus) {
  if (!s.id || !s.pricing?.category) return null;
  const when = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
  return {
    message_id: s.id,
    bot_id: botId,
    phone_number_id: phoneNumberId,
    period: currentPeriodBR(when),
    category: s.pricing.category,
    billable: s.pricing.billable === true,
    pricing_type: s.pricing.type ?? null,
    created_at: when.toISOString(),
  };
}

/** Registra os status de um webhook (ignora os repetidos da mesma mensagem). Service role. */
export async function recordUsage(db: SupabaseClient, botId: string, phoneNumberId: string, statuses: MessageStatus[]) {
  const rows = statuses.map((s) => usageRow(botId, phoneNumberId, s)).filter((r): r is NonNullable<typeof r> => r !== null);
  if (!rows.length) return;
  const unique = [...new Map(rows.map((r) => [r.message_id, r])).values()];
  const { error } = await db.from("whatsapp_usage").upsert(unique, { onConflict: "message_id", ignoreDuplicates: true });
  if (error) console.warn("whatsapp: consumo não registrado", error.message);
}

/**
 * Preço de referência por mensagem cobrada, em R$, por categoria. A Meta muda a tabela e cobra do
 * cliente no cartão dele: isto é só uma estimativa. WHATSAPP_PRICES_BRL="service=0.035,utility=0.035,
 * marketing=0.35" (separados por vírgula, decimal com ponto) troca os valores; categoria sem preço
 * aparece só na contagem.
 */
export function referencePrices(raw = process.env.WHATSAPP_PRICES_BRL): Record<string, number> {
  const prices: Record<string, number> = { service: 0.035, utility: 0.035 };
  for (const pair of (raw ?? "").split(",")) {
    const [k, v] = pair.split("=").map((x) => x?.trim());
    const n = Number(v);
    if (k && Number.isFinite(n) && n >= 0) prices[k] = n;
  }
  return prices;
}

export interface UsageLine {
  category: string;
  sent: number;
  billed: number;
}

/** Estimativa do mês: soma só o que tem preço de referência; avisa se alguma categoria ficou de fora. */
export function estimateCost(lines: UsageLine[], prices = referencePrices()): { total: number; unpriced: string[] } {
  let total = 0;
  const unpriced: string[] = [];
  for (const l of lines) {
    if (!l.billed) continue;
    const p = prices[l.category];
    if (p === undefined) unpriced.push(l.category);
    else total += p * l.billed;
  }
  return { total, unpriced };
}

export async function monthUsage(db: SupabaseClient, botId: string, period = currentPeriodBR()): Promise<UsageLine[]> {
  const { data, error } = await db.rpc("whatsapp_usage_summary", { p_bot_id: botId, p_period: period });
  if (error) return [];
  return ((data ?? []) as Array<{ category: string; sent: number | string; billed: number | string }>).map((r) => ({ category: r.category, sent: Number(r.sent), billed: Number(r.billed) }));
}
