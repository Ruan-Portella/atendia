import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { checkUnsizedChannels, grantCredit } from "@/app/admin/(protegido)/acoes";
import { PACKS, brlCents, isPackId } from "@/lib/plans";

interface Props {
  agencyId: string;
  status: string;
  cancelAt: string | null;
  subscriptionId: string | null;
  testMode: boolean;
  monthlyCents: number;
  packs: string[];
  creditCents: number;
  autoRecharge: boolean;
}

const STATUS: Record<string, string> = { none: "sem assinatura", active: "em dia", past_due: "pagamento atrasado" };

/**
 * Cobrança da agência no backoffice (revisão de preços, parte 4d): situação da assinatura, o que
 * vale no próximo mês, pacotes, saldo do crédito do excedente e o crédito dado pela BoaVoz.
 */
export function BillingCard({ agencyId, status, cancelAt, subscriptionId, testMode, monthlyCents, packs, creditCents, autoRecharge }: Props) {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">Cobrança</h2>
        {subscriptionId && (
          <a href={`https://dashboard.stripe.com/${testMode ? "test/" : ""}subscriptions/${subscriptionId}`} target="_blank" rel="noreferrer" className="btn-ghost py-1 text-sm">
            Assinatura na Stripe ↗
          </a>
        )}
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Assinatura</dt>
          <dd className={status === "past_due" ? "font-semibold text-danger" : "font-semibold"}>{STATUS[status] ?? status}{cancelAt ? `, termina em ${new Date(cancelAt).toLocaleDateString("pt-BR")}` : ""}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Próximo mês</dt>
          <dd className="font-semibold tabular">{brlCents(monthlyCents / 100)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Pacotes</dt>
          <dd>{packs.filter(isPackId).map((p) => PACKS[p].name).join(", ") || "nenhum"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Crédito do excedente</dt>
          <dd className="font-semibold tabular">{brlCents(creditCents / 100)}{autoRecharge ? " · recarga automática" : ""}</dd>
        </div>
      </dl>
      <ActionForm action={grantCredit.bind(null, agencyId)} className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Dar crédito (R$)</span>
          <input name="amount" inputMode="numeric" placeholder="50" className="input w-[96px] py-1" />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Motivo (vai para a auditoria)</span>
          <input name="reason" placeholder="ex.: compensação da falha de 16/10" className="input py-1" />
        </label>
        <SubmitButton className="btn-ghost py-1" pendingLabel="Dando…">Dar crédito</SubmitButton>
      </ActionForm>
      <ActionForm action={checkUnsizedChannels.bind(null, agencyId)} className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-muted">Chatbots sem tamanho com canal: o WhatsApp e o Instagram desconectam (a tarefa diária confere todas as contas).</span>
        <SubmitButton className="btn-ghost py-1" pendingLabel="Conferindo…">Conferir agora</SubmitButton>
      </ActionForm>
    </section>
  );
}
