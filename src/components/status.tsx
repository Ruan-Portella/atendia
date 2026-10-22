export function Status({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    live: ["No ar", "var(--color-brand)"],
    demo: ["Demo", "var(--color-amber-ink)"],
    draft: ["Rascunho", "var(--color-muted)"],
    training: ["Treinando", "var(--color-info)"],
    error: ["Erro", "var(--color-danger)"],
    template: ["Modelo", "var(--color-info)"],
  };
  const [label, color] = map[status] ?? [status, "var(--color-muted)"];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color }}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
