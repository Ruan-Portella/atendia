import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { cancelRecoveryAction, confirmRecoveryAction } from "@/app/segundo-fator/actions";
import { RECOVERY_CONFIRM_HOURS, RECOVERY_WAIT_HOURS, type RecoveryView } from "@/lib/mfa-recovery";

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * A página do link do e-mail da recuperação do segundo fator (painel e área do cliente). O link
 * não muda nada sozinho (leitores de e-mail abrem links): confirmar e cancelar são botões.
 */
export function MfaRecoveryToken({ token, view }: { token: string; view: RecoveryView }) {
  const support = view.area === "cliente" ? `a equipe de ${view.agencyName}` : "o suporte do BoaVoz";
  return (
    <div className="card flex w-full max-w-[460px] flex-col gap-4 p-6 sm:p-7">
      <h1 className="text-xl font-bold">Recuperar o segundo fator</h1>
      {view.status === "pendente" && (
        <>
          <p className="text-sm text-ink-2">
            Alguém pediu para remover o app autenticador da sua conta, porque ele foi perdido. Confirmando, {support} remove o app {RECOVERY_WAIT_HOURS} horas depois e você cadastra um novo no próximo acesso.
          </p>
          <ActionForm action={confirmRecoveryAction.bind(null, token)}>
            <SubmitButton className="btn-primary w-full" pendingLabel="Confirmando…">Fui eu: confirmar o pedido</SubmitButton>
          </ActionForm>
          <ActionForm action={cancelRecoveryAction.bind(null, token)}>
            <SubmitButton className="btn-ghost w-full" pendingLabel="Cancelando…">Não fui eu: cancelar</SubmitButton>
          </ActionForm>
          <p className="text-xs text-muted">O pedido vale {RECOVERY_CONFIRM_HOURS} horas. Sem a confirmação, nada muda na conta.</p>
        </>
      )}
      {view.status === "confirmado" && (
        <>
          <p className="text-sm text-ink-2">
            Pedido confirmado. {view.availableAt ? `A partir de ${when(view.availableAt)}, ` : ""}
            {support} remove o app autenticador e você recebe um e-mail. Encontrou o app? Basta usar o código dele de novo: o pedido cai sozinho.
          </p>
          <ActionForm action={cancelRecoveryAction.bind(null, token)}>
            <SubmitButton className="btn-ghost w-full" pendingLabel="Cancelando…">Não fui eu: cancelar</SubmitButton>
          </ActionForm>
        </>
      )}
      {view.status === "feito" && <p className="text-sm text-ink-2">O app autenticador já foi removido. No próximo acesso a uma área protegida, cadastre um app novo.</p>}
      {view.status === "cancelado" && <p className="text-sm text-ink-2">Pedido cancelado. O app autenticador continua na conta.</p>}
      {view.status === "recusado" && <p className="text-sm text-ink-2">Este pedido não foi atendido. O motivo foi por e-mail.</p>}
      {view.status === "vencido" && <p className="text-sm text-ink-2">O prazo para confirmar acabou. Se ainda precisar, peça de novo na tela de verificação.</p>}
    </div>
  );
}
