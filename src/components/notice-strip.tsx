import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Um aviso do painel (plano, IA pausada, canal suspenso…), num cartão dentro dos Avisos (o sino do
 * menu; redesenho, 22/10: as faixas fixas do topo saíram). O data-aviso e o data-tom contam no sino.
 */
export function NoticeStrip({ tone = "danger", action, children }: { tone?: "danger" | "warn"; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div data-aviso data-tom={tone} className={cn("flex flex-col gap-3 rounded-[14px] border p-3.5 text-sm leading-relaxed text-ink", tone === "danger" ? "border-danger-line bg-danger-soft" : "border-amber-line bg-amber-soft")}>
      <div className="flex gap-2.5">
        <AlertTriangle size={16} className={cn("mt-0.5 shrink-0", tone === "danger" ? "text-danger" : "text-amber-ink")} />
        <span className="min-w-0 flex-1">{children}</span>
      </div>
      {action && <div className="flex flex-wrap items-center gap-2 pl-[26px]">{action}</div>}
    </div>
  );
}
