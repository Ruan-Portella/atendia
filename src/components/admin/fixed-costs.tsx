import { Trash2 } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { addFixedCost, deleteFixedCost, updateFixedCost } from "@/app/admin/(protegido)/custos/actions";
import type { FixedCost } from "@/lib/backoffice";
import { brl } from "@/lib/plans";

const money = (c: Pick<FixedCost, "amount" | "currency">) => (c.currency === "USD" ? `US$ ${c.amount.toFixed(2)}` : brl(c.amount));
const amountField = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2, useGrouping: false });

function Fields({ cost }: { cost?: FixedCost }) {
  return (
    <>
      <input name="name" defaultValue={cost?.name} required maxLength={80} placeholder="ex.: Vercel Pro" className="input sm:flex-[2]" aria-label="Nome" />
      <div className="flex gap-2 sm:flex-[1.4]">
        <select name="currency" defaultValue={cost?.currency ?? "BRL"} className="input w-[88px] shrink-0" aria-label="Moeda">
          <option value="BRL">R$</option>
          <option value="USD">US$</option>
        </select>
        <input name="amount" defaultValue={cost ? amountField(cost.amount) : ""} required inputMode="decimal" placeholder="0,00" className="input" aria-label="Valor mensal" />
      </div>
      <input name="notes" defaultValue={cost?.notes ?? ""} maxLength={200} placeholder="observação (opcional)" className="input sm:flex-[2]" aria-label="Observação" />
      <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted"><input type="checkbox" name="active" defaultChecked={cost?.active ?? true} /> ativo</label>
    </>
  );
}

/** Custos fixos mensais (entram na margem). Cada linha é um formulário; a última adiciona. */
export function FixedCosts({ costs, totalBrl }: { costs: FixedCost[]; totalBrl: number }) {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Custos fixos mensais</h2>
        <span className="text-sm text-muted">total ativo: <strong className="text-ink tabular">{brl(totalBrl)}</strong> por mês (entra na margem)</span>
      </div>
      <p className="-mt-1 text-xs text-muted">Hospedagem, banco, e-mail, domínio, ferramentas. Em dólar, a conta usa o USD_BRL.</p>
      <ul className="flex flex-col gap-2">
        {costs.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <ActionForm action={updateFixedCost.bind(null, c.id)} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <Fields cost={c} />
              <SubmitButton className="btn-ghost shrink-0" pendingLabel="…">Salvar</SubmitButton>
            </ActionForm>
            <ConfirmAction action={deleteFixedCost.bind(null, c.id)} title={`Apagar "${c.name}"?`} description={`${money(c)} por mês deixa de entrar na margem. Para só pausar, desmarque "ativo".`} confirmLabel="Apagar" className="btn-icon mt-1.5">
              <Trash2 size={15} />
              <span className="sr-only">Apagar</span>
            </ConfirmAction>
          </li>
        ))}
      </ul>
      <ActionForm action={addFixedCost} success="Custo adicionado." className="flex flex-col gap-2 border-t border-line-2 pt-3 sm:flex-row sm:items-center">
        <Fields />
        <SubmitButton className="btn-primary shrink-0" pendingLabel="…">Adicionar</SubmitButton>
      </ActionForm>
    </section>
  );
}
