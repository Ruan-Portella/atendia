import { Kpi } from "@/components/kpi";
import { requireAdmin } from "@/lib/platform-admin";
import { IG_TOKEN_WARN_DAYS, getOperations, operationAlerts, type BotRef } from "@/lib/backoffice-ops";
import { num } from "@/lib/plans";
import { cn, relativeTime } from "@/lib/utils";
import { plainCounts } from "@/lib/reencrypt";
import { masterKeys } from "@/lib/keys";
import { createAdminClient } from "@/lib/supabase/admin";
import { ResultForm } from "@/components/admin/result-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { runReencryptNow, runReportDailyNow, runRetentionNow } from "../acoes";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { reportedThrough } from "@/lib/report-daily";

export const metadata = { title: "Operação" };

const botLabel = (bots: Map<string, BotRef>, id: string | null) => {
  const b = id ? bots.get(id) : undefined;
  return b ? `${b.name} · ${b.client}${b.agency ? ` (${b.agency})` : ""}` : "—";
};
const mb = (bytes: number) => `${num(Math.round(bytes / 1024 / 1024))} MB`;

export default async function AdminOperations() {
  await requireAdmin("/admin/operacao");
  const ops = await getOperations();
  const alerts = operationAlerts(ops);
  // cifra por campo (leva S): quanto do histórico ainda está sem cifra e as versões da chave mestra
  const plain = await plainCounts(createAdminClient()).catch(() => null);
  const plainTotal = plain ? Object.values(plain).reduce((a, b) => a + b, 0) : null;
  const versions = [...masterKeys().keys()].sort((a, b) => a - b);
  // totais diários (relatórios): até que dia já estão somados
  const through = await reportedThrough(createAdminClient()).catch(() => null);
  const h = ops.health;
  const ch = ops.channels;

  return (
    <>
      <div>
        <h1 className="text-[26px] font-bold">Operação</h1>
        <p className="text-sm text-muted">Saúde do banco, fila de mensagens da Meta, canais conectados e tarefas agendadas. Erros do código ficam no Sentry.</p>
      </div>

      {alerts.length > 0 ? (
        <section className="flex flex-col gap-1.5 rounded-xl border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber-ink">
          <strong>Precisa de atenção</strong>
          <ul className="ml-4 list-disc">{alerts.map((a) => <li key={a}>{a}</li>)}</ul>
        </section>
      ) : (
        <p className="rounded-xl border border-line bg-panel px-4 py-3 text-sm">✓ Tudo em dia.</p>
      )}

      <section className="card flex flex-col gap-2 p-5">
        <h2 className="text-base font-bold">Cifra por campo</h2>
        <p className="text-xs text-muted">
          O que vem do contato vai cifrado com a chave do cliente; tokens e segredos, com a chave mestra (versões: {versions.join(", ") || "nenhuma"}; a atual é a maior). O que foi gravado antes da cifra é cifrado em lotes pela rotina diária.
        </p>
        <p className="text-sm">
          {plainTotal === null ? "Não foi possível contar agora." : plainTotal === 0 ? "✓ Todo o histórico está cifrado." : `Ainda sem cifra: ${num(plainTotal)} (${Object.entries(plain!).filter(([, n]) => n).map(([k, n]) => `${k} ${num(n)}`).join(" · ")})`}
        </p>
        {plainTotal !== 0 && (
          <ResultForm action={runReencryptNow}>
            <SubmitButton className="btn-ghost self-start py-1.5 text-xs" pendingLabel="Cifrando…">Recifrar agora</SubmitButton>
          </ResultForm>
        )}
      </section>

      <section className="card flex flex-col gap-2 p-5">
        <h2 className="text-base font-bold">Totais diários dos relatórios</h2>
        <p className="text-xs text-muted">
          Relatórios, portal e painel somam os totais por dia (sem dado do contato) com a contagem ao vivo dos dias seguintes. A rotina diária recalcula os 2 últimos dias antes da limpeza, e a limpeza não apaga nada depois do último dia somado.
        </p>
        <p className="text-sm">{through ? `Somados até ${new Date(`${through}T12:00:00Z`).toLocaleDateString("pt-BR")}.` : "Ainda não somados: a limpeza por prazo fica parada até a primeira soma."}</p>
        <ResultForm action={runReportDailyNow}>
          <SubmitButton className="btn-ghost self-start py-1.5 text-xs" pendingLabel="Somando…">Recalcular agora</SubmitButton>
        </ResultForm>
      </section>

      <section className="card flex flex-col gap-2 p-5">
        <h2 className="text-base font-bold">Limpeza por prazo (retenção)</h2>
        <p className="text-xs text-muted">
          Prazo de cada chatbot: o do modo dados sensíveis (7 a 90 dias), senão o do cliente, senão o da agência (6, 12 ou 24 meses); demonstração, 30 dias. A rotina diária promove os prazos vencidos, agenda 12 meses (com e-mail) para quem estava em “Não apagar” e apaga o que passou do prazo, sem passar do último dia somado.
        </p>
        <ConfirmAction
          action={runRetentionNow}
          title="Rodar a limpeza por prazo agora?"
          description="Apaga de verdade o que passou do prazo de cada chatbot (conversas, leads, perguntas, contatos) e manda o e-mail do prazo padrão às agências em “Não apagar”. Não tem desfazer."
          confirmLabel="Rodar a limpeza"
          className="btn-ghost self-start py-1.5 text-xs"
        >
          Rodar limpeza agora
        </ConfirmAction>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Banco" value={h.dbWrite ? "ok" : "com erro"} sub={h.dbWriteMs !== null ? `escrita em ${h.dbWriteMs} ms` : (h.error ?? "sem resposta")} />
        <Kpi label="Disco do banco" value={h.diskRatio !== null ? `${Math.round(h.diskRatio * 100)}%` : "—"} sub={h.diskBytes !== null ? `${mb(h.diskBytes)} do limite do plano` : "sem leitura"} />
        <Kpi label="Fila da Meta" value={num(ops.queue.pending)} sub={ops.queue.oldestPendingAt ? `pendente desde ${relativeTime(ops.queue.oldestPendingAt)}` : "nada pendente"} />
        <Kpi label="Eventos com erro" value={num(ops.queue.failed24h)} sub={`nas últimas 24 h · ${num(ops.queue.failed7d)} em 7 dias · ${num(ops.queue.done24h)} processados em 24 h`} />
      </section>

      <section className="card flex flex-col gap-2 p-5">
        <h2 className="text-base font-bold">Tarefas agendadas</h2>
        {!ops.cronsScheduled && <p className="text-xs text-muted">Neste ambiente as tarefas não rodam sozinhas: a Vercel só agenda em produção. Aqui elas só rodam se alguém chamar a rota à mão, então não contam como atrasadas.</p>}
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-semibold">Tarefa</th><th className="py-1.5 font-semibold">Última execução</th><th className="py-1.5 font-semibold">Último sucesso</th></tr></thead>
          <tbody>
            {ops.crons.map((c) => (
              <tr key={c.name} className="border-t border-line-2">
                <td className="py-2">{c.label}</td>
                <td className="py-2 text-muted">{c.lastRunAt ? relativeTime(c.lastRunAt) : "nunca"}</td>
                <td className={cn("py-2", c.late ? "font-semibold text-danger" : "text-muted")}>{c.lastOkAt ? relativeTime(c.lastOkAt) : "nunca"}{c.late ? " · atrasada" : !ops.cronsScheduled ? " · não roda neste ambiente" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card flex flex-col gap-2 p-5">
        <h2 className="text-base font-bold">Eventos da Meta com erro (7 dias)</h2>
        {ops.queue.failed.length ? (
          <ul className="flex flex-col divide-y divide-line-2 text-sm">
            {ops.queue.failed.map((f) => (
              <li key={f.key_hash as string} className="flex flex-col gap-0.5 py-2">
                <span className="break-words">{(f.last_error as string | null) ?? "sem mensagem de erro"}</span>
                <span className="text-xs text-muted">{f.source as string} · {f.kind as string} · {f.attempts as number} tentativas · {botLabel(ops.bots, f.bot_id as string | null)} · {relativeTime(f.created_at as string)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nenhum.</p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card flex flex-col gap-2 p-5">
          <h2 className="text-base font-bold">WhatsApp</h2>
          {ch.waPayment.map((w) => <p key={`p${w.bot_id}`} className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Sem pagamento na Meta: {(w.display_phone as string | null) ?? "número"} · {botLabel(ops.bots, w.bot_id as string)} · desde {relativeTime(w.payment_issue_at as string)}</p>)}
          {ch.waDisconnected.length ? (
            <ul className="flex flex-col divide-y divide-line-2 text-sm">
              {ch.waDisconnected.map((w) => (
                <li key={w.bot_id as string} className="flex flex-col gap-0.5 py-2">
                  <span>{(w.display_phone as string | null) ?? "número"} · {botLabel(ops.bots, w.bot_id as string)}</span>
                  <span className="text-xs text-muted">desconectado {relativeTime(w.disconnected_at as string)}{w.disconnect_reason ? ` · ${w.disconnect_reason as string}` : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            !ch.waPayment.length && <p className="text-sm text-muted">Nenhum número desconectado ou sem pagamento.</p>
          )}
        </section>
        <section className="card flex flex-col gap-2 p-5">
          <h2 className="text-base font-bold">Instagram</h2>
          {ch.igExpiring.map((i) => <p key={`e${i.bot_id}`} className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Token vence {relativeTime(i.token_expires_at as string)}: @{(i.username as string | null) ?? "conta"} · {botLabel(ops.bots, i.bot_id as string)}</p>)}
          {ch.igDisconnected.length ? (
            <ul className="flex flex-col divide-y divide-line-2 text-sm">
              {ch.igDisconnected.map((i) => (
                <li key={i.bot_id as string} className="flex flex-col gap-0.5 py-2">
                  <span>@{(i.username as string | null) ?? "conta"} · {botLabel(ops.bots, i.bot_id as string)}</span>
                  <span className="text-xs text-muted">desconectado {relativeTime(i.disconnected_at as string)}{i.disconnect_reason ? ` · ${i.disconnect_reason as string}` : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            !ch.igExpiring.length && <p className="text-sm text-muted">Nenhuma conta desconectada ou com token vencendo em até {IG_TOKEN_WARN_DAYS} dias.</p>
          )}
        </section>
      </div>
    </>
  );
}
