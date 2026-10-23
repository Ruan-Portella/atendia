"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * As listas do fim do relatório em abas (redesenho, 23/10/2026): Contatos capturados e Últimas
 * conversas, uma de cada vez, para a página rolar menos. Na impressão, as duas aparecem.
 */
export function ReportTabs({ tabs }: { tabs: Array<{ key: string; label: string; count?: number; content: React.ReactNode }> }) {
  const [open, setOpen] = useState(tabs[0]?.key ?? "");
  return (
    <section className="flex flex-col gap-3">
      <nav aria-label="Listas do relatório" className="flex gap-1 self-start rounded-[14px] bg-panel p-1 shadow-[inset_0_0_0_1px_var(--color-line)] print:hidden">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setOpen(t.key)} aria-pressed={open === t.key} className={cn("rounded-[10px] px-4 py-1.5 text-sm transition-colors duration-[120ms]", open === t.key ? "bg-raised font-medium text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink")}>
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 font-mono text-[11px] text-muted">{t.count}</span>}
          </button>
        ))}
      </nav>
      {tabs.map((t) => (
        <div key={t.key} className={cn(open === t.key ? "block" : "hidden print:block")}>
          <h2 className="mb-2 hidden text-base font-medium print:block">{t.label}</h2>
          {t.content}
        </div>
      ))}
    </section>
  );
}
