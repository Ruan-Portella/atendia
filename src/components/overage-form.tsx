import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { setBotOverage } from "@/app/painel/actions";
import { OVERAGE_PRICE_BRL, brlCents, num } from "@/lib/plans";

interface Props {
  botId: string;
  enabled: boolean;
  /** Teto do mês do chatbot (opcional: sem teto, o crédito da conta é o limite). */
  capBrl: number | null;
  used: number;
  /** Atendimentos a mais que o teto permite (sem teto, null). */
  capMax: number | null;
  /** O crédito da conta não paga o próximo atendimento a mais. */
  creditShort: boolean;
}

const capField = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ","));

/**
 * Excedente de um chatbot na tela de uso: ligado, a cota cheia não para o chatbot e cada
 * atendimento a mais usa o preço do excedente do crédito da conta, até o teto do mês (opcional).
 */
export function OverageForm({ botId, enabled, capBrl, used, capMax, creditShort }: Props) {
  return (
    <ActionForm action={setBotOverage.bind(null, botId)} className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" name="enabled" defaultChecked={enabled} />
          ligado
        </label>
        <label className="flex items-center gap-1 text-xs text-muted">
          teto R$
          <input name="cap" defaultValue={capBrl ? capField(capBrl) : ""} placeholder="sem teto" inputMode="decimal" aria-label="Teto do excedente no mês, em reais (opcional)" className="input w-[84px] py-1 text-xs" />
        </label>
        <SubmitButton className="btn-ghost py-1 text-xs" pendingLabel="Salvando…">Salvar</SubmitButton>
      </div>
      {enabled && (
        <span className="text-xs text-muted tabular">
          {capMax !== null ? `${num(used)} de ${num(capMax)} a mais` : `${num(used)} a mais`} · {brlCents(used * OVERAGE_PRICE_BRL)}
        </span>
      )}
      {enabled && creditShort && (
        <Link href="/painel/cobranca/credito" className="text-xs font-semibold text-danger underline">
          Sem crédito: comprar
        </Link>
      )}
    </ActionForm>
  );
}
