import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { setBotOverage } from "@/app/painel/actions";
import { OVERAGE_PRICE_BRL, brlCents, num } from "@/lib/plans";

interface Props {
  botId: string;
  enabled: boolean;
  capBrl: number | null;
  /** Teto sugerido quando ainda não tem um: o preço do tamanho (o mês sai no máximo pelo dobro). */
  defaultCap: number;
  used: number;
  max: number;
}

const capField = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ","));

/**
 * Excedente de um chatbot na tela de uso: ligado, a cota cheia não para o chatbot e cada
 * atendimento a mais custa o preço do excedente, até o teto do mês.
 */
export function OverageForm({ botId, enabled, capBrl, defaultCap, used, max }: Props) {
  return (
    <ActionForm action={setBotOverage.bind(null, botId)} className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" name="enabled" defaultChecked={enabled} />
          ligado
        </label>
        <label className="flex items-center gap-1 text-xs text-muted">
          teto R$
          <input name="cap" defaultValue={capField(capBrl ?? defaultCap)} inputMode="decimal" aria-label="Teto do excedente no mês, em reais" className="input w-[84px] py-1 text-xs" />
        </label>
        <SubmitButton className="btn-ghost py-1 text-xs" pendingLabel="Salvando…">Salvar</SubmitButton>
      </div>
      {enabled && (
        <span className="text-xs text-muted tabular">
          {num(used)} de {num(max)} a mais · {brlCents(used * OVERAGE_PRICE_BRL)}
        </span>
      )}
    </ActionForm>
  );
}
