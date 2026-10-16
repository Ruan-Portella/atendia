import Link from "next/link";
import { requirePermission } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agencyMonthUsage, lastMonthTotals, monthAtendimentos, sizeLabel, type BotMonthUsage, type BotQuotaStatus } from "@/lib/atendimentos";
import { ATENDIMENTO_DEFINITION, quotaPhase, suggestSize, type SizeSuggestion } from "@/lib/quota";
import { BOT_SIZES, OVERAGE_PRICE_BRL, brlCents, num } from "@/lib/plans";
import { currentPeriodBR, periodLabel } from "@/lib/report";
import { CATEGORY_LABEL, referencePrices } from "@/lib/whatsapp-usage";
import { cn } from "@/lib/utils";
import { Kpi } from "@/components/kpi";
import { BillingTabs } from "@/components/billing-tabs";
import { OverageForm } from "@/components/overage-form";

export const metadata = { title: "Uso e custo" };

const money = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(v);

/** Situação de um chatbot: parado (só humano), no excedente, perto da cota (80% ou mais) ou normal. */
function quotaState(b: BotQuotaStatus): "cheia" | "excedente" | "perto" | "ok" {
  const phase = quotaPhase(b);
  if (phase === "parado" && b.quota > 0) return "cheia";
  if (phase === "excedente") return "excedente";
  return b.quota > 0 && b.used >= Math.ceil(b.quota * 0.8) ? "perto" : "ok";
}

/** Teto sugerido para quem liga o excedente: o preço do tamanho (o mês sai no máximo pelo dobro). */
function defaultCap(b: BotQuotaStatus): number {
  if (b.size === "volume") return Math.max(1, b.volumePacks ?? 1) * BOT_SIZES.volume.priceBrl;
  return b.size ? BOT_SIZES[b.size].priceBrl : BOT_SIZES.P.priceBrl;
}

const suggestionText = (s: SizeSuggestion) => (s.size === "volume" ? `o Volume com ${s.volumePacks} pacote${s.volumePacks === 1 ? "" : "s"}` : `o ${s.size}`);

/**
 * Cobrança → Uso e custo: os atendimentos do mês de cada chatbot contra a cota do tamanho dele, o
 * excedente (ligar e escolher o teto; com a sugestão de tamanho pelo mês passado), o custo estimado da Meta (só informativo: a Meta cobra o negócio direto) e as mensagens. O custo
 * de IA não aparece para a agência.
 */
