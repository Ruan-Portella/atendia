import { ConfirmAction } from "@/components/ui/confirm-action";
import type { ActionResult } from "@/lib/action-result";
import type { WithdrawalState } from "@/lib/withdrawal";
import { company } from "@/lib/company";

const dateBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Desistência em 7 dias (Trava da conta grátis, parte 2) em Cobrança: nos 7 dias do primeiro
 * pagamento, o botão; com a pessoa marcada por uma desistência anterior, o caminho pelo suporte.
 */
export function WithdrawalCard({ state, action }: { state: WithdrawalState; action: () => Promise<ActionResult> }) {
  if (state.kind === "none") return null;
  if (state.kind === "done") {
    return <p className="mt-4 rounded-lg border border-line-2 px-3 py-2 text-sm">Você desistiu da assinatura em {dateBR(state.at)}, e o que foi pago desde a assinatura foi estornado. Para usar de novo, é só assinar.</p>;
  }
  return (
    <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-2 px-4 py-3 text-sm">
      <div className="min-w-0 max-w-[640px]">
        <p className="font-semibold">Desistir em 7 dias</p>
        {state.kind === "open" ? (
          <p className="text-muted">
            Você assinou em {dateBR(state.since)}. Até {dateBR(state.until)}, dá para desistir: estornamos tudo o que foi pago desde então (assinatura, subidas e crédito), a assinatura acaba na hora e os chatbots ficam sem tamanho (o WhatsApp e o Instagram desconectam; a configuração fica guardada). A conta volta para a conta grátis, sem as respostas de teste.
          </p>
        ) : (
          <p className="text-muted">
            Até {dateBR(state.until)}, a desistência desta assinatura é feita pelo suporte, porque já houve uma desistência recente com estes dados. Escreva para <span className="font-semibold text-ink">{company.email}</span> com o nome da conta.
          </p>
        )}
      </div>
      {state.kind === "open" && (
        <ConfirmAction
          action={action}
          title="Desistir da assinatura?"
          description="Estornamos tudo o que foi pago desde a assinatura e ela acaba agora: os chatbots ficam sem tamanho, o WhatsApp e o Instagram desconectam e a conta volta para a conta grátis, sem as respostas de teste. Não dá para desfazer (para voltar, assine de novo)."
          confirmLabel="Desistir e estornar"
          className="btn-ghost shrink-0 text-danger"
        >
          Desistir da assinatura
        </ConfirmAction>
      )}
    </section>
  );
}
