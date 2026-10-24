"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DemoTurn } from "@/lib/landing";

type Shown = { ask: string; answer: string; note?: string; typed: number };

/**
 * Demonstração da landing (24/10/2026): a pessoa escolhe o que o contato manda e vê o assistente
 * responder, como no WhatsApp. Texto de exemplo, sem IA de verdade (nada é gasto). Com movimento
 * reduzido, a resposta aparece inteira.
 */
export function ChatDemo({ name, initials, color, turns }: { name: string; initials: string; color: string; turns: DemoTurn[] }) {
  const [shown, setShown] = useState<Shown[]>([]);
  const [typing, setTyping] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // a resposta aparece aos poucos, como se estivesse sendo escrita
  useEffect(() => {
    const last = shown[shown.length - 1];
    if (!last || last.typed >= last.answer.length) return;
    const t = setTimeout(() => setShown((s) => s.map((x, i) => (i === s.length - 1 ? { ...x, typed: Math.min(x.answer.length, x.typed + 3) } : x))), 18);
    return () => clearTimeout(t);
  }, [shown]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reduced.current ? "auto" : "smooth" });
  }, [shown, typing]);

  function ask(t: DemoTurn) {
    if (typing || shown.some((s) => s.typed < s.answer.length)) return;
    setTyping(true);
    setShown((s) => [...s, { ask: t.ask, answer: t.answer, note: t.note, typed: -1 }]);
    setTimeout(() => {
      setTyping(false);
      setShown((s) => s.map((x, i) => (i === s.length - 1 ? { ...x, typed: reduced.current ? x.answer.length : 0 } : x)));
    }, reduced.current ? 0 : 850);
  }

  const used = new Set(shown.map((s) => s.ask));
  const busy = typing || shown.some((s) => s.typed < s.answer.length);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-muted">Escolha o que o contato manda:</p>
        <div className="flex flex-wrap gap-2 lg:flex-col lg:items-start">
          {turns.map((t) => (
            <button
              key={t.ask}
              type="button"
              onClick={() => ask(t)}
              disabled={busy || used.has(t.ask)}
              className={cn(
                "rounded-full border px-4 py-2 text-left text-sm font-medium transition-colors",
                used.has(t.ask) ? "border-line bg-raised text-muted" : "border-line-strong bg-panel hover:border-brand hover:text-brand",
                busy && !used.has(t.ask) && "opacity-60",
              )}
            >
              {t.ask.startsWith("Mandou") ? t.ask : `“${t.ask}”`}
            </button>
          ))}
        </div>
        {shown.length > 0 && !busy && used.size === turns.length && (
          <button type="button" onClick={() => setShown([])} className="self-start text-sm font-medium text-brand underline-offset-4 hover:underline">
            Começar de novo
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-[28px] border border-line bg-panel shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: color }}>{initials}</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{name}</div>
            <div className="text-xs text-brand">{typing ? "digitando…" : "online"}</div>
          </div>
          <span className="ml-auto rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand">WhatsApp</span>
        </div>
        <div ref={scroller} className="flex h-[360px] flex-col gap-2.5 overflow-y-auto bg-ground px-4 py-4 text-[15px] sm:h-[400px]" aria-live="polite">
          {shown.length === 0 && (
            <div className="m-auto max-w-[260px] text-center text-sm text-muted">Toque numa mensagem ao lado para ver o assistente responder.</div>
          )}
          {shown.map((s, i) => (
            <div key={i} className="flex flex-col gap-2.5">
              <div className="max-w-[80%] self-end rounded-[16px_16px_4px_16px] bg-brand-soft px-3.5 py-2.5 text-ink">
                {s.ask.startsWith("Mandou") ? <span className="italic opacity-80">{s.ask.replace("Mandou", "📎").replace("um áudio", "Áudio · 0:14").replace("a foto do comprovante", "Foto do comprovante")}</span> : s.ask}
              </div>
              {s.typed >= 0 && (
                <div className="flex max-w-[88%] flex-col gap-1 self-start">
                  <div className="rounded-[16px_16px_16px_4px] border border-line bg-panel px-3.5 py-2.5">{s.answer.slice(0, s.typed)}</div>
                  {s.note && s.typed >= s.answer.length && (
                    <span className="flex items-center gap-1.5 pl-1 text-xs text-muted"><Sparkles size={12} className="text-brand" />{s.note}</span>
                  )}
                </div>
              )}
            </div>
          ))}
          {typing && (
            <div className="flex gap-1 self-start rounded-[16px_16px_16px_4px] border border-line bg-panel px-4 py-3.5" aria-label="digitando">
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${d * 120}ms` }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
