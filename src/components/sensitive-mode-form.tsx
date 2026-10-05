import { SENSITIVE_DAYS } from "@/lib/retention";
import type { ActionResult } from "@/lib/action-result";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

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
