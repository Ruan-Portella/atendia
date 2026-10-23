"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bell, X } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Avisos do painel (redesenho, 22/10): plano e cota, pagamento, IA pausada, canal suspenso,
 * segurança, exclusão da conta e o convite dos avisos no WhatsApp saíram das faixas fixas do topo
 * e ficam aqui, atrás do sino (no menu e na barra do celular), com o número de avisos.
 */

interface Snap {
  count: number;
  /** algum aviso grave (vermelho): o número do sino fica vermelho */
  danger: boolean;
}

const COUNT_EVENT = "bv-avisos";
const OPEN_EVENT = "bv-avisos-abrir";
const EMPTY: Snap = { count: 0, danger: false };
let snap: Snap = EMPTY;

function subscribe(cb: () => void) {
  window.addEventListener(COUNT_EVENT, cb);
  return () => window.removeEventListener(COUNT_EVENT, cb);
}

export function useNotices(): Snap {
  return useSyncExternalStore(subscribe, () => snap, () => EMPTY);
}

export const openNotices = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** O sino: abre os avisos; o número diz quantos há (vermelho e pulsando quando algum é grave). */
export function NoticeBell({ className }: { className?: string }) {
  const { count, danger } = useNotices();
  return (
    <button type="button" onClick={openNotices} aria-label={count ? `Avisos: ${count}` : "Avisos"} title="Avisos" className={cn("btn-icon relative", className)}>
      <Bell size={16} />
      {count > 0 && (
        <span key={count} className={cn("absolute -right-0.5 -top-0.5 min-w-4 rounded-full px-1 text-center font-mono text-[9.5px] leading-4 [animation:bv-pop_var(--dur-slow)_var(--ease-spring)]", danger ? "bg-danger text-on-danger" : "bg-amber text-ground")} aria-hidden>
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * O painel dos avisos, que desliza da direita. Os avisos (cada um com data-aviso e data-tom) ficam
 * sempre na página, escondidos, para o sino saber quantos são.
 */
export function NoticeCenter({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const { count } = useNotices();

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const update = () => {
      const items = Array.from(el.querySelectorAll("[data-aviso]"));
      const next = { count: items.length, danger: items.some((i) => i.getAttribute("data-tom") === "danger") };
      if (next.count !== snap.count || next.danger !== snap.danger) {
        snap = next;
        window.dispatchEvent(new Event(COUNT_EVENT));
      }
    };
    update();
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className={open ? "fixed inset-0 z-[60]" : "hidden"} role="dialog" aria-modal="true" aria-label="Avisos">
      <button type="button" aria-label="Fechar os avisos" onClick={() => setOpen(false)} className="absolute inset-0 bg-scrim [animation:fade-in_var(--dur-base)_var(--ease-out)]" />
      {/* um link de dentro (escolher o tamanho, pagar a fatura…) fecha os avisos */}
      <aside onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)} className="absolute inset-y-0 right-0 flex w-[min(420px,92vw)] flex-col bg-panel shadow-[var(--shadow-pop)] [animation:rise-in_var(--dur-base)_var(--ease-out)]">
        <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Bell size={17} className="text-brand" />
          <h2 className="flex-1 text-lg font-medium">Avisos</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="btn-icon h-9 w-9">
            <X size={17} />
          </button>
        </header>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
          {count === 0 && <p className="px-5 py-10 text-center text-sm text-muted">Nenhum aviso agora. Quando algo precisar de você (cota, pagamento, canal, segurança), aparece aqui.</p>}
          <div ref={list} className="flex flex-col gap-3 p-4 empty:hidden">{children}</div>
        </div>
      </aside>
    </div>
  );
}
