import Link from "next/link";
import { Kpi } from "@/components/kpi";
import { DayBars } from "@/components/admin/day-bars";
import { requireAdmin } from "@/lib/platform-admin";
import { agencyStatus, fixedMonthlyBrl, getActivity, getAgencies, getAiCosts, getBotCounts, getFixedCosts, getRevenue, rangeFor, usd, usdBrl } from "@/lib/backoffice";
import { getOperations, operationAlerts } from "@/lib/backoffice-ops";
import { brl, num } from "@/lib/plans";

export const metadata = { title: "Visão geral" };

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site (widget)", painel: "Teste no painel", demo: "Demo" };

export default async function AdminHome() {
  await requireAdmin("/admin");
  const month = rangeFor("mes");
  const [agencies, bots, activity, ai, revenue, fixed, ops] = await Promise.all([getAgencies(), getBotCounts(), getActivity(30), getAiCosts(month.since, month.until), getRevenue(), getFixedCosts(), getOperations()]);
  const alerts = operationAlerts(ops);
  const fixedBrl = fixedMonthlyBrl(fixed);

  const status = { pagante: 0, teste: 0, teste_vencido: 0, cancelada: 0 };
  for (const a of agencies) status[agencyStatus(a)] += 1;
  const messages = (d: (typeof activity.daily)[number]) => d.contact + d.bot + d.team;
  const today = activity.daily.at(-1);
  const total30 = activity.daily.reduce((t, d) => t + messages(d), 0);
  const conv30 = activity.daily.reduce((t, d) => t + d.conversations, 0);
  const stripeOk = revenue && !("error" in revenue) ? revenue : null;
  const mrr = stripeOk ? stripeOk.mrrCents / 100 : null;
  const aiBrl = ai.summary.total.cost * usdBrl();
  const totalChannels = activity.channels.reduce((t, c) => t + c.conversations, 0);

  return (
    <>
      <div>
        <h1 className="text-[26px] font-bold">Visão geral</h1>
        <p className="text-sm text-muted">Sem os bots de demonstração da landing. Custo e margem do mês corrente; dólar a {brl(usdBrl())} (USD_BRL).</p>
      </div>

      {alerts.length > 0 ? (
        <section className="flex flex-col gap-1.5 rounded-xl border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber-ink">
          <strong>Precisa de atenção</strong>
          <ul className="ml-4 list-disc">{alerts.map((a) => <li key={a}>{a}</li>)}</ul>
          <Link href="/admin/operacao" className="self-start text-xs font-semibold underline">Ver operação</Link>
        </section>
      ) : (
        <p className="text-sm text-muted">✓ Operação sem alertas: banco, fila da Meta, canais e tarefas agendadas em dia.</p>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Agências pagantes" value={num(status.pagante)} sub={`${status.teste} em teste · ${status.teste_vencido} teste vencido · ${status.cancelada} canceladas`} />
        <Kpi label="Chatbots" value={num(bots.bots)} sub={`${bots.live} publicados · ${bots.demos} demos`} />
        <Kpi label="Canais conectados" value={num(bots.whatsapp + bots.instagram)} sub={`${bots.whatsapp} WhatsApp · ${bots.instagram} Instagram`} />
        <Kpi label="Mensagens por dia" value={num(Math.round(total30 / 30))} sub={`média de 30 dias · hoje ${num(today ? messages(today) : 0)}`} />
        <Kpi label="Conversas (30 dias)" value={num(conv30)} sub={`hoje ${num(today?.conversations ?? 0)} · ${num(Math.round(conv30 / 30))} por dia`} />
        <Kpi label="Receita mensal (MRR)" value={mrr === null ? "—" : brl(mrr)} sub={stripeOk ? `${stripeOk.active} assinaturas ativas${stripeOk.testMode ? " · Stripe em teste" : ""}` : revenue && "error" in revenue ? "erro no Stripe" : "Stripe não configurado"} />
        <Kpi label="Custo de IA no mês" value={usd(ai.summary.total.cost)} sub={`≈ ${brl(aiBrl)} · ${usd(ai.summary.answers.perAnswer, 5)} por resposta`} />
        <Kpi label="Margem do mês" value={mrr === null ? "—" : brl(mrr - aiBrl - fixedBrl)} sub={`receita − IA − custos fixos (${brl(fixedBrl)})`} />
      </section>

      <section className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">Mensagens por dia</h2>
          <span className="text-xs text-muted">contato + bot + equipe, últimos 30 dias</span>
        </div>
        <DayBars caption="Mensagens por dia" days={activity.daily.map((d) => ({ day: d.day, value: messages(d), detail: `${d.contact} do contato · ${d.bot} do bot · ${d.team} da equipe` }))} format={(v) => num(Math.round(v))} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card flex flex-col gap-4 p-5">
          <h2 className="text-lg font-bold">Conversas por dia</h2>
          <DayBars caption="Conversas por dia" days={activity.daily.map((d) => ({ day: d.day, value: d.conversations }))} format={(v) => num(Math.round(v))} />
        </section>
        <section className="card flex flex-col gap-3 p-5">
          <h2 className="text-lg font-bold">Conversas por canal (30 dias)</h2>
          {activity.channels.length ? (
            <ul className="flex flex-col gap-2.5">
              {activity.channels.map((c) => (
                <li key={c.channel} className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm"><span>{CHANNEL_LABEL[c.channel] ?? c.channel}</span><span className="tabular text-muted">{num(c.conversations)} · {Math.round((c.conversations / totalChannels) * 100)}%</span></div>
                  <div className="h-2 rounded-full bg-ground"><div className="h-2 rounded-full bg-brand" style={{ width: `${(c.conversations / totalChannels) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nenhuma conversa nos últimos 30 dias.</p>
          )}
          <p className="mt-auto text-xs text-muted">Detalhe por cliente em <Link href="/admin/clientes" className="font-semibold text-ink underline">Clientes</Link>; custo por modelo e canal em <Link href="/admin/custos" className="font-semibold text-ink underline">Custos</Link>.</p>
        </section>
      </div>
    </>
  );
}
