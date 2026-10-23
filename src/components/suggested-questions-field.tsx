"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

const MAX = 6;

/**
 * As perguntas sugeridas do chat do site (23/10/2026, a pedido do usuário): uma por campo, até 6,
 * com a prévia dos botões como o visitante vê. Vão juntas no campo `suggested` (uma por linha),
 * que o updateBot já lê.
 */
export function SuggestedQuestionsField({ initial, color, welcome }: { initial: string[]; color: string; welcome: string }) {
  const [items, setItems] = useState<string[]>(initial.length ? initial.slice(0, MAX) : [""]);
  const filled = items.map((q) => q.trim()).filter(Boolean);
  const set = (i: number, v: string) => setItems(items.map((q, j) => (j === i ? v : q)));
  const remove = (i: number) => setItems(items.length === 1 ? [""] : items.filter((_, j) => j !== i));
  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="suggested" value={filled.join("\n")} />
      <div className="flex flex-col gap-2">
        {items.map((q, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted">{i + 1}</span>
            <input value={q} onChange={(e) => set(i, e.target.value)} maxLength={80} className="input min-w-0 flex-1" placeholder={i === 0 ? "Quais são os horários?" : "Outra pergunta"} aria-label={`Pergunta ${i + 1}`} />
            <button type="button" onClick={() => remove(i)} aria-label={`Tirar a pergunta ${i + 1}`} className="btn-icon shrink-0">
              <X size={15} />
            </button>
          </div>
        ))}
        {items.length < MAX ? (
          <button type="button" onClick={() => setItems([...items, ""])} className="btn-ghost self-start py-1.5 text-[13px]">
            <Plus size={14} /> Adicionar pergunta
          </button>
        ) : (
          <p className="text-xs text-muted">Chegou ao máximo de {MAX} perguntas.</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="kpi-label">Como o visitante vê</span>
        <div className="flex flex-col gap-2 rounded-[14px] bg-[#f6f7f5] p-3.5">
          <span className="max-w-[85%] self-start rounded-[14px] rounded-bl-[4px] bg-white px-3 py-2 text-[13px] text-[#1b1f1d] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">{welcome}</span>
          {filled.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {filled.map((q, i) => (
                <span key={i} className="max-w-full truncate rounded-full border bg-white px-3 py-1.5 text-[13px] font-medium" style={{ borderColor: color, color }}>
                  {q}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-[#6b736e]">Sem perguntas, o chat abre só com a saudação.</span>
          )}
        </div>
      </div>
    </div>
  );
}
