"use client";

import { useEffect, useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { CONTACT_COOKIE } from "@/lib/theme";
import { initials } from "@/lib/utils";

/**
 * A coluna do contato na Caixa de entrada (telas de 1400 px ou mais): esconde e mostra pelo botão.
 * Escondida, vira uma faixa fina com as iniciais (clicar mostra de novo); a escolha fica no navegador.
 */
export function ContactPane({ initialOpen = true, name, children }: { initialOpen?: boolean; name: string | null; children: React.ReactNode }) {
  const [open, setOpen] = useState(initialOpen);
  useEffect(() => {
    document.cookie = `${CONTACT_COOKIE}=${open ? "aberto" : "fechado"}; path=/; max-age=31536000; samesite=lax`;
  }, [open]);

  if (!open) {
    return (
      <aside className="hidden w-12 shrink-0 flex-col items-center gap-2 bg-panel py-3 shadow-[inset_1px_0_0_var(--color-line)] min-[1400px]:flex">
        <button type="button" onClick={() => setOpen(true)} aria-label="Mostrar o contato" title="Mostrar o contato" aria-expanded={false} className="btn-icon h-8 w-8">
          <PanelRightOpen size={16} />
        </button>
        <button type="button" onClick={() => setOpen(true)} aria-label="Mostrar o contato" title={name ?? "Mostrar o contato"} className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)] transition-transform duration-[120ms] hover:scale-105">
          {initials(name ?? "") || "?"}
        </button>
      </aside>
    );
  }
  return (
    <aside className="relative hidden w-[300px] shrink-0 overflow-y-auto bg-panel shadow-[inset_1px_0_0_var(--color-line)] [animation:rise-in_var(--dur-base)_var(--ease-out)] min-[1400px]:block">
      <button type="button" onClick={() => setOpen(false)} aria-label="Esconder o contato" title="Esconder o contato" aria-expanded className="btn-icon absolute right-2 top-2 z-10 h-8 w-8">
        <PanelRightClose size={16} />
      </button>
      {children}
    </aside>
  );
}
