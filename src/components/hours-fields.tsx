import { WEEKDAYS, type BusinessHours } from "@/lib/handoff-hours";

/** Horário de atendimento por dia (Brasília): abre e fecha; dia em branco = fechado. Painel e portal. */
export function HoursFields({ hours }: { hours: BusinessHours | null | undefined }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      {WEEKDAYS.map((day, d) => {
        const h = (hours ?? {})[String(d) as keyof BusinessHours];
        return (
          <div key={day} className="flex flex-wrap items-center gap-3 border-b border-line-2 px-4 py-2.5 text-sm last:border-0">
            <span className="w-20 font-medium capitalize">{day}</span>
            <label className="flex items-center gap-1.5 text-muted">das <input type="time" name={`hours_open_${d}`} defaultValue={h?.[0] ?? ""} className="input w-auto py-1.5" aria-label={`${day}: abre`} /></label>
            <label className="flex items-center gap-1.5 text-muted">às <input type="time" name={`hours_close_${d}`} defaultValue={h?.[1] ?? ""} className="input w-auto py-1.5" aria-label={`${day}: fecha`} /></label>
          </div>
        );
      })}
    </div>
  );
}
