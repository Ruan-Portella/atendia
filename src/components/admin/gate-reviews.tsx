import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { approveGateReview, rejectGateReview, revokeGateException } from "@/app/admin/(protegido)/acoes";
import { CATEGORIES, type GateCategory } from "@/lib/gate/rules";
import type { GateExceptionRow, GateReviewRow } from "@/lib/backoffice";
import { relativeTime } from "@/lib/utils";

const label = (c: string) => CATEGORIES[c as GateCategory]?.label ?? c;
const LEVEL: Record<string, string> = { regulamentado: "regulamentado (18+)", proibido: "proibido" };

/** "Isto não é {categoria}": pedidos das agências, decisão do BoaVoz e as exceções ativas por chatbot. */
export function GateReviews({ open, recent, exceptions }: { open: GateReviewRow[]; recent: GateReviewRow[]; exceptions: GateExceptionRow[] }) {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <h2 className="text-base font-bold">Revisões do portão (&ldquo;isto não é…&rdquo;)</h2>
      <p className="text-xs text-muted">
        A agência pede quando o portão acusou um item que o negócio não vende. Aprovar libera a categoria só naquele chatbot (entrada, base, histórico e saída); recusar mantém a regra. O dono recebe a decisão por e-mail.
      </p>
      {open.length ? (
        <ul className="flex flex-col divide-y divide-line-2 text-sm">
          {open.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <strong>isto não é {label(r.category)}</strong>
                <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber-ink">{LEVEL[CATEGORIES[r.category as GateCategory]?.level ?? ""] ?? r.category}</span>
                <span className="text-muted">
                  · {r.botName} ({r.clientName}) · <Link href={`/admin/clientes/${r.agencyId}`} className="hover:underline">{r.agencyName ?? "agência"}</Link>
                </span>
                <span className="text-xs text-muted">pedido {relativeTime(r.createdAt)} por {r.requestedBy}</span>
              </div>
              {r.note && <p className="text-xs text-ink-2">&ldquo;{r.note}&rdquo;</p>}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <ConfirmAction
                  action={approveGateReview.bind(null, r.id)}
                  title={`Liberar "${label(r.category)}" em ${r.botName}?`}
                  description="O portão deixa de tratar esta categoria só neste chatbot. Dá para revogar depois na lista de exceções."
                  confirmLabel="Aprovar"
                  danger={false}
                  className="btn-primary shrink-0 py-1.5"
                >
                  Aprovar
                </ConfirmAction>
                <ActionForm action={rejectGateReview.bind(null, r.id)} className="flex min-w-0 flex-1 gap-2">
                  <input name="reason" required minLength={3} maxLength={200} placeholder="Motivo da recusa (o dono recebe)" className="input py-1.5" />
                  <SubmitButton className="btn-ghost shrink-0 py-1.5" pendingLabel="Recusando…">Recusar</SubmitButton>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nenhum pedido aberto.</p>
      )}

      {exceptions.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line-2 pt-3">
          <h3 className="text-sm font-semibold">Exceções ativas</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {exceptions.map((e) => (
              <li key={`${e.botId}:${e.category}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>
                  <strong>{label(e.category)}</strong> liberado em {e.botName} ({e.clientName}{e.agencyName ? ` · ${e.agencyName}` : ""})
                </span>
                <span className="text-xs text-muted">por {e.approvedBy} {relativeTime(e.createdAt)}</span>
                <ConfirmAction
                  action={revokeGateException.bind(null, e.botId, e.category)}
                  title="Revogar a exceção?"
                  description="O portão volta a tratar esta categoria neste chatbot a partir da próxima mensagem."
                  confirmLabel="Revogar"
                  className="text-xs font-semibold text-danger hover:underline"
                >
                  revogar
                </ConfirmAction>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recent.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line-2 pt-3 text-xs text-muted">
          <h3 className="text-sm font-semibold text-ink">Decididos recentemente</h3>
          {recent.map((r) => (
            <div key={r.id}>
              {label(r.category)} em {r.botName}: <strong className={r.status === "aprovado" ? "text-brand" : "text-danger"}>{r.status}</strong> {r.decidedAt ? relativeTime(r.decidedAt) : ""}
              {r.decidedBy ? ` por ${r.decidedBy}` : ""}
              {r.decisionNote ? ` · ${r.decisionNote}` : ""}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
