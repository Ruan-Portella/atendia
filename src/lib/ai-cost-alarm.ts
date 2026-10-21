import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyPlatform } from "./notify";
import { noticeOnce } from "./rate-limit";
import { paidByAgency } from "./fiscal-invoices";
import { usdBrl } from "./backoffice";
import { currentPeriodBR, periodRange } from "./report";

/*
 * Alarme interno de custo de IA (spec, Infraestrutura, decisão de 25/09/2026; leva Pendências do
 * MVP, parte 5): quando o custo de IA de uma conta no mês passa de 50% da receita líquida dela no
 * mesmo mês, o Ruan recebe um e-mail. Não há teto de custo no produto e o bot nunca para por custo:
 * é só o aviso, uma vez por conta e mês. Receita líquida = o que a conta pagou no mês (as notas a
 * emitir) menos a Stripe (cerca de 4,7% + R$ 0,39 por pagamento) e o imposto (6%). Custo de IA em
 * reais pelo dólar do backoffice (USD_BRL) vezes 1,35 (IOF, spread e tributos, o cenário
 * pessimista da revisão de preços). Conta sem receita só avisa com custo de pelo menos R$ 10, para
 * não avisar das respostas de teste da conta grátis.
 */

export const AI_COST_ALARM = { ratio: 0.5, stripePct: 0.047, stripeFixedCents: 39, taxPct: 0.06, dollarFactor: 1.35, minCostBrl: 10 } as const;

/** Receita líquida em reais: o pago menos a Stripe e o imposto. Função pura. */
export function netRevenueBrl(paidCents: number, payments: number): number {
  const gross = paidCents / 100;
  return Math.max(0, gross - gross * AI_COST_ALARM.stripePct - (payments * AI_COST_ALARM.stripeFixedCents) / 100 - gross * AI_COST_ALARM.taxPct);
}

/** O custo passa do alarme? Função pura. */
export function overAlarm(costBrl: number, netBrl: number): boolean {
  return costBrl >= AI_COST_ALARM.minCostBrl && costBrl > netBrl * AI_COST_ALARM.ratio;
}

/** A conferência do mês corrente (cron diário, depois dos totais de IA). */
export async function checkAiCostAlarm(db: SupabaseClient, now = new Date()): Promise<{ checked: number; alarms: string[] }> {
  const period = currentPeriodBR(now);
  const { from, to } = periodRange(period);
  const [{ data: usage, error }, paid] = await Promise.all([db.from("ai_usage_monthly").select("agency_id, cost_usd").eq("period", period), paidByAgency(db, from, to)]);
  if (error) throw new Error(`custo de IA: ${error.message}`);
  const cost = new Map<string, number>();
  for (const r of usage ?? []) cost.set(r.agency_id as string, (cost.get(r.agency_id as string) ?? 0) + Number(r.cost_usd ?? 0));
  const dollar = usdBrl() * AI_COST_ALARM.dollarFactor;
  const alarms: string[] = [];
  for (const [agencyId, usd] of cost) {
    const costBrl = usd * dollar;
    const p = paid.get(agencyId) ?? { cents: 0, payments: 0 };
    const net = netRevenueBrl(p.cents, p.payments);
    if (!overAlarm(costBrl, net)) continue;
    if (!(await noticeOnce(db, { key: `ia-custo:${agencyId}:${period}`, max: 1, windowSeconds: 40 * 86_400, message: "" }))) continue;
    const { data: agency } = await db.from("agencies").select("name").eq("id", agencyId).maybeSingle();
    const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const line = `${agency?.name ?? agencyId}: custo de IA de ${brl(costBrl)} (US$ ${usd.toFixed(2)}) contra ${brl(net)} de receita líquida em ${period}`;
    alarms.push(line);
    await notifyPlatform(`Custo de IA acima de 50% da receita: ${agency?.name ?? agencyId}`, [
      line,
      "O bot não para por custo: veja em /admin/custos qual chatbot e qual tipo de chamada (resposta, foto, áudio) puxam o custo e se o tamanho do chatbot cobre o uso.",
      "Este aviso vai uma vez por conta e mês.",
    ]).catch(() => false);
  }
  return { checked: cost.size, alarms };
}
