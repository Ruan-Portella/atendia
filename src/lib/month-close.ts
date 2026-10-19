import type { SupabaseClient } from "@supabase/supabase-js";
import { agenciesWithWebhooks } from "./message-events";
import { monthBoundsBR } from "./billing";
import { botQuota } from "./quota";
import { isBotSize } from "./plans";
import { overageValueBrl } from "./billing-events";
import { queueBotEvent } from "./platform-events";

/*
 * bot.month_closed (revisão de preços, parte 7): nos 3 primeiros dias do mês, o fechamento do mês
 * anterior de cada chatbot que teve tamanho ou atendimento: atendimentos, cota, atendimentos a mais
 * e o valor deles. Uma plataforma cobra os restaurantes a partir daqui. O tamanho que valeu no mês
 * vem de bot_month_close (a virada do dia 1º grava o retrato antes de trocar); sem retrato, o de
 * agora. Sai uma vez por chatbot e mês (emitted_at; o id do evento também não se repete). Só para
 * agências com webhook ativo e o pacote Integrações.
 */

export interface MonthState {
  size: string | null;
  volume_packs: number | null;
  quota_override: number | null;
  prorated_month: string | null;
  prorated_quota: number | null;
}

/** Payload do bot.month_closed. Função pura. */
export function monthClosedData(i: { period: string; state: MonthState; total: number; overage: number; next: { size: string | null; volume_packs: number | null } }) {
  return {
    month: i.period,
    size: isBotSize(i.state.size) ? i.state.size : null,
    volume_packs: i.state.size === "volume" ? i.state.volume_packs : null,
    quota: botQuota(i.state, i.period),
    atendimentos: i.total,
    overage_atendimentos: i.overage,
    overage_value_brl: overageValueBrl(i.overage),
    next: { size: isBotSize(i.next.size) ? i.next.size : null, volume_packs: i.next.size === "volume" ? i.next.volume_packs : null },
  };
}

/** Fecha o mês anterior (tarefa diária; só age nos 3 primeiros dias do mês). */
export async function emitMonthClosed(db: SupabaseClient, o: { now?: Date } = {}): Promise<{ emitted: number }> {
  const now = o.now ?? new Date();
  const cur = monthBoundsBR(now);
  if (now.getTime() - cur.start.getTime() > 3 * 86_400_000) return { emitted: 0 };
  const prev = monthBoundsBR(new Date(cur.start.getTime() - 1));
  let emitted = 0;
  for (const agencyId of await agenciesWithWebhooks(db)) {
    const [{ data: bots, error }, { data: totals, error: totalsError }] = await Promise.all([
      db.from("bots").select("id, size, volume_packs, quota_override, prorated_month, prorated_quota").eq("agency_id", agencyId).eq("is_demo", false),
      db.rpc("bot_month_atendimentos", { p_agency_id: agencyId, p_month_start: prev.start.toISOString(), p_month_end: prev.end.toISOString() }),
    ]);
    if (error || totalsError) throw new Error(`fechamento do mês: ${(error ?? totalsError)!.message}`);
    if (!bots?.length) continue;
    const { data: closes } = await db.from("bot_month_close").select("bot_id, size, volume_packs, prorated_month, prorated_quota, emitted_at").eq("month", prev.firstDay).in("bot_id", bots.map((b) => b.id as string));
    const closeOf = new Map((closes ?? []).map((c) => [c.bot_id as string, c]));
    const counted = new Map(((totals ?? []) as Array<{ bot_id: string; total: number | string; overage: number | string }>).map((r) => [r.bot_id, { total: Number(r.total) || 0, overage: Number(r.overage) || 0 }]));
    for (const b of bots) {
      const close = closeOf.get(b.id as string);
      if (close?.emitted_at) continue;
      const t = counted.get(b.id as string) ?? { total: 0, overage: 0 };
      const state: MonthState = {
        size: ((close ?? b).size as string | null) ?? null,
        volume_packs: ((close ?? b).volume_packs as number | null) ?? null,
        quota_override: (b.quota_override as number | null) ?? null,
        prorated_month: ((close ?? b).prorated_month as string | null) ?? null,
        prorated_quota: ((close ?? b).prorated_quota as number | null) ?? null,
      };
      if (!t.total && !isBotSize(state.size) && state.quota_override === null) continue;
      const data = monthClosedData({ period: prev.period, state, total: t.total, overage: t.overage, next: { size: (b.size as string | null) ?? null, volume_packs: (b.volume_packs as number | null) ?? null } });
      await queueBotEvent(db, [b.id as string], { type: "bot.month_closed", key: `${b.id}:${prev.period}`, data });
      await db.from("bot_month_close").upsert({ bot_id: b.id, month: prev.firstDay, size: state.size, volume_packs: state.volume_packs, prorated_month: state.prorated_month, prorated_quota: state.prorated_quota, emitted_at: now.toISOString() }, { onConflict: "bot_id,month" });
      emitted++;
    }
  }
  return { emitted };
}
