import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { resolveSignal, runContinuousNow } from "@/app/admin/(protegido)/acoes";
import { SIGNAL_LABEL, WEEKS, trendOf, type SignalRow, type TrendRow } from "@/lib/continuous-check";
import { spDay } from "@/lib/report-daily";
import { num } from "@/lib/plans";
import { relativeTime } from "@/lib/utils";

const DAY = 86_400_000;
const ddmm = (d: Date) => spDay(d).slice(5).split("-").reverse().join("/");

/** Semana i (0 = a mais recente) termina em `until`: de until-7(i+1) dias até a véspera de until-7i. */
const weekLabel = (until: Date, i: number) => `${ddmm(new Date(until.getTime() - 7 * (i + 1) * DAY))} a ${ddmm(new Date(until.getTime() - (7 * i + 1) * DAY))}`;

const TREND_TEXT = { subindo: "↑ subindo", caindo: "↓ caindo", estavel: "estável" } as const;

/**
 * Barras das 8 semanas (a mais antiga à esquerda): as anteriores no tom claro, a última no tom da
 * marca. O valor e a tendência vêm em texto ao lado; hover mostra a semana; a tabela escondida dá o
 * mesmo a leitores de tela.
 */
function WeekBars({ series, until, caption }: { series: number[]; until: Date; caption: string }) {
  const max = Math.max(0, ...series);
  const ordered = series.map((v, i) => ({ v, i })).reverse();
  const last = series[0] ?? 0;
  const trend = trendOf(series);
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-6 w-[76px] shrink-0 items-end gap-[2px]" aria-hidden="true">
        {ordered.map(({ v, i }) => (
          <div key={i} className="group relative flex h-full min-w-0 flex-1 items-end">
            <div className={`w-full rounded-t-[2px] ${i === 0 ? "bg-brand" : "bg-brand-tint"}`} style={{ height: v && max ? `${Math.max(8, (v / max) * 100)}%` : "1px" }} />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs text-ink shadow-[0_8px_24px_rgba(27,31,29,0.14)] group-hover:block">
              <div className="font-semibold">{weekLabel(until, i)}</div>
              <div className="tabular">{num(v)}</div>
            </div>
          </div>
        ))}
      </div>
      <span className="text-sm font-semibold tabular">{num(last)}</span>
      <span className={`text-xs ${trend === "subindo" ? "font-semibold text-ink" : "text-muted"}`}>{TREND_TEXT[trend]}</span>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th>Semana</th><th>Valor</th></tr></thead>
        <tbody>{ordered.map(({ v, i }) => <tr key={i}><td>{weekLabel(until, i)}</td><td>{num(v)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function SignalItem({ r, open }: { r: SignalRow; open: boolean }) {
  return (
    <li className="flex flex-col gap-2 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <strong>{SIGNAL_LABEL[r.kind] ?? r.kind}</strong> · <Link href={`/admin/clientes/${r.agencyId}`} className="hover:underline">{r.clientName}</Link>
          {r.agencyName && <span className="text-muted"> ({r.agencyName})</span>}
        </span>
        <span className="text-xs text-muted">{relativeTime(r.createdAt)}</span>
      </div>
      <p className="text-xs text-ink-2">{r.motivo}</p>
      {open ? (
        <ActionForm action={resolveSignal.bind(null, r.id)} className="flex flex-col gap-2 sm:flex-row">
          <input name="note" maxLength={200} placeholder="Nota da revisão (ex.: campanha do cliente, segue normal)" className="input py-1.5 text-sm" />
          <SubmitButton className="btn-ghost shrink-0" pendingLabel="Resolvendo…">Resolver</SubmitButton>
        </ActionForm>
      ) : (
        <p className="text-xs text-muted">Resolvido por {r.resolvedBy ?? "?"}: {r.resolution}</p>
      )}
    </li>
  );
}

/** Verificação contínua por cliente (B1'): sinais pendentes, os últimos resolvidos e a tendência das 8 semanas. */
export function ContinuousChecks({ pending, recent, trends, until, testAllowed, agencyView = false }: { pending: SignalRow[]; recent: SignalRow[]; trends: TrendRow[]; until: Date; testAllowed: boolean; agencyView?: boolean }) {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[640px]">
          <h2 className="text-base font-bold">Verificação contínua por cliente</h2>
          <p className="text-xs text-muted">
            Todo dia, só com números agregados (sem abrir conversa), a última semana de cada cliente é comparada com as 4 anteriores: salto de volume, muitos pedidos fora do assunto, itens
            proibidos em alta e mensagens que a Meta cobrou como IA de uso geral. Viram pendência aqui, sem selo nem aviso ao cliente e sem segurar nada. A semana mais recente vai até ontem.
          </p>
        </div>
        {!agencyView && (
          <ActionForm action={runContinuousNow} className="flex flex-col items-end gap-1.5">
            <SubmitButton className="btn-ghost" pendingLabel="Verificando…">Rodar agora</SubmitButton>
            {testAllowed && (
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" name="test" /> limites de teste (fora da produção)
              </label>
            )}
          </ActionForm>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold">Pendentes ({pending.length})</h3>
        {pending.length ? <ul className="divide-y divide-line-2">{pending.map((r) => <SignalItem key={r.id} r={r} open />)}</ul> : <p className="mt-1 text-sm text-muted">Nenhum sinal pendente.</p>}
      </div>

      <div>
        <h3 className="text-sm font-semibold">Tendência ({WEEKS} semanas{agencyView ? "" : ", clientes com sinal e os de mais atendimentos"})</h3>
        {trends.length ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1.5 font-semibold">Cliente</th>
                  <th className="py-1.5 font-semibold">Atendimentos</th>
                  <th className="py-1.5 font-semibold">Fora do assunto</th>
                  <th className="py-1.5 font-semibold">Proibidos no portão</th>
                  <th className="py-1.5 font-semibold">IA de uso geral (Meta)</th>
                </tr>
              </thead>
              <tbody>
                {trends.map((t) => (
                  <tr key={t.clientId} className="border-t border-line-2 align-middle">
                    <td className="py-2 pr-3">
                      <Link href={`/admin/clientes/${t.agencyId}`} className="font-semibold hover:underline">{t.clientName}</Link>
                      {!agencyView && t.agencyName && <div className="text-xs text-muted">{t.agencyName}</div>}
                      {t.signals.length > 0 && <div className="text-xs font-semibold text-danger">{t.signals.map((k) => SIGNAL_LABEL[k]).join(" · ")}</div>}
                    </td>
                    <td className="py-2 pr-3"><WeekBars series={t.weeks.atendimentos} until={until} caption={`Atendimentos por semana de ${t.clientName}`} /></td>
                    <td className="py-2 pr-3"><WeekBars series={t.weeks.refusals} until={until} caption={`Pedidos fora do assunto por semana de ${t.clientName}`} /></td>
                    <td className="py-2 pr-3"><WeekBars series={t.weeks.prohibited} until={until} caption={`Detecções de item proibido por semana de ${t.clientName}`} /></td>
                    <td className="py-2"><WeekBars series={t.weeks.meta_ai} until={until} caption={`Mensagens cobradas como IA de uso geral por semana de ${t.clientName}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted">Nenhum cliente com dados nas últimas {WEEKS} semanas.</p>
        )}
      </div>

      {recent.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">Últimos resolvidos ({recent.length})</summary>
          <ul className="divide-y divide-line-2">{recent.map((r) => <SignalItem key={r.id} r={r} open={false} />)}</ul>
        </details>
      )}
    </section>
  );
}
