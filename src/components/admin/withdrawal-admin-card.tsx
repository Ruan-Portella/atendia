import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { supportWithdraw } from "@/app/admin/(protegido)/acoes";
import type { WithdrawalState } from "@/lib/withdrawal";
import { brlCents } from "@/lib/plans";

const dayBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export interface WithdrawalRow {
  createdAt: string;
  via: string;
  actor: string;
  refundedCents: number;
  status: string;
  error: string | null;
}

/**
 * Desistência no backoffice (Trava da conta grátis, parte 2): a janela de 7 dias, a marca da pessoa,
 * o registro das desistências (com o erro do estorno, se houve) e o "Fazer a desistência" do suporte,
 * para quem foi mandado ao suporte ou para refazer uma que falhou.
 */
export function WithdrawalAdminCard({ agencyId, state, marked, subscribed, rows }: { agencyId: string; state: WithdrawalState; marked: boolean; subscribed: boolean; rows: WithdrawalRow[] }) {
  return (
    <section className="card flex flex-col gap-3 p-5 text-sm">
      <h2 className="text-lg font-bold">Desistência em 7 dias</h2>
      <p>
        {state.kind === "open" && `Janela aberta até ${dayBR(state.until)}: o dono vê o botão em Cobrança.`}
        {state.kind === "support" && `Janela aberta até ${dayBR(state.until)}, pelo suporte: a pessoa está marcada por uma desistência recente.`}
        {state.kind === "done" && `Desistiu em ${dayBR(state.at)}.`}
        {state.kind === "none" && (subscribed ? "Fora da janela de 7 dias." : "Sem assinatura.")}
        {marked && state.kind !== "support" && " A pessoa está marcada (12 meses): sem teste grátis em nenhuma conta dela."}
      </p>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {rows.map((r, i) => (
            <li key={i} className={r.status === "erro" ? "text-danger" : "text-muted"}>
              {dayBR(r.createdAt)} · pelo {r.via} ({r.actor}) · {r.status === "feita" ? `estornado ${brlCents(r.refundedCents / 100)}` : `erro: ${r.error ?? "?"} (estornado até ali ${brlCents(r.refundedCents / 100)})`}
            </li>
          ))}
        </ul>
      )}
      {subscribed && (
        <ActionForm action={supportWithdraw.bind(null, agencyId)} className="flex flex-col gap-2">
          <p className="text-xs text-muted">Estorna tudo o que foi pago desde o início da assinatura, encerra na hora, marca a pessoa por 12 meses e avisa o dono por e-mail. Os estornos já feitos não se repetem.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input name="reason" required minLength={3} maxLength={200} placeholder="Motivo (fica registrado)" className="input" />
            <SubmitButton className="btn-danger shrink-0" pendingLabel="Estornando…">Fazer a desistência</SubmitButton>
          </div>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="confirm" required className="mt-0.5" /> Entendi: o dinheiro volta para o cliente e não dá para desfazer.</label>
        </ActionForm>
      )}
    </section>
  );
}
