import { SENSITIVE_DAYS } from "@/lib/retention";
import { SwitchField } from "@/components/ui/setting-row";

/**
 * Os campos do modo dados sensíveis para um modal (redesenho, 23/10/2026): a chave, o prazo em
 * botões e a confirmação. Os mesmos nomes do formulário acima (sensitive, days, confirm).
 */
export function SensitiveModeFields({ bot }: { bot: { id: string; name: string; sensitive_mode: boolean | null; sensitive_retention_days: number | null; sensitive_mode_suggested_at: string | null } }) {
  const on = Boolean(bot.sensitive_mode);
  const days = bot.sensitive_retention_days || 30;
  return (
    <>
      {!on && bot.sensitive_mode_suggested_at && (
        <p className="rounded-[12px] bg-amber-soft px-3 py-2 text-xs text-amber-ink">Sugerido: a análise do assistente indica um negócio de saúde. Ligar diminui o tempo em que conversas com dados de saúde ficam guardadas.</p>
      )}
      <SwitchField name="sensitive" defaultChecked={on} label="Ligar o modo dados sensíveis" hint="Abrir as conversas deste chatbot passa a pedir o segundo fator." />
      <fieldset className="flex flex-col gap-2">
        <legend className="label">Guardar as conversas por</legend>
        <div className="flex flex-wrap gap-2">
          {SENSITIVE_DAYS.map((d) => (
            <label key={d} className="cursor-pointer rounded-[10px] border border-line px-3 py-1.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/60 has-[:checked]:font-medium">
              <input type="radio" name="days" value={d} defaultChecked={days === d} className="sr-only" />
              {d} dias
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-start gap-2.5 rounded-[12px] bg-raised p-3 text-sm">
        <input type="checkbox" name="confirm" className="mt-0.5 accent-brand" />
        <span className="text-ink-2">Se o prazo diminuir: entendo que as conversas mais antigas são apagadas na próxima limpeza diária, sem desfazer.</span>
      </label>
    </>
  );
}
