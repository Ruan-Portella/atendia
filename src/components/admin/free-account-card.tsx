import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { lockFreeTest, releaseFreeTest } from "@/app/admin/(protegido)/acoes";
import { SIGNAL_LABEL, type FreeLink } from "@/lib/person-signals";
import { TEST_ANSWERS_FREE } from "@/lib/plans";

const dayBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export interface FreeAccountView {
  billingStatus: string;
  testAnswersUsed: number;
  freeUsedAt: string | null;
  blockedAt: string | null;
  blockReason: string | null;
  releasedAt: string | null;
}

/**
 * Trava da conta grátis no backoffice (Trava da conta grátis, parte 1): quanto do teste a conta
 * usou, se ficou presa por estar ligada a outra conta da mesma pessoa (e por qual sinal), as contas
 * ligadas e o "Liberar o teste" para quem ficou presa por engano (fica na auditoria).
 */
export function FreeAccountCard({ agencyId, view, links, names }: { agencyId: string; view: FreeAccountView; links: FreeLink[]; names: Map<string, string> }) {
  const reason = view.blockReason && view.blockReason in SIGNAL_LABEL ? SIGNAL_LABEL[view.blockReason as keyof typeof SIGNAL_LABEL] : view.blockReason;
  return (
    <section className="card flex flex-col gap-3 p-5 text-sm">
      <h2 className="text-lg font-medium">Conta grátis</h2>
      <p>
        {view.billingStatus === "none" ? `Sem assinatura · ${view.testAnswersUsed} de ${TEST_ANSWERS_FREE} respostas de teste usadas` : "Com assinatura: o teste grátis não vale mais"}
        {view.freeUsedAt ? ` · primeiro uso em ${dayBR(view.freeUsedAt)}` : " · ainda não usou o teste"}.
      </p>
      {view.blockedAt && (
        <p className={view.releasedAt ? "text-muted" : "rounded-lg bg-danger-soft px-3 py-2 text-danger"}>
          Presa em {dayBR(view.blockedAt)}: ligada a outra conta que já usou o teste ({reason ?? "sinal"}).
          {view.releasedAt && ` Liberada pelo suporte em ${dayBR(view.releasedAt)}.`}
        </p>
      )}
      {links.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold">Outras contas com algum sinal desta</p>
          <ul className="flex flex-col gap-1">
            {links.map((l, i) => (
              <li key={l.agencyId ?? `excluida-${i}`} className="text-xs">
                {l.agencyId ? <Link href={`/admin/clientes/${l.agencyId}`} className="font-semibold hover:underline">{names.get(l.agencyId) ?? "conta"}</Link> : <span className="font-semibold">conta excluída</span>}
                <span className="text-muted"> · {l.kinds.map((k) => SIGNAL_LABEL[k]).join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted">Nenhuma outra conta com os sinais desta (e-mail, navegador, IP do cadastro, WhatsApp do dono).</p>
      )}
      {view.billingStatus === "none" &&
        (view.releasedAt ? (
          <ConfirmAction action={lockFreeTest.bind(null, agencyId)} title="Tirar a liberação?" description="Se a conta estiver ligada a outra que já usou o teste, ela volta a ficar sem as respostas de teste e sem demos." confirmLabel="Tirar a liberação" className="btn-ghost self-start">
            Tirar a liberação
          </ConfirmAction>
        ) : (
          view.blockedAt && (
            <ActionForm action={releaseFreeTest.bind(null, agencyId)} className="flex flex-col gap-2 sm:flex-row">
              <input name="reason" required minLength={3} maxLength={200} placeholder="Motivo (ex.: duas empresas da mesma pessoa)" className="input" />
              <SubmitButton className="btn-primary shrink-0" pendingLabel="Liberando…">Liberar o teste</SubmitButton>
            </ActionForm>
          )
        ))}
    </section>
  );
}
