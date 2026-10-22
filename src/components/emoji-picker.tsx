"use client";

import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";

/** Os emojis mais usados no atendimento (Conversa mais natural, parte 3). */
export const COMPOSER_EMOJIS = [
  "😀", "😊", "🙂", "😉", "😍", "🥰", "😅", "😂",
  "🤩", "🥳", "😮", "😢", "😔", "🙏", "👍", "👏",
  "🙌", "💪", "👋", "🤝", "✅", "❌", "⚠️", "❤️",
  "💚", "🔥", "⭐", "✨", "🎉", "🎁", "📦", "🚚",
  "🛵", "🕐", "📅", "📍", "📞", "💬", "💰", "💳",
] as const;

/**
 * Botão de emoji ao lado do campo de resposta: a grade abre para cima e o emoji entra onde o
 * cursor está. Fecha com Esc ou clique fora.
 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Inserir emoji" title="Inserir emoji" className="btn-icon h-8 w-8">
        <Smile size={18} />
      </button>
      {open && (
        <div role="group" aria-label="Emojis" className="absolute bottom-full left-0 z-20 mb-2 grid w-[280px] max-w-[calc(100vw-2rem)] grid-cols-8 gap-0.5 rounded-xl border border-line bg-panel p-1.5 shadow-[0_12px_32px_rgba(27,31,29,0.14)]">
          {COMPOSER_EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => onPick(e)} className="rounded-md text-lg leading-8 hover:bg-ground" aria-label={`Inserir ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
