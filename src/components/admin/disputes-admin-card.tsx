import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { acceptDisputeAction, sendDisputeEvidence } from "@/app/admin/(protegido)/acoes";
import { EVIDENCE_FIELDS, disputeNeedsResponse, disputeReasonLabel, type Evidence } from "@/lib/disputes";
import { brlCents } from "@/lib/plans";

const dt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const STATUS_LABEL: Record<string, string> = {
  needs_response: "esperando a defesa",
  warning_needs_response: "consulta do banco esperando resposta",
  under_review: "em análise no banco",
  won: "ganha",
  lost: "perdida",
  warning_under_review: "consulta em análise",
  warning_closed: "consulta encerrada",
  estornado: "estornado na hora",
  aviso: "aviso sem ação",
};

export interface DisputeRow {
  id: string;
  kind: "contestacao" | "aviso_fraude";
  amountCents: number;
  reason: string | null;
  status: string;
  dueBy: string | null;
  evidence: Evidence | null;
  submittedAt: string | null;
  submittedBy: string | null;
  outcome: string | null;
  createdAt: string;
}

/**
 * Contestações no cartão no backoffice (Trava da conta grátis, parte 5): cada contestação e aviso
 * antecipado de fraude da conta; na que espera a defesa, o rascunho montado pelo BoaVoz para revisar
 * e enviar pela Stripe, ou aceitar.
 */
export function DisputesAdminCard({ agencyId, rows }: { agencyId: string; rows: DisputeRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="card flex flex-col gap-4 p-5 text-sm">
      <h2 className="text-lg font-bold">Contestações no cartão</h2>
      {rows.map((d) => {
        const open = d.kind === "contestacao" && disputeNeedsResponse(d.status) && !d.submittedAt;
        return (
          <div key={d.id} className="flex flex-col gap-2 rounded-lg border border-line-2 p-3">
            <p>
              <span className="font-semibold">{d.kind === "aviso_fraude" ? "Aviso antecipado de fraude" : "Contestação"}</span> de <span className="tabular">{brlCents(d.amountCents / 100)}</span> em {dt(d.createdAt)} · {disputeReasonLabel(d.reason)} · <span className={open ? "font-semibold text-danger" : "text-muted"}>{STATUS_LABEL[d.status] ?? d.status}</span>
              {d.outcome && d.kind === "contestacao" && <span className="text-muted"> ({d.outcome})</span>}
            </p>
            {open && d.dueBy && <p className="text-xs font-semibold text-danger">Prazo para a defesa: {dt(d.dueBy)}.</p>}
            {d.submittedAt && <p className="text-xs text-muted">Defesa enviada em {dt(d.submittedAt)}{d.submittedBy ? ` por ${d.submittedBy}` : ""}.</p>}
            {open && (
              <>
                <ActionForm action={sendDisputeEvidence.bind(null, agencyId, d.id)} className="flex flex-col gap-2">
                  <p className="text-xs text-muted">O rascunho foi montado com o que o BoaVoz registra (entradas no painel, uso e o aceite dos termos). Revise, corrija o que precisar e envie: depois de enviada, a defesa não muda.</p>
                  {EVIDENCE_FIELDS.map((f) => (
                    <label key={f.key} className="flex flex-col gap-1">
                      <span className="text-xs font-semibold">{f.label}</span>
                      {f.rows === 1 ? (
                        <input name={f.key} defaultValue={d.evidence?.[f.key] ?? ""} className="input" />
                      ) : (
                        <textarea name={f.key} defaultValue={d.evidence?.[f.key] ?? ""} rows={f.rows} className="input font-mono text-xs" />
                      )}
                    </label>
                  ))}
                  <SubmitButton className="btn-primary self-start" pendingLabel="Enviando…">Enviar a defesa pela Stripe</SubmitButton>
                </ActionForm>
                <ConfirmAction action={acceptDisputeAction.bind(null, agencyId, d.id)} title="Aceitar a contestação?" description="O valor fica com o cliente e a contestação termina. Use quando o cartão foi mesmo usado sem o titular saber." confirmLabel="Aceitar" className="btn-ghost self-start text-xs">
                  Aceitar a contestação
                </ConfirmAction>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
