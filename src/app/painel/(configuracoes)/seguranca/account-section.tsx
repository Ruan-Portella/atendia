import { CalendarClock, Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { DialogButton } from "@/components/ui/setting-row";
import { ACCOUNT_DELETION_DAYS } from "@/lib/account-deletion";
import { dateBR } from "@/lib/retention";
import { cancelAccountDeletionAction, requestAccountDeletionAction } from "@/app/painel/actions";

/**
 * Excluir a conta (Lançamento, parte 1): só o dono, com o segundo fator da Segurança. O pedido
 * marca a data (7 dias); até lá tudo funciona e dá para desistir aqui. Redesenho, etapa 5: uma linha
 * na zona de perigo, e o que sai e a confirmação pelo nome num modal com o botão vermelho.
 */
export function AccountSection({ agency }: { agency: { name: string; deletion_scheduled_for: string | null } }) {
  if (agency.deletion_scheduled_for) {
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-[16px] border border-amber/40 bg-amber-soft px-4 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-panel text-amber-ink">
          <CalendarClock size={18} />
        </span>
        <span className="min-w-0 flex-1 text-sm text-amber-ink">
          <span className="block text-[15px] font-medium">Exclusão agendada para {dateBR(agency.deletion_scheduled_for)}</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug">Até lá, tudo continua funcionando: os chatbots respondem, e a equipe e os clientes entram normalmente. A assinatura não renova mais.</span>
        </span>
        <ConfirmAction action={cancelAccountDeletionAction} title="Desistir da exclusão?" description="A conta continua como está, e a assinatura volta a renovar." confirmLabel="Desistir da exclusão" danger={false} className="btn-primary py-1.5 text-xs">
          Desistir da exclusão
        </ConfirmAction>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="kpi-label px-1 text-danger">Zona de perigo</h3>
      <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-danger-line bg-panel px-4 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-danger-soft text-danger">
          <Trash2 size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-ink">Excluir a conta</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">Apaga tudo {ACCOUNT_DELETION_DAYS} dias depois do pedido; até lá, dá para desistir aqui.</span>
        </span>
        <DialogButton
          label="Excluir a conta"
          className="btn-danger py-1.5 text-xs"
          title={`Excluir a conta ${agency.name}?`}
          description={`A exclusão acontece ${ACCOUNT_DELETION_DAYS} dias depois do pedido; até lá, tudo funciona e dá para desistir em Segurança.`}
          action={requestAccountDeletionAction}
          saveLabel={`Excluir a conta em ${ACCOUNT_DELETION_DAYS} dias`}
          danger
        >
          <div className="flex flex-col gap-2 text-sm text-ink-2">
            <p className="font-medium text-ink">Na data, apagamos:</p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>os clientes, os chatbots, as bases de conhecimento, os roteiros e as demos;</li>
              <li>as conversas, os contatos, os leads, as campanhas e os arquivos;</li>
              <li>a equipe (as contas das pessoas), as chaves da API, os webhooks e as ações;</li>
              <li>a ligação com o WhatsApp e o Instagram (os números e as contas continuam dos negócios).</li>
            </ul>
            <p className="text-xs text-muted">
              A assinatura para de renovar no pedido e é cancelada na exclusão, sem reembolso do mês em curso; o crédito que sobrar se perde. A auditoria fica por 1 ano e os registros de acesso por 6 meses, como pede a lei. Antes, exporte os leads e o que mais
              quiser guardar.
            </p>
          </div>
          <div className="rounded-[12px] border border-danger-line bg-danger-soft/40 p-3">
            <label htmlFor="confirm_name" className="label">
              Para confirmar, digite o nome da conta: <strong className="text-ink">{agency.name}</strong>
            </label>
            <input id="confirm_name" name="confirm_name" required autoComplete="off" className="input" />
          </div>
        </DialogButton>
      </div>
    </section>
  );
}
