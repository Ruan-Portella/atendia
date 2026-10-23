import Link from "next/link";
import { requirePermission } from "@/lib/agency";
import { FirstWeekNote } from "@/components/first-week-note";
import { firstWeekUntil } from "@/lib/withdrawal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agencyMonthUsage, lastMonthTotals, monthAtendimentos, sizeLabel, type BotQuotaStatus } from "@/lib/atendimentos";
import { ATENDIMENTO_DEFINITION, quotaPhase, suggestSize, type SizeSuggestion } from "@/lib/quota";
import { OVERAGE_PRICE_BRL, brlCents, num } from "@/lib/plans";
import { currentPeriodBR, periodLabel } from "@/lib/report";
import { CATEGORY_LABEL, referencePrices } from "@/lib/whatsapp-usage";
import { Kpi } from "@/components/kpi";
import { HowItWorks } from "@/components/ui/form-section";
import { UsageList, type UsageRow } from "@/components/usage-list";
import { setBotOverage } from "@/app/painel/actions";
import { resolveSpike } from "../actions";
import { renewalLabel } from "@/lib/billing";

export const metadata = { title: "Uso e custo" };

const money = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(v);
const capField = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ","));

/** Situação de um chatbot: parado (só humano), no excedente, perto da cota (80% ou mais) ou normal. */
function quotaState(b: BotQuotaStatus): "cheia" | "excedente" | "perto" | "ok" {
  const phase = quotaPhase(b);
  if (phase === "parado" && b.quota > 0) return "cheia";
  if (phase === "excedente") return "excedente";
  return b.quota > 0 && b.used >= Math.ceil(b.quota * 0.8) ? "perto" : "ok";
}

const suggestionText = (s: SizeSuggestion) => (s.size === "volume" ? `o Volume com ${s.volumePacks} pacote${s.volumePacks === 1 ? "" : "s"}` : `o ${s.size}`);

