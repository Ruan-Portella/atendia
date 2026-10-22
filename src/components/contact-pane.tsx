"use client";

import { useEffect, useState } from "react";
import { PanelRightClose, PanelRightOpen, UserRound, X } from "lucide-react";
import { CONTACT_COOKIE } from "@/lib/theme";
import { initials } from "@/lib/utils";

const EVENT = "bv-contato";

/** O botão "Contato" do topo da conversa: mostra e esconde o painel do contato. */
export function ContactToggle() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(EVENT))} aria-label="Contato" title="Contato" className="btn-icon h-9 w-9">
      <UserRound size={17} />
    </button>
  );
}

/**
 * O painel do contato na Caixa de entrada. Em telas de 1400 px ou mais (`wide`), é a coluna da
 * direita, que esconde e mostra pelo botão (escondida, vira uma faixa com as iniciais; a escolha
 * fica no navegador). Nas telas menores e na área do cliente, abre deslizando da direita pelo
 * botão "Contato" do topo da conversa.
 */
export function ContactPane({ initialOpen = true, name, wide = true, children }: { initialOpen?: boolean; name: string | null; wide?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initialOpen);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    document.cookie = `${CONTACT_COOKIE}=${open ? "aberto" : "fechado"}; path=/; max-age=31536000; samesite=lax`;
  }, [open]);
  useEffect(() => {
    const onToggle = () => {
      if (wide && window.matchMedia("(min-width: 1400px)").matches) setOpen((o) => !o);
      else setSheet((s) => !s);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheet(false);
    };
    window.addEventListener(EVENT, onToggle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(EVENT, onToggle);
      window.removeEventListener("keydown", onKey);
    };
  }, [wide]);

  return (
    <>
      {wide &&
        (open ? (
          <aside className="relative hidden w-[300px] shrink-0 overflow-y-auto bg-panel shadow-[inset_1px_0_0_var(--color-line)] [animation:rise-in_var(--dur-base)_var(--ease-out)] min-[1400px]:block">
            <button type="button" onClick={() => setOpen(false)} aria-label="Esconder o contato" title="Esconder o contato" aria-expanded className="btn-icon absolute right-2 top-2 z-10 h-8 w-8">
              <PanelRightClose size={16} />
            </button>
            {children}
          </aside>
        ) : (
          <aside className="hidden w-12 shrink-0 flex-col items-center gap-2 bg-panel py-3 shadow-[inset_1px_0_0_var(--color-line)] min-[1400px]:flex">
            <button type="button" onClick={() => setOpen(true)} aria-label="Mostrar o contato" title="Mostrar o contato" aria-expanded={false} className="btn-icon h-8 w-8">
              <PanelRightOpen size={16} />
            </button>
            <button type="button" onClick={() => setOpen(true)} aria-label="Mostrar o contato" title={name ?? "Mostrar o contato"} className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)] transition-transform duration-[120ms] hover:scale-105">
              {initials(name ?? "") || "?"}
            </button>
          </aside>
        ))}
      {sheet && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Contato">
          <button type="button" aria-label="Fechar o contato" onClick={() => setSheet(false)} className="absolute inset-0 bg-scrim [animation:fade-in_var(--dur-base)_var(--ease-out)]" />
          {/* um link de dentro (outra conversa, abrir o contato) fecha o painel */}
          <aside onClick={(e) => (e.target as HTMLElement).closest("a") && setSheet(false)} className="absolute inset-y-0 right-0 w-[min(360px,90vw)] overflow-y-auto bg-panel shadow-[var(--shadow-pop)] [animation:rise-in_var(--dur-base)_var(--ease-out)]">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-panel/95 px-3 py-2 backdrop-blur">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">Contato</span>
              <button type="button" onClick={() => setSheet(false)} aria-label="Fechar" className="btn-icon h-9 w-9">
                <X size={17} />
              </button>
            </div>
            {children}
          </aside>
        </div>
      )}
    </>
  );
}
