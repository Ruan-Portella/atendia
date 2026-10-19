import type { SupabaseClient } from "@supabase/supabase-js";
import { queueBotEvent } from "./platform-events";
import { CREDIT_LOW_SHARE, OVERAGE_PRICE_BRL, type BotSize } from "./plans";
import { emitAccountEvent } from "./webhooks";

/*
 * Webhooks de cota, excedente, tamanho e crédito (revisão de preços, parte 7; spec "Tamanho e
 * excedente pela API"). Os payloads saem daqui (funções puras) e vão pela fila dos webhooks: os do
 * chatbot por queueBotEvent; os da conta (crédito) por emitAccountEvent, só para os webhooks da
 * conta inteira. A chave de cada evento vem do fato: repetir não duplica a entrega.
 */

/** Por que o chatbot parou: cota cheia sem excedente, teto do excedente, crédito acabou ou excedente suspenso. */
export type QuotaStopReason = "cota" | "teto" | "sem_credito" | "excedente_suspenso";

export interface UsageSnapshot {
  /** Mês civil de São Paulo, "2026-10". */
  month: string;
  /** Atendimentos dentro da cota. */
  used: number;
  quota: number;
  overage: { enabled: boolean; used: number; capBrl: number | null; max: number | null };
}

const money = (v: number) => Math.round(v * 100) / 100;

/** Valor dos atendimentos a mais, em reais. Função pura. */
export const overageValueBrl = (extra: number) => money(extra * OVERAGE_PRICE_BRL);

/** O uso do mês no formato dos webhooks e da API. Função pura. */
export function usageData(u: UsageSnapshot): { month: string; used: number; quota: number; overage: { enabled: boolean; used: number; cap_brl: number | null; max: number | null; value_brl: number } } {
  return {
    month: u.month,
    used: u.used,
    quota: u.quota,
    overage: { enabled: u.overage.enabled, used: u.overage.used, cap_brl: u.overage.capBrl, max: u.overage.max, value_brl: overageValueBrl(u.overage.used) },
  };
}

/** bot.quota_warning: 80% e 95% da cota do mês. */
export const emitQuotaWarning = (db: SupabaseClient, botId: string, level: 80 | 95, u: UsageSnapshot) =>
  queueBotEvent(db, [botId], { type: "bot.quota_warning", key: `${botId}:${u.month}:${level}`, data: { level, ...usageData(u) } });

/** bot.overage_started: o primeiro atendimento a mais do mês (a cota acabou com o excedente ligado). */
export const emitOverageStarted = (db: SupabaseClient, botId: string, u: UsageSnapshot) =>
  queueBotEvent(db, [botId], { type: "bot.overage_started", key: `${botId}:${u.month}`, data: usageData(u) });

/** bot.overage_cap_warning: 80% e 95% do teto do excedente (só quando há teto). */
export const emitOverageCapWarning = (db: SupabaseClient, botId: string, level: 80 | 95, u: UsageSnapshot) =>
  queueBotEvent(db, [botId], { type: "bot.overage_cap_warning", key: `${botId}:${u.month}:${level}`, data: { level, ...usageData(u) } });

/**
 * bot.quota_reached: o chatbot parou de abrir atendimentos com a IA (modo só humano), com o
 * motivo. `episode` separa paradas do mesmo motivo no mês (crédito comprado e acabado de novo).
 */
export const emitQuotaReached = (db: SupabaseClient, botId: string, reason: QuotaStopReason, u: UsageSnapshot, episode = "") =>
  queueBotEvent(db, [botId], { type: "bot.quota_reached", key: `${botId}:${u.month}:${reason}${episode ? `:${episode}` : ""}`, data: { reason, ...usageData(u) } });

export interface SizeChangedEvent {
  /** applied: vale agora; scheduled: vale em effective_at (dia 1º); cancelled: a troca agendada saiu. */
  status: "applied" | "scheduled" | "cancelled";
  size: BotSize | null;
  volumePacks: number | null;
  previous: { size: BotSize | null; volumePacks: number | null };
  effectiveAt: string;
}

/** Payload do bot.size_changed. Função pura. */
export function sizeChangedData(e: SizeChangedEvent): Record<string, unknown> {
  return { status: e.status, size: e.size, volume_packs: e.volumePacks, previous: { size: e.previous.size, volume_packs: e.previous.volumePacks }, effective_at: e.effectiveAt };
}

/** bot.size_changed: subiu ou desceu (na hora), agendou para o dia 1º ou cancelou o agendado. */
export const emitSizeChanged = (db: SupabaseClient, botId: string, e: SizeChangedEvent) =>
  queueBotEvent(db, [botId], { type: "bot.size_changed", key: `${botId}:${e.status}:${e.effectiveAt}:${e.size ?? "none"}:${e.volumePacks ?? ""}`, data: sizeChangedData(e) });

/** bot.overage_changed: ligou, desligou, mudou o teto, ou o excedente ficou suspenso ou voltou. */
export const emitOverageChanged = (db: SupabaseClient, botId: string, o: { enabled: boolean; capBrl: number | null; suspended: "pico" | "ataque" | null }, at = new Date().toISOString()) =>
  queueBotEvent(db, [botId], { type: "bot.overage_changed", key: `${botId}:${at}`, createdAt: at, data: { enabled: o.enabled, cap_brl: o.capBrl, suspended: o.suspended } });

/** Payload dos avisos de crédito da conta. Função pura. */
export function creditEventData(leftCents: number, lastPurchaseCents: number, autoRecharge: boolean): { balance_brl: number; last_purchase_brl: number; low_threshold_brl: number; auto_recharge: boolean } {
  return { balance_brl: leftCents / 100, last_purchase_brl: lastPurchaseCents / 100, low_threshold_brl: Math.round(lastPurchaseCents * CREDIT_LOW_SHARE) / 100, auto_recharge: autoRecharge };
}

/**
 * account.credit_low (o saldo ficou abaixo de 20% da última compra) e account.credit_depleted (o
 * saldo não paga o próximo atendimento a mais). Um de cada por compra (lote mais novo).
 */
export const emitCreditAlert = (db: SupabaseClient, agencyId: string, alert: "baixo" | "acabou", lastLotId: string | null, data: ReturnType<typeof creditEventData>) =>
  emitAccountEvent(db, agencyId, { type: alert === "baixo" ? "account.credit_low" : "account.credit_depleted", key: `${agencyId}:${alert}:${lastLotId ?? "sem-lote"}`, data });

