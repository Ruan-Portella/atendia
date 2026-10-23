"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MultiOption {
  value: string;
  label: string;
  /** o grupo na lista (ex.: o cliente do chatbot) */
  group?: string;
}

/**
 * Escolha de vários itens com busca (redesenho, etapa 5, a pedido do usuário em 22/10: no lugar de
 * uma lista de caixinhas). Os escolhidos ficam como etiquetas no campo; a lista abre embaixo,
 * agrupada, com a busca, o "Todos" e o "Limpar". Cada escolhido vai no formulário como um campo
 * `name` (como as caixinhas iam). Teclado: setas, Enter, Esc e Backspace tira o último.
 */
export function MultiSelect({ name, options, defaultValue = [], placeholder = "Escolha…", label, empty = "Nada encontrado." }: { name: string; options: MultiOption[]; defaultValue?: string[]; placeholder?: string; label: string; empty?: string }) {
  const [picked, setPicked] = useState<string[]>(() => defaultValue.filter((v) => options.some((o) => o.value === v)));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = norm(query.trim());
  const shown = options.filter((o) => !q || norm(`${o.label} ${o.group ?? ""}`).includes(q));
  const byValue = new Map(options.map((o) => [o.value, o]));
  const toggle = (v: string) => setPicked((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  // fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(shown.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      // Enter escolhe, sem mandar o formulário
      e.preventDefault();
      if (open && shown[hi]) toggle(shown[hi].value);
      else setOpen(true);
    } else if (e.key === "Escape") {
      if (open) {
        // fecha a lista sem fechar o modal
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    } else if (e.key === "Backspace" && !query && picked.length) {
      setPicked((cur) => cur.slice(0, -1));
    }
  };

  return (
    <div ref={root} className="relative">
      {picked.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
      <div
        onClick={() => {
          setOpen(true);
          input.current?.focus();
        }}
        className={cn("input flex min-h-[44px] cursor-text flex-wrap items-center gap-1.5 py-1.5 pr-9", open && "border-brand ring-[3px] ring-brand/25")}
      >
        {picked.map((v) => {
          const o = byValue.get(v);
          return (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pl-2.5 pr-1 text-[13px] text-brand">
              {o?.label ?? v}
              {o?.group && <span className="text-brand/70">· {o.group}</span>}
              <button
                type="button"
                aria-label={`Tirar ${o?.label ?? v}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(v);
                }}
                className="rounded-full p-0.5 hover:bg-brand/15"
              >
                <X size={12} />
              </button>
            </span>
          );
        })}
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={label}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHi(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={picked.length ? "" : placeholder}
          className="min-w-[8rem] flex-1 bg-transparent py-0.5 text-sm text-ink outline-none placeholder:text-muted"
        />
        <ChevronDown size={16} className={cn("pointer-events-none absolute right-3 top-3.5 text-muted transition-transform duration-[120ms]", open && "rotate-180")} />
      </div>
      {open && (
        // dentro do fluxo (empurra o resto para baixo): num modal, uma lista por cima seria cortada pela borda
        <div className="mt-1 overflow-hidden rounded-[14px] border border-line bg-panel shadow-[0_8px_24px_rgb(0_0_0/0.08)]">
          <div className="flex items-center justify-between gap-2 border-b border-line-2 px-3 py-1.5 text-xs">
            <span className="text-muted">{picked.length ? `${picked.length} escolhido${picked.length === 1 ? "" : "s"}` : "Nenhum escolhido"}</span>
            <span className="flex gap-3">
              <button type="button" onClick={() => setPicked([...new Set([...picked, ...shown.map((o) => o.value)])])} className="font-medium text-brand hover:underline">
                {q ? "Escolher os achados" : "Escolher todos"}
              </button>
              {picked.length > 0 && (
                <button type="button" onClick={() => setPicked([])} className="font-medium text-muted hover:text-ink">
                  Limpar
                </button>
              )}
            </span>
          </div>
          <ul id={listId} role="listbox" aria-multiselectable className="max-h-56 overflow-y-auto py-1">
            {shown.map((o, i) => {
              const on = picked.includes(o.value);
              // o nome do grupo aparece antes do primeiro item dele
              const head = o.group && o.group !== shown[i - 1]?.group ? o.group : undefined;
              return (
                <li key={o.value} role="presentation">
                  {head && <span className="block px-3 pb-0.5 pt-2 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{head}</span>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => {
                      toggle(o.value);
                      input.current?.focus();
                    }}
                    className={cn("flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm", i === hi ? "bg-raised" : "")}
                  >
                    <span className={cn("flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]", on ? "bg-brand text-on-brand" : "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]")}>{on && <Check size={12} strokeWidth={3} />}</span>
                    <span className="truncate text-ink">{o.label}</span>
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="px-3 py-3 text-center text-sm text-muted">{empty}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
