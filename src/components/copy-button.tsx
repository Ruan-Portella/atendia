"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useToast } from "@/components/ui/toast";

/** Copia para a área de transferência; sem clipboard (http, iframe) cai no textarea + execCommand. */
export function CopyButton({ text, label = "Copiar", className = "btn-ghost", icon = true }: { text: string; label?: string; className?: string; icon?: boolean }) {
  const [done, setDone] = useState(false);
  const toast = useToast();

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
    }
    if (ok) {
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } else {
      toast.error("Não consegui copiar automaticamente. Selecione o texto e copie com Ctrl+C.");
    }
  }

  return (
    <button type="button" className={className} onClick={copy} aria-live="polite">
      {icon && (done ? <Check size={15} /> : <Copy size={15} />)}
      {done ? "Copiado" : label}
    </button>
  );
}
