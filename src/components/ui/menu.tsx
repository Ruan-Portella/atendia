"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export type MenuItem =
  | { type?: "item"; label: string; /** uma linha de explicação embaixo do rótulo */ hint?: string; icon?: React.ComponentType<{ size?: number; className?: string }>; onSelect?: () => void; href?: string; external?: boolean; danger?: boolean; disabled?: boolean }
  | { type: "separator" };

interface MenuProps {
  items: MenuItem[];
  label?: string;
  /** Botão que abre o menu. Padrão: ícone "…". */
  trigger?: React.ReactNode;
  triggerClassName?: string;
  align?: "left" | "right";
}

const MENU_WIDTH = 248;

/**
 * Menu de ações de uma linha (Editar, Copiar, Excluir…).
 * Renderiza num portal com position: fixed, então não é cortado por `overflow-hidden`
 * de cards/tabelas. Fecha com Esc, clique fora, rolagem ou redimensionamento.
 */
export function Menu({ items, label = "Mais ações", trigger, triggerClassName, align = "right" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; bottom: number; left: number; up: boolean } | null>(null);
  // dentro de um modal aberto, o menu abre no próprio modal: fora dele, ficaria atrás e travado
  const [host, setHost] = useState<Element | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // posiciona em relação ao botão; inverte para cima se faltar espaço embaixo
  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setHost(btnRef.current?.closest("dialog[open]") ?? null);
    const estimatedHeight = items.reduce((h, it) => h + (it.type === "separator" ? 9 : "hint" in it && it.hint ? 54 : 38), 12);
    const up = r.bottom + estimatedHeight > window.innerHeight - 8 && r.top > estimatedHeight;
    const left = align === "right" ? Math.max(8, r.right - MENU_WIDTH) : Math.min(r.left, window.innerWidth - MENU_WIDTH - 8);
    setPos({ top: r.bottom + 4, bottom: window.innerHeight - r.top + 4, left, up });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label={trigger ? undefined : label} onClick={toggle} className={triggerClassName ?? (trigger ? undefined : "btn-icon")}>
        {trigger ?? <MoreHorizontal size={16} />}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            role="menu"
            style={{ position: "fixed", left: pos.left, width: MENU_WIDTH, ...(pos.up ? { bottom: pos.bottom } : { top: pos.top }) }}
            className="menu-in z-[80] rounded-[14px] border border-line bg-panel p-1.5 shadow-[inset_0_1px_0_var(--highlight),var(--shadow-pop)]"
          >
            {items.map((it, i) => {
              if (it.type === "separator") return <div key={i} role="separator" className="my-1 h-px bg-line-2" />;
              const Icon = it.icon;
              const cls = cn("menu-item", it.danger && "text-danger hover:bg-danger-soft");
              const inner = (
                <>
                  {Icon && <Icon size={15} className={cn("shrink-0 opacity-80", it.hint && "self-start mt-0.5")} />}
                  {it.hint ? (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{it.label}</span>
                      <span className="block text-xs font-normal leading-snug text-muted">{it.hint}</span>
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  )}
                </>
              );
              if (it.href) {
                return it.external ? (
                  <a key={i} role="menuitem" href={it.href} target="_blank" rel="noopener" className={cls} onClick={() => setOpen(false)}>{inner}</a>
                ) : (
                  <Link key={i} role="menuitem" href={it.href} className={cls} onClick={() => setOpen(false)}>{inner}</Link>
                );
              }
              return (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  className={cls}
                  onClick={() => {
                    setOpen(false);
                    it.onSelect?.();
                  }}
                >
                  {inner}
                </button>
              );
            })}
          </div>,
          host ?? document.body,
        )}
    </>
  );
}
