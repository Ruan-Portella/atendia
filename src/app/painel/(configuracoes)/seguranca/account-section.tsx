import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ACCOUNT_DELETION_DAYS } from "@/lib/account-deletion";
import { dateBR } from "@/lib/retention";
import { cancelAccountDeletionAction, requestAccountDeletionAction } from "@/app/painel/actions";

/**
 * Excluir a conta (Lançamento, parte 1): só o dono, com o segundo fator da Segurança. O pedido
 * marca a data (7 dias); até lá tudo funciona e dá para desistir aqui.
 */
export function AccountSection({ agency }: { agency: { name: string; deletion_scheduled_for: string | null } }) {
  if (agency.deletion_scheduled_for) {
    return (
      <section className="card flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-base font-medium">Exclusão agendada</h2>
          <p className="text-sm text-muted">
            A conta <strong className="text-ink">{agency.name}</strong> será excluída em <strong className="text-ink">{dateBR(agency.deletion_scheduled_for)}</strong>. Até lá, tudo continua funcionando: os chatbots respondem, e a equipe e os clientes entram normalmente. A assinatura não renova mais.
          </p>
        </div>
        <ConfirmAction action={cancelAccountDeletionAction} title="Desistir da exclusão?" description="A conta continua como está, e a assinatura volta a renovar." confirmLabel="Desistir da exclusão" danger={false} className="btn-primary self-start">
          Desistir da exclusão
        </ConfirmAction>
      </section>
    );
  }

  return (
    <section className="card flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-medium">Excluir a conta</h2>
        <p className="text-sm text-muted">A exclusão acontece {ACCOUNT_DELETION_DAYS} dias depois do pedido; até lá, dá para desistir aqui. Na data, apagamos:</p>
      </div>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
        <li>os clientes, os chatbots, as bases de conhecimento, os roteiros e as demos;</li>
        <li>as conversas, os contatos, os leads, as campanhas e os arquivos;</li>
        <li>a equipe (as contas das pessoas), as chaves da API, os webhooks e as ações;</li>
        <li>a ligação com o WhatsApp e o Instagram (os números e as contas continuam dos negócios).</li>
      </ul>
      <p className="text-sm text-muted">
        A assinatura para de renovar no pedido e é cancelada na exclusão, sem reembolso do mês em curso; o crédito que sobrar se perde. A auditoria fica por 1 ano e os registros de acesso por 6 meses, como pede a lei. Antes, exporte os leads e o que mais quiser guardar.
      </p>
      <ActionForm action={requestAccountDeletionAction} className="flex flex-col gap-3 rounded-xl border border-danger-line bg-danger-soft/40 p-4">
        <label htmlFor="confirm_name" className="label">
          Para confirmar, digite o nome da conta: <strong className="text-ink">{agency.name}</strong>
        </label>
        <input id="confirm_name" name="confirm_name" required autoComplete="off" className="input" />
        <SubmitButton className="btn-danger self-start" pendingLabel="Agendando…">
          Excluir a conta em {ACCOUNT_DELETION_DAYS} dias
        </SubmitButton>
      </ActionForm>
    </section>
  );
}
