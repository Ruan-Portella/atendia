import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { blockFromAnalysis, rerunAnalysis, resolveAnalysis, runAnalysesNow } from "@/app/admin/(protegido)/acoes";
import { CATEGORIES, type GateCategory } from "@/lib/gate/rules";
import type { BotAnalysisRow } from "@/lib/backoffice";
import { relativeTime } from "@/lib/utils";

const label = (c: string) => CATEGORIES[c as GateCategory]?.label ?? c;
const TRI: Record<string, string> = { sim: "sim", nao: "não", incerto: "incerto" };

function Findings({ r }: { r: BotAnalysisRow }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-ink-2">
      <div>
        IA como produto: <strong className={r.iaComoProduto === "nao" ? "" : "text-danger"}>{TRI[r.iaComoProduto] ?? r.iaComoProduto}</strong> · modelo proibido:{" "}
        <strong className={r.modeloProibido === "nao" ? "" : "text-danger"}>{TRI[r.modeloProibido] ?? r.modeloProibido}</strong>
        {r.categoriaPrincipal && ` (${label(r.categoriaPrincipal)})`} · {r.fontes} fonte{r.fontes === 1 ? "" : "s"}
      </div>
      {r.summary && <div>&ldquo;{r.summary}&rdquo;</div>}
      {r.categorias.length > 0 && (
        <div>
          Itens na base: {r.categorias.map((c) => `${label(c.categoria)} (${c.nivel === "proibido" ? "proibido" : "18+"}, ${c.trechos})`).join(", ")}
        </div>
      )}
    </div>
  );
}

/** Análise do bot: pendências (só sinal interno, sem selo para o cliente) e as últimas análises. */
export function BotAnalyses({ pending, recent, due }: { pending: BotAnalysisRow[]; recent: BotAnalysisRow[]; due: number }) {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">Análise do bot</h2>
          <p className="text-xs text-muted">
            Uma análise por chatbot: itens da base (da classificação dos trechos), fontes e as perguntas &ldquo;a IA é o produto?&rdquo; e &ldquo;o modelo de negócio é proibido?&rdquo;. &ldquo;Sim&rdquo; ou &ldquo;incerto&rdquo; vira pendência aqui, sem selo para o cliente e sem segurar nada. Roda na rotina diária, ~10 minutos depois de mudar instruções, assuntos, canais ou modelos.
          </p>
        </div>
        <ActionForm action={runAnalysesNow}>
          <SubmitButton className="btn-ghost shrink-0 py-1.5" pendingLabel="Analisando…">Rodar as agendadas ({due})</SubmitButton>
        </ActionForm>
      </div>

      {pending.length ? (
        <ul className="flex flex-col divide-y divide-line-2 text-sm">
          {pending.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <strong>{r.clientName}</strong>
                <span className="text-muted">
                  · {r.botName} · <Link href={`/admin/clientes/${r.agencyId}`} className="hover:underline">{r.agencyName ?? "agência"}</Link>
                </span>
                <span className="text-xs text-muted">{relativeTime(r.createdAt)}</span>
              </div>
              <Findings r={r} />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <ActionForm action={resolveAnalysis.bind(null, r.id)} className="flex min-w-0 flex-1 gap-2">
                  <input name="note" maxLength={200} placeholder="Nota (opcional): por que segue normal" className="input py-1.5" />
                  <SubmitButton className="btn-primary shrink-0 py-1.5" pendingLabel="Salvando…">Segue normal</SubmitButton>
                </ActionForm>
                <ActionForm action={blockFromAnalysis.bind(null, r.id)} className="flex min-w-0 flex-1 gap-2">
                  <input name="reason" required minLength={3} maxLength={200} placeholder="Motivo do bloqueio (o cliente vê)" className="input py-1.5" />
                  <SubmitButton className="btn-ghost shrink-0 py-1.5 text-danger" pendingLabel="Bloqueando…">Bloquear</SubmitButton>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nenhuma pendência da análise.</p>
      )}

      {recent.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line-2 pt-3">
          <h3 className="text-sm font-semibold">Últimas análises</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{r.clientName}</span>
                  <span className="text-xs text-muted">· {r.botName} · {relativeTime(r.createdAt)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.reviewState === "pending" ? "bg-amber-soft text-amber-ink" : "bg-ground text-muted"}`}>
                    {r.reviewState === "pending" ? "pendente" : r.reviewState === "resolved" ? `revisada${r.resolution ? `: ${r.resolution}` : ""}` : "nada a revisar"}
                  </span>
                  <ActionForm action={rerunAnalysis.bind(null, r.botId)}>
                    <SubmitButton className="text-xs font-semibold underline" pendingLabel="Analisando…">rodar de novo</SubmitButton>
                  </ActionForm>
                </div>
                <Findings r={r} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
