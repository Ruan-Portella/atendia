import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Peças pequenas das telas de ajuste (redesenho, etapa 5): a pílula de situação e o "Como funciona".
 * As linhas que abrem um modal ficam em ui/setting-row.
 */

/** Pílula de situação (ligado, desligado, atenção), com o ponto da cor. */
export function StatusPill({ tone = "muted", children }: { tone?: "ok" | "muted" | "warn" | "danger"; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium", tone === "ok" ? "bg-brand-soft text-brand" : tone === "warn" ? "bg-amber-soft text-amber-ink" : tone === "danger" ? "bg-danger-soft text-danger" : "bg-raised text-muted")}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** A explicação longa de uma tela, fechada embaixo da frase curta do topo. */
export function HowItWorks({ label = "Como funciona", children }: { label?: string; children: React.ReactNode }) {
  return (
    <details className="group/how text-sm text-muted">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown size={14} className="transition-transform duration-[220ms] group-open/how:rotate-180" />
      </summary>
      <div className="mt-1.5 flex flex-col gap-2">{children}</div>
    </details>
  );
}
