import { invalidRequest, type ApiContext } from "./api-v1";
import { requireClient, requirePlatform } from "./api-provisioning";
import { agencyMonthUsage, type BotMonthUsage } from "./atendimentos";
import { creditBalance, OVERAGE_PRICE_CENTS } from "./billing-credit";
import { referencePrices } from "./whatsapp-usage";
import { currentPeriodBR, monthStartBR } from "./utils";
import { shiftPeriod } from "./report";

/*
 * GET /v1/usage (D', parte 4d, 19/10/2026; spec, "API de provisionamento"), permissão
 * provisioning, pacote Plataforma: o uso do mês por cliente e por chatbot (atendimentos, mensagens,
 * contatos em campanhas e o custo estimado da Meta, sem o custo de IA, que é interno), só dos
 * chatbots do escopo da chave. Com chave da conta inteira, também os campos da conta: os
 * atendimentos a mais (excedente) do mês, o valor deles e o saldo de crédito. O custo da Meta é só
 * informativo: a Meta cobra direto do negócio.
 */

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

const round2 = (n: number) => Math.round(n * 100) / 100;

interface Totals {
  atendimentos: number;
  messages: number;
  campaign_contacts: number;
  meta_billed: Record<string, number>;
  meta_cost_estimate_brl: number;
}

/** Os totais de um grupo de chatbots, com o custo da Meta pelo preço de referência. Pura. */
export function usageTotals(rows: BotMonthUsage[], prices: Record<string, number>): Totals {
  const billed: Record<string, number> = {};
  let atendimentos = 0;
  let messages = 0;
  let campaign = 0;
  for (const r of rows) {
    atendimentos += r.atendimentos;
    messages += r.messages;
    campaign += r.campaignContacts;
    for (const [c, n] of Object.entries(r.metaBilled)) billed[c] = (billed[c] ?? 0) + n;
  }
  const cost = Object.entries(billed).reduce((t, [c, n]) => t + (prices[c] ?? 0) * n, 0);
  return { atendimentos, messages, campaign_contacts: campaign, meta_billed: billed, meta_cost_estimate_brl: round2(cost) };
}

export async function getUsage(req: Request, api: ApiContext): Promise<Response> {
  await requirePlatform(api);
  const q = new URL(req.url).searchParams;
  const month = q.get("month") || currentPeriodBR();
  if (!PERIOD.test(month)) throw invalidRequest("month no formato AAAA-MM, como 2026-10 (o mês civil de São Paulo).", { field: "month" });
  const clientId = q.get("client_id") ? await requireClient(api, q.get("client_id")) : null;
  const botId = q.get("bot_id") ? api.requireBot(q.get("bot_id")) : null;
  const db = api.db;
  const scope = new Set(api.botIds);
  const [rows, { data: bots }, { data: clients }] = await Promise.all([
    agencyMonthUsage(db, api.key.agency_id, month),
    db.from("bots").select("id, name, external_id, client_id").eq("agency_id", api.key.agency_id).eq("is_demo", false).eq("is_template", false),
    db.from("clients").select("id, name, external_id").eq("agency_id", api.key.agency_id),
  ]);
  const visible = rows.filter((r) => scope.has(r.botId) && (!clientId || r.clientId === clientId) && (!botId || r.botId === botId));
  const bot = new Map((bots ?? []).map((b) => [b.id as string, b]));
  const client = new Map((clients ?? []).map((c) => [c.id as string, c]));
  const prices = referencePrices();
  const groups = new Map<string, BotMonthUsage[]>();
  for (const r of visible) groups.set(r.clientId ?? "", [...(groups.get(r.clientId ?? "") ?? []), r]);
  const body: Record<string, unknown> = {
    month,
    clients: [...groups.entries()].map(([cid, list]) => {
      const c = cid ? client.get(cid) : null;
      return {
        client_id: cid ? `cli_${cid}` : null,
        external_id: (c?.external_id as string | null | undefined) ?? null,
        name: (c?.name as string | undefined) ?? null,
        ...usageTotals(list, prices),
        bots: list.map((r) => {
          const b = bot.get(r.botId);
          return { bot_id: `bot_${r.botId}`, external_id: (b?.external_id as string | null | undefined) ?? null, name: (b?.name as string | undefined) ?? null, ...usageTotals([r], prices) };
        }),
      };
    }),
  };
  // campos da conta: só com a chave da conta inteira
  if (api.scopeAll && !clientId && !botId) {
    const { data: extra, error } = await db.rpc("bot_month_atendimentos", { p_agency_id: api.key.agency_id, p_month_start: monthStartBR(month).toISOString(), p_month_end: monthStartBR(shiftPeriod(month, 1)).toISOString() });
    if (error) throw new Error(`excedente do mês: ${error.message}`);
    const overage = ((extra ?? []) as Array<{ overage: number | string }>).reduce((t, r) => t + (Number(r.overage) || 0), 0);
    body.account = { ...usageTotals(rows.filter((r) => scope.has(r.botId)), prices), overage_atendimentos: overage, overage_value_brl: round2((overage * OVERAGE_PRICE_CENTS) / 100), credit_balance_brl: (await creditBalance(db, api.key.agency_id)) / 100 };
  }
  return Response.json(body);
}
