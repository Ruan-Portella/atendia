import Link from "next/link";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agencyMonthUsage, clientMonthAtendimentos, type BotMonthUsage } from "@/lib/atendimentos";
import { ATENDIMENTO_DEFINITION, hardLimitOf } from "@/lib/quota";
import { num } from "@/lib/plans";
import { currentPeriodBR, periodLabel } from "@/lib/report";
import { CATEGORY_LABEL, referencePrices } from "@/lib/whatsapp-usage";
import { cn } from "@/lib/utils";
import { Kpi } from "@/components/kpi";
import { BillingTabs } from "@/components/billing-tabs";
import { ClientCapForm } from "@/components/client-cap-form";
import { setClientQuotaCap } from "../../actions";

export const metadata = { title: "Uso e custo" };

const money = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(v);

interface ClientRow {
  id: string;
  name: string;
  monthly_quota_cap: number | null;
}

/**
 * Cobrança → Uso e custo (L1): atendimentos do mês contra a cota, custo estimado da Meta (só
 * informativo: a Meta cobra o negócio direto) e a tabela por cliente e chatbot, com o sublimite
 * editável. O custo de IA não aparece para a agência.
 */
export default async function UsoPage() {
  const { agency, usage, quota } = await requireAgency();
  const period = currentPeriodBR();
  const supabase = await createClient();
  const db = createAdminClient();
  const [rows, byClient, { data: clientData }, { data: botData }] = await Promise.all([
    agencyMonthUsage(db, agency.id, period),
    clientMonthAtendimentos(db, agency.id, period),
    supabase.from("clients").select("id, name, monthly_quota_cap").eq("agency_id", agency.id).order("name"),
    supabase.from("bots").select("id, name").eq("agency_id", agency.id).eq("is_demo", false),
  ]);
  const clients = (clientData ?? []) as ClientRow[];
  const botName = new Map((botData ?? []).map((b) => [b.id as string, b.name as string]));

  // custo da Meta: mensagens cobradas × preço de referência por categoria
  const prices = referencePrices();
  const metaCost = (billed: Record<string, number>) => Object.entries(billed).reduce((t, [c, n]) => t + (prices[c] ?? 0) * n, 0);
  const byCategory = new Map<string, number>();
  for (const r of rows) for (const [c, n] of Object.entries(r.metaBilled)) byCategory.set(c, (byCategory.get(c) ?? 0) + n);
  const categories = [...byCategory].filter(([, n]) => n > 0);
  const metaTotal = categories.reduce((t, [c, n]) => t + (prices[c] ?? 0) * n, 0);
  const unpriced = categories.filter(([c]) => prices[c] === undefined).map(([c]) => CATEGORY_LABEL[c] ?? c);
  const messages = rows.reduce((t, r) => t + r.messages, 0);

  const hard = hardLimitOf(quota);
  const pct = quota ? Math.round((usage / quota) * 100) : 0;
  const state =
    usage >= hard
      ? "Modo só humano até o mês virar"
      : usage >= quota
        ? `Cota atingida: na tolerância, até ${num(hard)}`
        : `${pct}% da cota · tolerância de 10% até ${num(hard)}`;
  // atendimentos de chatbots que já foram excluídos continuam contando no mês
  const removed = Math.max(0, usage - rows.reduce((t, r) => t + r.atendimentos, 0));

  const botsOf = (clientId: string | null) => rows.filter((r) => r.clientId === clientId).sort((a, b) => b.atendimentos - a.atendimentos);
  const loose = botsOf(null);
  const sum = (list: BotMonthUsage[], k: "messages" | "atendimentos") => list.reduce((t, r) => t + r[k], 0);

  return (
    <div className="max-w-[960px]">
      <h1 className="text-2xl font-bold sm:text-[28px]">Cobrança</h1>
      <BillingTabs active="/painel/cobranca/uso" />

      <p className="mt-5 text-sm text-muted">
        Uso de <strong className="text-ink">{periodLabel(period)}</strong> (mês civil, horário de Brasília). Você recebe e-mail em 80% e 100% da cota e do limite de cada cliente.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Kpi label="Atendimentos do mês" value={`${num(usage)} / ${num(quota)}`} sub={state} />
        <Kpi label="Mensagens no mês" value={num(messages)} sub="enviadas e recebidas, em todos os canais" />
        <Kpi label="Custo estimado da Meta" value={money(metaTotal)} sub="WhatsApp; a Meta cobra direto do cliente" />
      </div>

      {usage >= quota && (
        <div className={cn("mt-4 rounded-lg px-3 py-2 text-sm", usage >= hard ? "bg-danger-soft text-danger" : "bg-amber-soft text-amber-ink")}>
          {usage >= hard
            ? "A cota e a tolerância do mês acabaram: quem começa um atendimento novo não recebe resposta da IA (as mensagens chegam em Conversas). Atendimentos já abertos seguem até completar 24 horas."
            : `A cota do plano acabou e a conta está na tolerância de 10%. Depois de ${num(hard)} atendimentos, entra no modo só humano até o mês virar.`}{" "}
          <Link href="/painel/cobranca" className="font-semibold underline">Ver planos</Link>
        </div>
      )}

      <details className="card mt-4 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold">O que conta como atendimento</summary>
        <p className="mt-2 text-ink-2">{ATENDIMENTO_DEFINITION}</p>
        <p className="mt-2 text-ink-2">
          Passando da cota, vale uma tolerância de 10% uma vez por mês. Depois, a conta entra no modo só humano: a conversa continua gravada, a IA não é chamada e a sua equipe responde pelo painel. Atendimento já aberto vai até o fim das 24 horas.
        </p>
      </details>

      <h2 className="mt-8 text-lg font-bold">Por cliente e chatbot</h2>
      <p className="text-sm text-muted">
        Limite do cliente: um teto de atendimentos por mês só para ele (vazio = sem limite, usa a cota da agência). Passando dele, só os chatbots desse cliente entram no modo só humano.
      </p>
      <div className="card mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line-2 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              <th className="px-4 py-2 font-semibold">Cliente / chatbot</th>
              <th className="px-3 py-2 text-right font-semibold">Atendimentos</th>
              <th className="px-3 py-2 text-right font-semibold">Mensagens</th>
              <th className="px-3 py-2 text-right font-semibold">Custo da Meta</th>
              <th className="px-4 py-2 text-right font-semibold">Limite do cliente</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const bots = botsOf(c.id);
              const used = byClient.get(c.id) ?? 0;
              const near = c.monthly_quota_cap !== null && used >= Math.ceil(c.monthly_quota_cap * 0.8);
              return [
                <tr key={c.id} className="border-b border-line-2 bg-ground/60">
                  <td className="px-4 py-2 font-semibold">{c.name}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular">{num(used)}</td>
                  <td className="px-3 py-2 text-right tabular">{num(sum(bots, "messages"))}</td>
                  <td className="px-3 py-2 text-right tabular">{money(bots.reduce((t, r) => t + metaCost(r.metaBilled), 0))}</td>
                  <td className="px-4 py-1.5">
                    <ClientCapForm action={setClientQuotaCap.bind(null, c.id)} cap={c.monthly_quota_cap} clientName={c.name} />
                    {c.monthly_quota_cap !== null && (
                      <div className={cn("mt-0.5 text-right text-xs", near ? "font-semibold text-danger" : "text-muted")}>
                        {num(used)} de {num(c.monthly_quota_cap)}
                        {used >= c.monthly_quota_cap ? " · modo só humano" : ""}
                      </div>
                    )}
                  </td>
                </tr>,
                ...bots.map((b) => <BotLine key={b.botId} row={b} name={botName.get(b.botId) ?? "Chatbot"} cost={metaCost(b.metaBilled)} />),
              ];
            })}
            {loose.map((b) => <BotLine key={b.botId} row={b} name={`${botName.get(b.botId) ?? "Chatbot"} (sem cliente)`} cost={metaCost(b.metaBilled)} />)}
            {removed > 0 && (
              <tr className="border-b border-line-2 last:border-0 text-muted">
                <td className="px-4 py-2 pl-8">Chatbots excluídos neste mês</td>
                <td className="px-3 py-2 text-right tabular">{num(removed)}</td>
                <td className="px-3 py-2" colSpan={3} />
              </tr>
            )}
            {clients.length === 0 && loose.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-muted">Nenhum cliente ainda.</td>
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

function BotLine({ row, name, cost }: { row: BotMonthUsage; name: string; cost: number }) {
  return (
    <tr className="border-b border-line-2 last:border-0">
      <td className="px-4 py-2 pl-8">
        <Link href={`/painel/bots/${row.botId}`} className="hover:underline">{name}</Link>
      </td>
      <td className="px-3 py-2 text-right tabular">{num(row.atendimentos)}</td>
      <td className="px-3 py-2 text-right tabular">{num(row.messages)}</td>
      <td className="px-3 py-2 text-right tabular">{money(cost)}</td>
      <td className="px-4 py-2" />
    </tr>
  );
}
