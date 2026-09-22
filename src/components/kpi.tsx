/** Cartão de número do painel (conversas, leads, etc.). */
export function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card flex flex-col gap-1.5 px-4 py-3.5 sm:px-[18px] sm:py-4">
      <span className="kpi-label">{label}</span>
      <span className="display text-2xl font-bold leading-tight tabular sm:text-[30px]">{value}</span>
      <span className="text-[13px] text-muted">{sub}</span>
    </div>
  );
}