export default async function UsoPage() {
  const { agency, usage, quota, bots } = await requirePermission("billing");
  const period = currentPeriodBR();
  const supabase = await createClient();
  const db = createAdminClient();
  const [rows, total, lastMonth, { data: clientData }, { data: usageRow }] = await Promise.all([
    agencyMonthUsage(db, agency.id, period),
    monthAtendimentos(db, agency.id, period),
    lastMonthTotals(db, agency.id, period),
    supabase.from("clients").select("id, name").eq("agency_id", agency.id).order("name"),
    // contatos em campanhas e lembretes no mês (leva B3): só informativo, não é limite
    db.from("usage").select("campaign_contacts").eq("agency_id", agency.id).eq("period", period).maybeSingle(),
  ]);
  const clients = (clientData ?? []) as Array<{ id: string; name: string }>;
  const usageOf = new Map(rows.map((r) => [r.botId, r]));

  // custo da Meta: mensagens cobradas × preço de referência por categoria
  const prices = referencePrices();
  const metaCost = (billed: Record<string, number> | undefined) => Object.entries(billed ?? {}).reduce((t, [c, n]) => t + (prices[c] ?? 0) * n, 0);
  const byCategory = new Map<string, number>();
  for (const r of rows) for (const [c, n] of Object.entries(r.metaBilled)) byCategory.set(c, (byCategory.get(c) ?? 0) + n);
  const categories = [...byCategory].filter(([, n]) => n > 0);
  const metaTotal = categories.reduce((t, [c, n]) => t + (prices[c] ?? 0) * n, 0);
  const unpriced = categories.filter(([c]) => prices[c] === undefined).map(([c]) => CATEGORY_LABEL[c] ?? c);
  const messages = rows.reduce((t, r) => t + r.messages, 0);

  const full = bots.filter((b) => quotaState(b) === "cheia");
  const extra = bots.reduce((t, b) => t + b.overageUsed, 0);
  // atendimentos de chatbots que já foram excluídos continuam no total do mês
  const removed = Math.max(0, total - usage - extra);
  const botsOf = (clientId: string | null) => bots.filter((b) => b.clientId === clientId).sort((a, b) => b.used - a.used);
  const loose = botsOf(null);

  return (
    <div className="max-w-[960px]">
      <h1 className="text-2xl font-bold sm:text-[28px]">Cobrança</h1>
      <BillingTabs active="/painel/cobranca/uso" />

      <p className="mt-5 text-sm text-muted">
        Uso de <strong className="text-ink">{periodLabel(period)}</strong> (mês civil, horário de Brasília). Cada chatbot tem a própria cota, pelo tamanho dele. Você recebe e-mail quando um chatbot chega a 80%, 95% e 100% da cota. Com o excedente ligado, a cota cheia não para o chatbot: cada atendimento a mais custa {brlCents(OVERAGE_PRICE_BRL)}, cobrado no fim do mês, até o teto que você escolher.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Atendimentos do mês" value={`${num(usage)} / ${num(quota)}`} sub={extra > 0 ? `mais ${num(extra)} no excedente (${brlCents(extra * OVERAGE_PRICE_BRL)})` : `somando a cota dos ${num(bots.length)} chatbots`} />
        <Kpi label="Mensagens no mês" value={num(messages)} sub="enviadas e recebidas, em todos os canais" />
        <Kpi label="Custo estimado da Meta" value={money(metaTotal)} sub="WhatsApp; a Meta cobra direto do cliente" />
        <Kpi label="Contatos em campanhas" value={num(Number(usageRow?.campaign_contacts) || 0)} sub="campanhas e lembretes; não contam na cota" />
      </div>

      {full.length > 0 && (
        <div className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {full.length === 1 ? `${full[0].name} está` : `${full.length} chatbots estão`} no modo só humano até o mês virar: a cota acabou (ou o teto do excedente). Quem começa um atendimento novo {full.length === 1 ? "nele" : "neles"} não recebe resposta da IA (as mensagens chegam em Conversas). Os outros chatbots seguem normais.
        </div>
      )}

      <details className="card mt-4 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold">O que conta como atendimento</summary>
        <p className="mt-2 text-ink-2">{ATENDIMENTO_DEFINITION}</p>
        <p className="mt-2 text-ink-2">
          Cota cheia: só aquele chatbot entra no modo só humano até o mês virar. A conversa continua gravada, a IA não é chamada e a sua equipe responde pelo painel. Quem já estava sendo atendido segue até completar 24 horas ou 40 respostas. Para o chatbot voltar na hora, suba o tamanho dele ou ligue o excedente.
        </p>
        <p className="mt-2 text-ink-2">
          Excedente: vem desligado. Ligado, cada atendimento além da cota custa {brlCents(OVERAGE_PRICE_BRL)} e é cobrado no fim do mês, até o teto de gasto que você escolher para aquele chatbot. No teto, ele entra no modo só humano. Quando o excedente sai mais caro que o tamanho de cima, mostramos aqui a sugestão.
        </p>
      </details>

      <h2 className="mt-8 text-lg font-bold">Por cliente e chatbot</h2>
      <div className="card mt-3 overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line-2 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              <th className="px-4 py-2 font-semibold">Cliente / chatbot</th>
              <th className="px-3 py-2 font-semibold">Tamanho</th>
              <th className="px-3 py-2 text-right font-semibold">Atendimentos</th>
              <th className="px-3 py-2 text-right font-semibold">Excedente</th>
              <th className="px-3 py-2 text-right font-semibold">Mensagens</th>
              <th className="px-4 py-2 text-right font-semibold">Custo da Meta</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const list = botsOf(c.id);
              if (!list.length) return null;
              return [
                <tr key={c.id} className="border-b border-line-2 bg-ground/60">
                  <td className="px-4 py-2 font-semibold">{c.name}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right font-semibold tabular">
                    {num(list.reduce((t, b) => t + b.used, 0))} / {num(list.reduce((t, b) => t + b.quota, 0))}
                  </td>
                  <td className="px-3 py-2 text-right tabular">{list.some((b) => b.overageUsed > 0) ? `+${num(list.reduce((t, b) => t + b.overageUsed, 0))}` : ""}</td>
                  <td className="px-3 py-2 text-right tabular">{num(list.reduce((t, b) => t + (usageOf.get(b.botId)?.messages ?? 0), 0))}</td>
                  <td className="px-4 py-2 text-right tabular">{money(list.reduce((t, b) => t + metaCost(usageOf.get(b.botId)?.metaBilled), 0))}</td>
                </tr>,
                ...list.map((b) => <BotLine key={b.botId} bot={b} usage={usageOf.get(b.botId)} cost={metaCost(usageOf.get(b.botId)?.metaBilled)} lastMonth={lastMonth.get(b.botId) ?? 0} />),
              ];
            })}
            {loose.map((b) => <BotLine key={b.botId} bot={b} usage={usageOf.get(b.botId)} cost={metaCost(usageOf.get(b.botId)?.metaBilled)} lastMonth={lastMonth.get(b.botId) ?? 0} suffix=" (sem cliente)" />)}
            {removed > 0 && (
              <tr className="border-b border-line-2 last:border-0 text-muted">
                <td className="px-4 py-2 pl-8">Chatbots excluídos neste mês</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular">{num(removed)}</td>
                <td className="px-3 py-2" colSpan={3} />
              </tr>
            )}
            {bots.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-muted">Nenhum chatbot ainda.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {categories.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Meta no mês, mensagens cobradas: {categories.map(([c, n]) => `${CATEGORY_LABEL[c] ?? c} ${num(n)}`).join(" · ")}. Estimativa pela tabela de referência; o valor real está na fatura da Meta do cliente.
          {unpriced.length > 0 && ` Sem preço de referência (fora da estimativa): ${unpriced.join(", ")}.`}
        </p>
      )}
    </div>
  );
}