/**
 * Cobrança → Uso e custo: os atendimentos do mês de cada chatbot contra a cota do tamanho dele, o
 * excedente (ligar e escolher o teto; com a sugestão de tamanho pelo mês passado), o custo estimado da Meta (só informativo: a Meta cobra o negócio direto) e as mensagens. O custo
 * de IA não aparece para a agência. Redesenho, etapa 5: a lista por cliente com a barra da cota e o
 * excedente num modal (UsageList), no lugar da tabela larga com os formulários.
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
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
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
  // por cliente (na ordem do nome), os chatbots que mais usam primeiro; os sem cliente por último
  const order = new Map(clients.map((c, i) => [c.id, i]));
  const list: UsageRow[] = [...bots]
    .sort((a, b) => (order.get(a.clientId ?? "") ?? 1e9) - (order.get(b.clientId ?? "") ?? 1e9) || b.used - a.used)
    .map((b) => {
      const suggestion = b.override === null ? suggestSize({ size: b.size, volumePacks: b.volumePacks }, lastMonth.get(b.botId) ?? 0) : null;
      const ai = !(b.size === "atendimento" && b.override === null) && b.quota > 0;
      return {
        botId: b.botId,
        name: b.name,
        clientId: b.clientId,
        clientName: b.clientId ? (clientName.get(b.clientId) ?? null) : null,
        size: sizeLabel(b),
        ai,
        used: b.used,
        quota: b.quota,
        state: quotaState(b),
        // sem excedente: o Atendimento não tem IA; sem tamanho, não tem cota
        note: ai ? null : b.size === "atendimento" && b.override === null ? "sem IA" : "escolha um tamanho",
        messages: usageOf.get(b.botId)?.messages ?? 0,
        metaCost: money(metaCost(usageOf.get(b.botId)?.metaBilled)),
        suggestion: suggestion ? `Com o uso do mês passado (${num(lastMonth.get(b.botId) ?? 0)}), ${suggestionText(suggestion)} sairia ${brlCents(suggestion.savingBrl)} mais barato.` : null,
        overage: ai
          ? {
              enabled: b.overageEnabled,
              cap: b.overageCapBrl ? capField(b.overageCapBrl) : "",
              used: b.overageUsed,
              usedText: `${b.overageCapMax !== null ? `${num(b.overageUsed)} de ${num(b.overageCapMax)} a mais` : `${num(b.overageUsed)} a mais`}, ${brlCents(b.overageUsed * OVERAGE_PRICE_BRL)} do crédito`,
              creditShort: b.creditShort,
              suspended: b.overageSuspended ?? null,
            }
          : null,
      };
    });

  return (
    <div className="flex max-w-[960px] flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-normal sm:text-[28px]">Uso e custo</h1>
        <p className="text-sm text-muted">
          {periodLabel(period).replace(/^./, (c) => c.toUpperCase())} (mês civil, horário de Brasília). Cada chatbot tem a própria cota, pelo tamanho dele; o e-mail avisa em 80%, 95% e 100%.
        </p>
        <HowItWorks label="O que conta como atendimento e o excedente">
          <p>{ATENDIMENTO_DEFINITION}</p>
          <p>Cota cheia: só aquele chatbot entra no modo só humano até o mês virar. A conversa continua gravada, a IA não é chamada e a sua equipe responde pelo painel. Quem já estava sendo atendido segue até completar 24 horas ou 40 respostas. Para o chatbot voltar na hora, suba o tamanho dele ou ligue o excedente.</p>
          <p>
            Excedente: vem desligado. Ligado, cada atendimento além da cota usa {brlCents(OVERAGE_PRICE_BRL)} do{" "}
            <Link href="/painel/cobranca/credito" className="font-medium text-brand hover:underline">
              crédito pré-pago da conta
            </Link>
            , na hora. O teto do mês de cada chatbot é opcional, para um chatbot não gastar o crédito todo. Sem crédito, no teto, ou com o excedente suspenso por um pico no chat do site, ele entra no modo só humano. Quando o excedente sai mais caro que o tamanho de cima, a sugestão aparece embaixo do chatbot.
          </p>
        </HowItWorks>
      </div>
      <div className="[&>p]:mt-0 empty:hidden">
        <FirstWeekNote until={firstWeekUntil(agency)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Atendimentos do mês" value={`${num(usage)} / ${num(quota)}`} sub={extra > 0 ? `mais ${num(extra)} no excedente (${brlCents(extra * OVERAGE_PRICE_BRL)} do crédito)` : `somando a cota dos ${num(bots.length)} chatbots`} />
        <Kpi label="Mensagens no mês" value={num(messages)} sub="enviadas e recebidas, em todos os canais" />
        <Kpi label="Custo estimado da Meta" value={money(metaTotal)} sub="WhatsApp; a Meta cobra direto do cliente" />
        <Kpi label="Contatos em campanhas" value={num(Number(usageRow?.campaign_contacts) || 0)} sub="campanhas e lembretes; não contam na cota" />
      </div>

      {full.length > 0 && (
        <p className="card border-danger-line px-4 py-3 text-sm text-danger">
          {full.length === 1 ? `${full[0].name} está` : `${full.length} chatbots estão`} no modo só humano: a cota acabou (sem excedente, no teto, sem crédito ou com o excedente suspenso). Quem começa um atendimento novo {full.length === 1 ? "nele" : "neles"} não recebe resposta da IA (as mensagens chegam na Caixa de entrada). Os outros seguem normais.
        </p>
      )}

      <UsageList rows={list} removed={removed} renewal={renewalLabel()} setOverage={setBotOverage} resolveSpike={resolveSpike} />

      {categories.length > 0 && (
        <p className="text-xs text-muted">
          Meta no mês, mensagens cobradas: {categories.map(([c, n]) => `${CATEGORY_LABEL[c] ?? c} ${num(n)}`).join(" · ")}. Estimativa pela tabela de referência; o valor real está na fatura da Meta do cliente.
          {unpriced.length > 0 && ` Sem preço de referência (fora da estimativa): ${unpriced.join(", ")}.`}
        </p>
      )}
    </div>
  );
}
