"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}
interface ToastApi {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

const ICON = { success: CheckCircle2, error: AlertCircle, info: Info } as const;
const STYLE: Record<ToastKind, string> = {
  success: "border-[#cfe3d8] bg-brand-soft text-brand",
  error: "border-[#f0c9c9] bg-danger-soft text-danger",
  info: "border-line bg-panel text-ink",
};

/** Avisos curtos no canto da tela. Monte uma vez no layout raiz e use `useToast()`. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = ++nextId.current;
      setItems((xs) => [...xs, { id, kind, message }].slice(-4));
      window.setTimeout(() => dismiss(id), kind === "error" ? 7000 : 3800);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(() => ({ toast, success: (m) => toast(m, "success"), error: (m) => toast(m, "error") }), [toast]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-5 sm:items-end">
        {items.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <div key={t.id} role="status" className={cn("toast-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-[0_12px_32px_rgba(27,31,29,0.14)]", STYLE[t.kind])}>
              <Icon size={17} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1 font-medium leading-snug">{t.message}</span>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Fechar aviso" className="-mr-1 shrink-0 rounded-md p-0.5 opacity-70 hover:opacity-100">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return api;
}
