interface Day {
  day: string; // 'AAAA-MM-DD'
  value: number;
  /** Texto do hover além do valor (ex.: "120 do contato · 118 do bot"). */
  detail?: string;
}

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Barras por dia (backoffice). Hover mostra o dia e o valor; a tabela escondida dá o mesmo a leitores de tela. */
export function DayBars({ days, caption, format = (v) => String(v) }: { days: Day[]; caption: string; format?: (v: number) => string }) {
  const max = Math.max(0, ...days.map((d) => d.value));
  const avg = days.length ? days.reduce((t, d) => t + d.value, 0) / days.length : 0;
  return (
    <figure className="flex flex-col gap-2">
      <div className="relative flex h-36 items-end gap-[2px] border-b border-line" aria-hidden="true">
        <span className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line-2" />
        <span className="pointer-events-none absolute -top-2 right-0 bg-panel pl-1 text-[11px] text-muted tabular">{format(max)}</span>
        {days.map((d) => (
          <div key={d.day} className="group relative flex h-full min-w-0 flex-1 items-end">
            <div className="w-full rounded-t-[3px] bg-brand transition-opacity group-hover:opacity-80" style={{ height: d.value && max ? `${Math.max(3, (d.value / max) * 100)}%` : "0" }} />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs text-ink shadow-[0_8px_24px_rgba(27,31,29,0.14)] group-hover:block">
              <div className="font-semibold">{dayLabel(d.day)}</div>
              <div className="tabular">{format(d.value)}</div>
              {d.detail && <div className="text-muted tabular">{d.detail}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted tabular" aria-hidden="true">
        <span>{days[0] ? dayLabel(days[0].day) : ""}</span>
        <span>média: {format(avg)} por dia</span>
        <span>{days.at(-1) ? dayLabel(days.at(-1)!.day) : ""}</span>
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th>Dia</th><th>Valor</th></tr></thead>
        <tbody>{days.map((d) => <tr key={d.day}><td>{dayLabel(d.day)}</td><td>{format(d.value)}{d.detail ? ` (${d.detail})` : ""}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
