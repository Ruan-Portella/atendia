import { SENSITIVE_DAYS } from "@/lib/retention";
import type { ActionResult } from "@/lib/action-result";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { SwitchField } from "@/components/ui/setting-row";

/** Modo dados sensíveis de um chatbot: ligar e o prazo (7 a 90 dias). Área do cliente e painel. */
export function SensitiveModeForm({ bot, action, label = "Ligar o modo dados sensíveis" }: {
  bot: { id: string; name: string; sensitive_mode: boolean | null; sensitive_retention_days: number | null; sensitive_mode_suggested_at: string | null };
  action: (fd: FormData) => Promise<ActionResult>;
  label?: string;
}) {
  const on = Boolean(bot.sensitive_mode);
  const days = bot.sensitive_retention_days || 30;
  return (
    <ActionForm key={`${bot.id}${on}${days}`} action={action} className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>{bot.name}</strong>
        <span className={on ? "rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand" : "text-xs text-muted"}>{on ? `Ligado · ${days} dias` : "Desligado"}</span>
      </div>
      {!on && bot.sensitive_mode_suggested_at && (
        <p className="rounded-lg border border-amber/40 bg-amber-soft px-3 py-2 text-xs text-amber-ink">Sugerido: a análise do assistente indica um negócio de saúde. Ligar diminui o tempo em que conversas com dados de saúde ficam guardadas.</p>
      )}
      <label className="flex items-center gap-2.5 text-sm">
        <input type="checkbox" name="sensitive" defaultChecked={on} />
        {label}
      </label>
      <div>
        <label htmlFor={`days-${bot.id}`} className="label">Guardar as conversas por</label>
        <select id={`days-${bot.id}`} name="days" defaultValue={String(days)} className="input max-w-[200px]">
          {SENSITIVE_DAYS.map((d) => <option key={d} value={d}>{d} dias</option>)}
        </select>
      </div>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name="confirm" className="mt-1" />
        <span className="text-muted">Se o prazo diminuir: entendo que as conversas mais antigas são apagadas na próxima limpeza diária, sem desfazer.</span>
      </label>
      <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
    </ActionForm>
  );
}

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
