"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { QUEUES_COOKIE } from "@/lib/theme";
import { cn } from "@/lib/utils";

export interface QueueChip {
  key: string;
  label: string;
  group?: string;
  href: string;
  count: number;
  /** quantas esperam alguém da equipe nesta fila */
  waiting: number;
}

/**
 * As filas da Caixa de entrada (23/10/2026, a pedido do usuário: "não consigo ver de maneira prática
 * se tem alguma conversa na fila"): todas à vista, quebrando a linha, com o número de cada uma e o
 * de quem espera em âmbar; os setores juntos, com o nome do cliente. "Ocultar" deixa só a fila
 * aberta e o resumo de quem espera nas outras; a escolha fica no cookie, como a coluna do contato.
 */
export function QueueBar({ queues, current, initialOpen = true }: { queues: QueueChip[]; current: string; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    document.cookie = `${QUEUES_COOKIE}=${next ? "aberto" : "fechado"}; path=/; max-age=31536000; samesite=lax`;
  };
  const active = queues.find((q) => q.key === current);
  const waitingElsewhere = queues.filter((q) => q.key !== current && q.waiting > 0 && q.key !== "todas" && q.key !== "com_ia");
  const groups: Array<{ name: string | null; items: QueueChip[] }> = [];
  for (const q of queues) {
    const name = q.group ?? null;
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(q);
    else groups.push({ name, items: [q] });
  }

  const chip = (q: QueueChip) => {
    const on = q.key === current;
    return (
      <Link
        key={q.key}
        href={q.href}
        aria-current={on ? "page" : undefined}
        title={q.group ? `${q.group} · ${q.label}` : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] transition-colors duration-[120ms]",
          on ? "bg-ink font-medium text-ground" : q.count > 0 ? "bg-raised/80 text-ink hover:bg-raised" : "text-muted hover:bg-raised/60 hover:text-ink-2",
        )}
      >
        {q.label}
        {q.waiting > 0 ? (
          <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 font-mono text-[10.5px] font-medium", on ? "bg-amber text-ground" : "bg-amber-soft text-amber-ink")} title={`${q.waiting} esperando alguém da equipe`}>
            <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-ground" : "bg-amber")} aria-hidden />
            {q.waiting}
          </span>
        ) : (
          q.count > 0 && <span className={cn("font-mono text-[10.5px]", on ? "text-ground/70" : "text-muted")}>{q.count}</span>
        )}
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="kpi-label">Filas</span>
        {!open && waitingElsewhere.length > 0 && (
          <span className="inline-flex min-w-0 items-center gap-1 truncate rounded-full bg-amber-soft px-2 py-0.5 text-[11.5px] font-medium text-amber-ink">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" aria-hidden />
            Esperando em {waitingElsewhere.length === 1 ? waitingElsewhere[0].label : `${waitingElsewhere.length} filas`}
          </span>
        )}
        <button type="button" onClick={toggle} aria-expanded={open} className="ml-auto inline-flex items-center gap-1 rounded-[8px] px-1.5 py-0.5 text-[12px] text-muted hover:bg-raised hover:text-ink">
          {open ? "Ocultar" : "Mostrar todas"}
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>
      {open ? (
        <div className="relative flex max-h-[38vh] flex-col gap-2 overflow-y-auto">
          {groups.map((g, k) => (
            <div key={`${g.name ?? "base"}-${k}`} className="flex flex-col gap-1">
              {g.name && <span className="px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{g.name}</span>}
              <div className="flex flex-wrap gap-1">{g.items.map(chip)}</div>
            </div>
          ))}
        </div>
      ) : (
        active && <div className="flex flex-wrap gap-1">{chip(active)}</div>
      )}
    </div>
  );
}
