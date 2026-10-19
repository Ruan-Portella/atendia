import type { SupabaseClient } from "@supabase/supabase-js";
import { botQuotaStatus, type BotQuotaStatus } from "./atendimentos";
import { monthBoundsBR } from "./billing";
import { overageValueBrl } from "./billing-events";
import { quotaPhase, suggestSize } from "./quota";
import { shiftPeriod } from "./report";
import { currentPeriodBR, monthStartBR } from "./utils";

/*
 * Uso de um chatbot pela API (revisão de preços, parte 7; GET /v1/bots/{id}/usage e a resposta do
 * PATCH): tamanho, cota e uso do mês, projeção, média dos meses anteriores, tamanho sugerido, troca
 * agendada e o excedente.
 */

/** Projeção do mês: o ritmo até agora levado ao mês inteiro (conta pelo menos 1 dia corrido). Função pura. */
export function monthProjection(total: number, now: Date, bounds: { start: Date; end: Date }): number {
  const length = bounds.end.getTime() - bounds.start.getTime();
  const elapsed = Math.min(length, Math.max(86_400_000, now.getTime() - bounds.start.getTime()));
  return Math.round((total * length) / elapsed);
}

/** Média dos meses com atendimento (null sem nenhum). Função pura. */
export function monthsAverage(totals: number[]): number | null {
  const withUse = totals.filter((t) => t > 0);
  return withUse.length ? Math.round(withUse.reduce((a, b) => a + b, 0) / withUse.length) : null;
}

/** O uso no formato da API. Função pura. */
export function usageJson(s: BotQuotaStatus, o: { period: string; projection: number; average: number | null; scheduledFrom: string | null }) {
  const suggestion = suggestSize({ size: s.size, volumePacks: s.volumePacks }, o.average ?? o.projection);
  return {
    bot_id: `bot_${s.botId}`,
    month: o.period,
    size: s.size,
    volume_packs: s.size === "volume" ? s.volumePacks : null,
    custom_quota: s.override,
    quota: s.quota,
    used: s.used,
    status: quotaPhase({ quota: s.quota, used: s.used, overageEnabled: s.overageEnabled, overageUsed: s.overageUsed, overageMax: s.overageMax }),
    projection: o.projection,
    average_3_months: o.average,
    suggested_size: suggestion ? { size: suggestion.size, volume_packs: suggestion.volumePacks, monthly_brl: suggestion.monthlyBrl, saving_brl: suggestion.savingBrl } : null,
    scheduled: s.pendingSize
      ? { size: s.pendingSize === "none" ? null : s.pendingSize, volume_packs: s.pendingSize === "volume" ? s.pendingVolumePacks : null, effective_at: o.scheduledFrom }
      : null,
    overage: { enabled: s.overageEnabled, cap_brl: s.overageCapBrl, used: s.overageUsed, max: s.overageCapMax, value_brl: overageValueBrl(s.overageUsed), suspended: s.overageSuspended },
  };
}

export type BotUsageJson = ReturnType<typeof usageJson>;

/** Uso de um chatbot da agência agora (null: não existe ou é demo). Service role. */
export async function botUsage(db: SupabaseClient, agencyId: string, botId: string, now = new Date()): Promise<BotUsageJson | null> {
  const period = currentPeriodBR();
  const status = (await botQuotaStatus(db, agencyId, period)).find((b) => b.botId === botId);
  if (!status) return null;
  const months = [1, 2, 3].map((k) => shiftPeriod(period, -k));
  const [totals, { data: pending }] = await Promise.all([
    Promise.all(
      months.map(async (p) => {
        const { data, error } = await db.rpc("bot_month_atendimentos", { p_agency_id: agencyId, p_month_start: monthStartBR(p).toISOString(), p_month_end: monthStartBR(shiftPeriod(p, 1)).toISOString() });
        if (error) throw new Error(`uso do chatbot: ${error.message}`);
        const row = ((data ?? []) as Array<{ bot_id: string; total: number | string }>).find((r) => r.bot_id === botId);
        return Number(row?.total) || 0;
      }),
    ),
    db.from("bots").select("pending_from").eq("id", botId).maybeSingle(),
  ]);
  const total = status.used + status.overageUsed;
  return usageJson(status, { period, projection: monthProjection(total, now, monthBoundsBR(now)), average: monthsAverage(totals), scheduledFrom: (pending?.pending_from as string | null) ?? null });
}
