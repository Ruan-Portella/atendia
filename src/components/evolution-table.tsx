import { minutesLabel, type EvolutionMonth } from "@/lib/evolution";
import { Kpi } from "@/components/kpi";

/** "Out/26" */
const monthShort = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  const name = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}/${String(y).slice(2)}`;
};
const num = (n: number) => new Intl.NumberFormat("pt-BR").format(n);
const dash = <span className="text-muted">—</span>;

/**
 * A Evolução mês a mês (Lançamento, parte 4b), no painel e no relatório do cliente (sem a marca
 * BoaVoz: `color` é a cor da agência): o mês mais novo em cima, com a barra do quanto o
 * assistente resolveu sozinho.
 */
export function EvolutionTable({ months, color }: { months: EvolutionMonth[]; color?: string }) {
  // os meses de antes da primeira conversa ficam de fora
  const first = months.findIndex((m) => m.conversations > 0);
  if (first < 0) return <p className="text-sm text-muted">Ainda sem conversas nestes meses.</p>;
  const rows = months.slice(first).reverse();
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[580px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
            <th className="sticky left-0 bg-panel px-3 py-2 font-semibold">Mês</th>
            <th className="px-2.5 py-2 text-right font-semibold">Conversas</th>
            <th className="px-2.5 py-2 font-semibold">Resolvidas pelo assistente</th>
            <th className="px-2.5 py-2 text-right font-semibold">Para a equipe</th>
            <th className="px-2.5 py-2 text-right font-semibold">Até a equipe assumir</th>
            <th className="px-2.5 py-2 text-right font-semibold">Satisfação</th>
            <th className="px-3 py-2 text-right font-semibold">Contatos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period} className="border-b border-line-2 last:border-0">
              <td className="sticky left-0 whitespace-nowrap bg-panel px-3 py-2 font-semibold">{monthShort(r.period)}</td>
              <td className="px-2.5 py-2 text-right tabular-nums">{num(r.conversations)}</td>
              <td className="px-2.5 py-2">
                {r.resolvedPct === null ? dash : (
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-line-2" aria-hidden>
                      <span className={`block h-full rounded-full${color ? "" : " bg-brand"}`} style={{ width: `${r.resolvedPct}%`, background: color }} />
                    </span>
                    <span className="tabular-nums">
                      {r.resolvedPct}% <span className="text-muted">({num(r.resolvedByAi)})</span>
                    </span>
                  </span>
                )}
              </td>
              <td className="px-2.5 py-2 text-right tabular-nums">{num(r.toTeam)}</td>
              <td className="px-2.5 py-2 text-right tabular-nums">{r.teamMinutes === null ? dash : minutesLabel(r.teamMinutes)}</td>
              <td className="px-2.5 py-2 text-right tabular-nums" title={r.answered ? `${num(r.answered)} resposta${r.answered === 1 ? "" : "s"} na pesquisa` : undefined}>
                {r.goodPct === null ? dash : `${r.goodPct}% Ótimo`}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{num(r.leads)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A diferença para o mês anterior, em texto curto ("+12 que setembro"); sem o mês anterior, nada. Pura. */
export function deltaLabel(cur: number | null, prev: number | null, unit = "", prevName = "o mês anterior"): string | null {
  if (cur === null || prev === null) return null;
  const d = cur - prev;
  if (d === 0) return `igual a ${prevName}`;
  return `${d > 0 ? "+" : "−"}${num(Math.abs(d))}${unit} que ${prevName}`;
}

/**
 * Os números do mês em cartões, em cima da tabela (redesenho, 23/10/2026): o mês mais novo com
 * conversa e a diferença para o anterior.
 */
export function EvolutionSummary({ months }: { months: EvolutionMonth[] }) {
  const withData = months.filter((m) => m.conversations > 0);
  const cur = withData[withData.length - 1];
  if (!cur) return null;
  const prev = withData[withData.length - 2] ?? null;
  const prevName = prev ? monthShort(prev.period) : "o mês anterior";
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Kpi label={`Conversas · ${monthShort(cur.period)}`} value={num(cur.conversations)} sub={deltaLabel(cur.conversations, prev?.conversations ?? null, "", prevName) ?? "primeiro mês"} />
      <Kpi label="Resolvidas pelo assistente" value={cur.resolvedPct === null ? "—" : `${cur.resolvedPct}%`} sub={deltaLabel(cur.resolvedPct, prev?.resolvedPct ?? null, " p.p.", prevName) ?? `${num(cur.resolvedByAi)} conversas`} />
      <Kpi label="Para a equipe" value={num(cur.toTeam)} sub={cur.teamMinutes === null ? "sem atendimento" : `até assumir: ${minutesLabel(cur.teamMinutes)}`} />
      <Kpi label="Satisfação" value={cur.goodPct === null ? "—" : `${cur.goodPct}%`} sub={cur.answered ? `Ótimo em ${num(cur.answered)} respostas` : "sem respostas"} />
    </div>
  );
}
