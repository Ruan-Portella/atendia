import { ConfirmAction } from "@/components/ui/confirm-action";
import { changeCampaign } from "@/app/painel/campanhas/actions";
import type { CampaignStatus } from "@/lib/campaigns";

/** Pausar, retomar e cancelar (lista e relatório de campanhas). */
export function CampaignActions({ id, name, status }: { id: string; name: string; status: CampaignStatus }) {
  const active = status === "sending" || status === "scheduled";
  return (
    <div className="flex flex-wrap gap-3">
      {active && (
        <ConfirmAction action={changeCampaign.bind(null, id, "paused")} title={`Pausar ${name}?`} description="O que já saiu continua valendo; o resto espera você retomar." confirmLabel="Pausar" danger={false} className="text-xs font-semibold text-amber-ink hover:underline">
          Pausar
        </ConfirmAction>
      )}
      {status === "paused" && (
        <ConfirmAction action={changeCampaign.bind(null, id, "sending")} title={`Retomar ${name}?`} description="Os envios que faltam saem em até um minuto, com as mesmas conferências (aceite, SAIR e 18+)." confirmLabel="Retomar" danger={false} className="text-xs font-semibold text-brand hover:underline">
          Retomar
        </ConfirmAction>
      )}
      {(active || status === "paused") && (
        <ConfirmAction action={changeCampaign.bind(null, id, "canceled")} title={`Cancelar ${name}?`} description="O que faltava enviar não sai mais. Não dá para desfazer." confirmLabel="Cancelar campanha" className="text-xs font-semibold text-danger hover:underline">
          Cancelar
        </ConfirmAction>
      )}
    </div>
  );
}
