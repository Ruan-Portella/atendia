interface Day {
  day: string; // 'AAAA-MM-DD'
  conversations: number;
  leads: number;
}

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/**
 * Barras de conversas por dia do mês (uma série, na cor da marca). Hover mostra o dia,
 * conversas e leads; a tabela escondida dá o mesmo conteúdo a leitores de tela.
 */
export function DailyBars({ days, color }: { days: Day[]; color: string }) {
  const max = Math.max(1, ...days.map((d) => d.conversations));
  const peak = days.reduce<Day | null>((best, d) => (!best || d.conversations > best.conversations ? d : best), null);
  return (
    <figure className="flex flex-col gap-2">
      <div className="relative flex h-40 items-end gap-[2px] border-b border-line" aria-hidden="true">
        {/* linha de referência do maior valor */}
        <span className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line-2" />
        <span className="pointer-events-none absolute -top-2 right-0 bg-panel pl-1 text-[11px] text-muted tabular">{max}</span>
        {days.map((d) => (
          <div key={d.day} className="group relative flex h-full min-w-0 flex-1 items-end">
            <div
              className="w-full rounded-t-[4px] transition-opacity group-hover:opacity-80"
              style={{ height: d.conversations ? `${Math.max(3, (d.conversations / max) * 100)}%` : "0", background: color }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs text-ink shadow-[0_8px_24px_rgba(27,31,29,0.14)] group-hover:block">
              <div className="font-semibold">{dayLabel(d.day)}</div>
              <div className="tabular">{d.conversations} conversa{d.conversations === 1 ? "" : "s"} · {d.leads} lead{d.leads === 1 ? "" : "s"}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted tabular" aria-hidden="true">
        <span>{days[0] ? dayLabel(days[0].day) : ""}</span>
        {peak && peak.conversations > 0 && <span>pico: {dayLabel(peak.day)} ({peak.conversations})</span>}
        <span>{days.at(-1) ? dayLabel(days.at(-1)!.day) : ""}</span>
      </div>
      <table className="sr-only">
        <caption>Conversas e leads por dia</caption>
        <thead><tr><th>Dia</th><th>Conversas</th><th>Leads</th></tr></thead>
        <tbody>{days.map((d) => <tr key={d.day}><td>{dayLabel(d.day)}</td><td>{d.conversations}</td><td>{d.leads}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
