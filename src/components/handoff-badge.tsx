import { HANDOFF_LABEL, handoffStatus, type HandoffFields } from "@/lib/handoff-status";
import { cn } from "@/lib/utils";

/** Selo do atendimento humano nas listas: urgente, esperando, assumida sem resposta, em atendimento. */
export function HandoffBadge({ conv, className }: { conv: HandoffFields; className?: string }) {
  const s = handoffStatus(conv);
  if (!s) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {s.urgent && <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white">urgente: risco à vida</span>}
      <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", s.waiting ? "bg-amber-soft text-amber-ink" : "bg-brand-soft text-brand")}>{HANDOFF_LABEL[s.state]}</span>
    </span>
  );
}
