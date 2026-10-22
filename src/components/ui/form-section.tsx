import { ChevronDown } from "lucide-react";
import { SubmitButton } from "./submit-button";
import { cn } from "@/lib/utils";

/**
 * Um bloco de ajustes que abre e fecha (redesenho, etapa 5): fechado, mostra o título e o resumo
 * do que está configurado; aberto, os campos. Os campos de um bloco fechado continuam no
 * formulário e vão no Salvar (um campo com erro abre o bloco dele; ver ui/form-errors).
 */
export function FormSection({ title, summary, defaultOpen = false, icon, className, children }: { title: string; summary?: React.ReactNode; defaultOpen?: boolean; icon?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className={cn("group/sec card overflow-hidden", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 transition-colors duration-[120ms] hover:bg-raised/40 [&::-webkit-details-marker]:hidden">
        {icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-2">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-ink">{title}</span>
          {summary && <span className="block truncate text-[12.5px] text-muted group-open/sec:hidden">{summary}</span>}
        </span>
        <ChevronDown size={16} className="shrink-0 text-muted transition-transform duration-[220ms] group-open/sec:rotate-180" />
      </summary>
      <div className="flex flex-col gap-4 border-t border-line-2 px-4 py-4">{children}</div>
    </details>
  );
}

/** O Salvar sempre à vista, preso no rodapé da tela enquanto o formulário rola. */
export function SaveBar({ note = "As mudanças valem depois de salvar.", label = "Salvar" }: { note?: string; label?: string }) {
  return (
    <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-[14px] bg-panel/95 px-4 py-2.5 shadow-[inset_0_0_0_1px_var(--color-line),var(--shadow-pop)] backdrop-blur">
      <span className="text-[12.5px] text-muted">{note}</span>
      <SubmitButton className="btn-primary px-5">{label}</SubmitButton>
    </div>
  );
}

/** Pílula de situação (ligado, desligado, atenção), com o ponto da cor. */
export function StatusPill({ tone = "muted", children }: { tone?: "ok" | "muted" | "warn" | "danger"; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium", tone === "ok" ? "bg-brand-soft text-brand" : tone === "warn" ? "bg-amber-soft text-amber-ink" : tone === "danger" ? "bg-danger-soft text-danger" : "bg-raised text-muted")}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/**
 * Um item de uma lista que abre e fecha (roteiros, ações): fechado, a linha com o nome, a situação
 * e o resumo; aberto, o editor. Vai dentro de um card, um embaixo do outro.
 */
export function RowSection({ title, mono = false, status, meta, warn, aside, children }: { title: string; mono?: boolean; status?: React.ReactNode; meta?: React.ReactNode; warn?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="group/row border-b border-line-2 last:border-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors duration-[120ms] hover:bg-raised/40 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("text-sm font-medium text-ink", mono && "font-mono")}>{title}</span>
            {status}
          </span>
          {meta && <span className="mt-0.5 block truncate text-[12.5px] text-muted">{meta}</span>}
          {warn && <span className="mt-0.5 block text-[12.5px] text-amber-ink">{warn}</span>}
        </span>
        {aside && <span className="hidden shrink-0 text-right text-xs text-muted sm:block">{aside}</span>}
        <ChevronDown size={16} className="shrink-0 text-muted transition-transform duration-[220ms] group-open/row:rotate-180" />
      </summary>
      <div className="flex flex-col gap-4 border-t border-line-2 px-4 py-4">{children}</div>
    </details>
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