function BotLine({ bot, usage, cost, lastMonth, suffix = "" }: { bot: BotQuotaStatus; usage: BotMonthUsage | undefined; cost: number; lastMonth: number; suffix?: string }) {
  const state = quotaState(bot);
  // sob medida fica fora da sugestão (o preço foi combinado)
  const suggestion = bot.override === null ? suggestSize({ size: bot.size, volumePacks: bot.volumePacks }, lastMonth) : null;
  return (
    <tr className="border-b border-line-2 last:border-0">
      <td className="px-4 py-2 pl-8">
        <Link href={`/painel/bots/${bot.botId}`} className="hover:underline">{bot.name}{suffix}</Link>
      </td>
      <td className="px-3 py-2 text-ink-2">
        {sizeLabel(bot)}
        {suggestion && (
          <span className="block max-w-[200px] text-xs text-amber-ink">
            Com o uso do mês passado ({num(lastMonth)}), {suggestionText(suggestion)} sairia {brlCents(suggestion.savingBrl)} mais barato.
          </span>
        )}
      </td>
      <td className={cn("px-3 py-2 text-right tabular", state === "cheia" && "font-semibold text-danger", (state === "perto" || state === "excedente") && "font-semibold text-amber-ink")}>
        {num(bot.used)} / {num(bot.quota)}
        {state === "cheia" && <span className="block text-xs font-normal">modo só humano</span>}
        {state === "excedente" && <span className="block text-xs font-normal">no excedente</span>}
      </td>
      <td className="px-3 py-2 text-right">
        {bot.quota > 0 ? (
          <OverageForm botId={bot.botId} enabled={bot.overageEnabled} capBrl={bot.overageCapBrl} defaultCap={defaultCap(bot)} used={bot.overageUsed} max={bot.overageMax} />
        ) : (
          <span className="text-xs text-muted">escolha um tamanho</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular">{num(usage?.messages ?? 0)}</td>
      <td className="px-4 py-2 text-right tabular">{money(cost)}</td>
    </tr>
  );
}
