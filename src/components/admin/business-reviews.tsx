import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { approveBusiness, blockBusiness } from "@/app/admin/(protegido)/acoes";
import { ACTIVITIES } from "@/lib/acceptance";
import type { AcceptanceRow, ReviewRow } from "@/lib/backoffice";
import { relativeTime } from "@/lib/utils";

const ANSWER: Record<string, string> = { sim: "Sim", nao_sei: "Não sei" };
const STATUS: Record<ReviewRow["status"], string> = { ativo: "aprovado", em_revisao: "em revisão (canal funcionando)", aguardando_revisao: "segura o WhatsApp", bloqueado: "bloqueado" };
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram" };

/** O que o negócio marcou (só "sim" e "não sei"). */
function Marked({ answers }: { answers: Record<string, string> }) {
  const marked = ACTIVITIES.filter((a) => answers[a.id] && answers[a.id] !== "nao");
  if (!marked.length) return <span className="text-muted">tudo &ldquo;não&rdquo;</span>;
  return (
    <ul className="ml-4 list-disc">
      {marked.map((a) => <li key={a.id}><strong>{ANSWER[answers[a.id]]}</strong>: {a.label}</li>)}
    </ul>
  );
}

/** Revisões abertas pela pergunta de atividades, com aprovar e bloquear. */
export function BusinessReviews({ open, recent }: { open: ReviewRow[]; recent: ReviewRow[] }) {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <h2 className="text-base font-bold">Revisões de negócio</h2>
      <p className="text-xs text-muted">Abertas pela pergunta de atividades da tela de aceite. &ldquo;Sim&rdquo; em vender IA como produto segura o WhatsApp até aprovar; os outros casos revisam com o canal funcionando. Prazo para o cliente: 2 dias úteis. Bloquear suspende o WhatsApp e o Instagram dos chatbots do negócio; aprovar levanta essas suspensões.</p>
      {open.length ? (
        <ul className="flex flex-col divide-y divide-line-2 text-sm">
          {open.map((r) => {
            const late = r.overdue;
            return (
              <li key={r.clientId} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <strong>{r.clientName}</strong>
                  {r.agencyName && <Link href={`/admin/clientes/${r.agencyId}`} className="text-muted hover:underline">· {r.agencyName}</Link>}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === "aguardando_revisao" ? "bg-danger-soft text-danger" : "bg-amber-soft text-amber-ink"}`}>{STATUS[r.status]}</span>
                  {r.reviewDueAt && <span className={`text-xs ${late ? "font-semibold text-danger" : "text-muted"}`}>{late ? "prazo vencido" : "prazo"} {relativeTime(r.reviewDueAt)}</span>}
                </div>
                <div className="text-xs text-ink-2"><Marked answers={r.answers} /></div>
                <div className="text-xs text-muted">Respondido {relativeTime(r.answeredAt)}{r.answeredBy ? ` por ${r.answeredBy}` : ""}</div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <ConfirmAction action={approveBusiness.bind(null, r.clientId)} title={`Aprovar ${r.clientName}?`} description="O negócio fica ativo: o WhatsApp pode conectar e as suspensões criadas por um bloqueio são levantadas." confirmLabel="Aprovar" danger={false} className="btn-primary shrink-0 py-1.5">
                    Aprovar
                  </ConfirmAction>
                  <ActionForm action={blockBusiness.bind(null, r.clientId)} className="flex min-w-0 flex-1 gap-2">
                    <input name="reason" required minLength={3} maxLength={200} placeholder="Motivo do bloqueio (o cliente vê)" className="input py-1.5" />
                    <SubmitButton className="btn-danger shrink-0 py-1.5" pendingLabel="Bloqueando…">Bloquear</SubmitButton>
                  </ActionForm>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nenhuma revisão aberta.</p>
      )}
      {recent.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-muted">Revisadas há pouco ({recent.length})</summary>
          <ul className="mt-2 flex flex-col divide-y divide-line-2">
            {recent.map((r) => (
              <li key={r.clientId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><strong>{r.clientName}</strong>{r.agencyName ? ` · ${r.agencyName}` : ""} · {STATUS[r.status]}{r.reviewNote ? ` (${r.reviewNote})` : ""}</span>
                <span className="text-xs text-muted">{r.reviewedAt ? relativeTime(r.reviewedAt) : ""}{r.reviewedBy ? ` por ${r.reviewedBy}` : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Últimos aceites dos termos do canal e da Política de Uso Aceitável. */
export function AcceptanceList({ rows }: { rows: AcceptanceRow[] }) {
  return (
    <section className="card flex flex-col gap-2 p-5">
      <h2 className="text-base font-bold">Aceites dos negócios</h2>
      <p className="text-xs text-muted">Tela única de aceite, antes de conectar o WhatsApp ou o Instagram. Pelo link, o aceite fica pendente até a Meta concluir a conexão (apagado depois de 7 dias sem conclusão).</p>
      {rows.length ? (
        <ul className="flex flex-col divide-y divide-line-2 text-sm">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <strong>{a.clientName ?? "cliente apagado"}</strong>{a.agencyName ? ` · ${a.agencyName}` : ""} · {CHANNEL[a.channel] ?? a.channel} · v{a.version} · {a.via === "link" ? "link" : "painel"}
                <span className="block text-xs text-muted">{a.who}{a.metaName ? ` · conta ${a.metaName}` : ""}</span>
              </span>
              <span className={`text-xs ${a.status === "pending" ? "text-amber-ink" : "text-muted"}`}>{a.status === "pending" ? "pendente" : relativeTime(a.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nenhum aceite ainda.</p>
      )}
    </section>
  );
}
