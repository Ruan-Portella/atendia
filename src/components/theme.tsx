"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Moon, Sun, MonitorSmartphone } from "lucide-react";
import { TEMA_COOKIE, TEMAS, temaOf, type Tema } from "@/lib/theme";
import { cn } from "@/lib/utils";

const EVENT = "bv-tema";

/**
 * A marca do tema na página: o globals.css lê o data-tema (html:has([data-tema])) e troca o
 * color-scheme, e todas as cores seguem. Vem do layout com o valor do cookie.
 */
export function ThemeMark({ tema }: { tema: Tema }) {
  const [current, setCurrent] = useState(tema);
  useEffect(() => {
    const on = (e: Event) => setCurrent(temaOf((e as CustomEvent<string>).detail));
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return <span hidden data-tema={current} />;
}

export function chooseTema(tema: Tema) {
  document.cookie = `${TEMA_COOKIE}=${tema}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: tema }));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function useTema(): Tema {
  return useSyncExternalStore(
    subscribe,
    // o evento chega antes do ThemeMark renderizar de novo: o cookie já tem o valor novo
    () => temaOf(document.cookie.match(new RegExp(`(?:^|; )${TEMA_COOKIE}=([^;]*)`))?.[1]),
    () => "escuro" as Tema,
  );
}

const ICON = { escuro: Moon, claro: Sun, sistema: MonitorSmartphone } as const;

/** Escolha do tema em três botões (Meu perfil e o menu da pessoa). */
export function ThemeChoice({ className }: { className?: string }) {
  const tema = useTema();
  return (
    <div role="radiogroup" aria-label="Tema" className={cn("grid grid-cols-3 gap-1 rounded-[12px] bg-raised p-1", className)}>
      {TEMAS.map((t) => {
        const Icon = ICON[t.value];
        const on = t.value === tema;
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => chooseTema(t.value)}
            className={cn("inline-flex items-center justify-center gap-1.5 rounded-[9px] px-2 py-1.5 text-[13px] font-medium transition-colors duration-[120ms]", on ? "bg-panel text-ink shadow-[inset_0_1px_0_var(--highlight),0_1px_2px_rgba(0,0,0,0.12)]" : "text-muted hover:text-ink")}
          >
            <Icon size={14} className="shrink-0" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
