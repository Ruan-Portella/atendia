"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquareText, Search } from "lucide-react";
import { fold } from "@/lib/go-to";
import { cn } from "@/lib/utils";
import type { QuickReply } from "@/lib/quick-replies";

/**
 * As respostas prontas no campo de resposta (23/10/2026, a pedido do usuário): no lugar do select,
 * um botão que abre a lista para cima com a busca (pelo título e pelo texto), as setas para
 * escolher e o Enter para pôr no campo. Fecha com Esc ou clique fora.
 */
export function QuickReplyPicker({ replies, onPick }: { replies: QuickReply[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const q = fold(query.trim());
  const shown = q ? replies.filter((r) => fold(`${r.title} ${r.body}`).includes(q)) : replies;
  const current = Math.min(index, Math.max(0, shown.length - 1));

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setIndex(0);
  };
  const pick = (id: string | undefined) => {
    if (!id) return;
    onPick(id);
    close();
  };

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} title="Respostas prontas" className="inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2 text-[12.5px] text-muted transition-colors duration-[120ms] hover:bg-raised hover:text-ink">
        <MessageSquareText size={16} />
        <span className="hidden sm:inline">Respostas prontas</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Respostas prontas"
          className="menu-in absolute bottom-full left-0 z-30 mb-2 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[14px] border border-line bg-panel shadow-[inset_0_1px_0_var(--highlight),var(--shadow-pop)]"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex(Math.min(current + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex(Math.max(current - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(shown[current]?.id);
            }
          }}
        >
          <label className="flex items-center gap-2 border-b border-line-2 px-3 py-2">
            <Search size={14} className="shrink-0 text-muted" />
            <span className="sr-only">Buscar resposta pronta</span>
            <input
              ref={input}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              placeholder="Buscar pelo título ou pelo texto"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
            />
            <span className="font-mono text-[10.5px] text-muted">{shown.length}</span>
          </label>
          <ul className="max-h-[280px] overflow-y-auto p-1.5">
            {shown.length === 0 && <li className="px-2 py-4 text-center text-[13px] text-muted">Nenhuma resposta com &ldquo;{query.trim()}&rdquo;.</li>}
            {shown.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  data-index={i}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => pick(r.id)}
                  className={cn("flex w-full flex-col gap-0.5 rounded-[10px] px-2.5 py-2 text-left", i === current ? "bg-raised" : "hover:bg-raised/60")}
                >
                  <span className="truncate text-[13px] font-medium text-ink">{r.title}</span>
                  <span className="line-clamp-2 text-[12px] leading-snug text-muted">{r.body}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
