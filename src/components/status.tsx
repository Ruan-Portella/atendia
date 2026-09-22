export function Status({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    live: ["No ar", "#1f4e3d"],
    demo: ["Demo", "#e9a23b"],
    draft: ["Rascunho", "#8a938e"],
    training: ["Treinando", "#2a6fd6"],
    error: ["Erro", "#b23a3a"],
  };
  const [label, color] = map[status] ?? [status, "#8a938e"];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: status === "demo" ? "#a5691a" : color }}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
