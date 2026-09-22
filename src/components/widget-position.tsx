"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  position: "left" | "right";
  offset: number;
  color: string;
}

/**
 * Escolha do canto do balão e da distância da borda, com prévia de como fica no site do cliente.
 * Só campos de formulário (position, offset): o salvar é o do formulário da aba.
 * Campos não controlados (defaultChecked/defaultValue): o React 19 reseta o <form> depois da
 * action, e o formulário pai é remontado com `key` quando o bot muda, então os valores novos
 * chegam pelas props. O estado aqui só alimenta a prévia.
 */
export function WidgetPositionPicker({ position, offset, color }: Props) {
  const [side, setSide] = useState<"left" | "right">(position);
  const [gap, setGap] = useState(offset);
  const g = Math.min(200, Math.max(0, gap || 0));
  const scale = 0.25; // prévia em 1/4 do tamanho

  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
      <div className="flex flex-col gap-3">
        <fieldset>
          <legend className="label">Canto da tela</legend>
          <div className="grid grid-cols-2 gap-2">
            {(["right", "left"] as const).map((v) => (
              <label key={v} className={cn("flex cursor-pointer items-center gap-2.5 rounded-[9px] border px-3.5 py-2.5 text-sm transition-colors duration-[120ms]", side === v ? "border-brand bg-brand-soft font-semibold text-brand" : "border-line bg-panel hover:bg-ground")}>
                <input type="radio" name="position" value={v} defaultChecked={position === v} onChange={() => setSide(v)} className="accent-brand" />
                {v === "right" ? "Direita (padrão)" : "Esquerda"}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="offset" className="label">Distância da borda (px)</label>
          <input id="offset" name="offset" type="number" min={0} max={200} step={4} defaultValue={offset} onChange={(e) => setGap(Number(e.target.value))} className="input max-w-[160px]" />
          <p className="mt-1 text-xs text-muted">Aumente se o site já tem um botão de WhatsApp no mesmo canto, ou mude o lado.</p>
        </div>
      </div>

      {/* prévia */}
      <div aria-hidden className="relative h-[150px] overflow-hidden rounded-xl border border-line bg-white" style={{ background: "linear-gradient(#fff, #f3f1ea)" }}>
        <div className="absolute inset-x-0 top-0 flex h-6 items-center gap-1 border-b border-line-2 bg-ground px-2">
          <span className="h-1.5 w-1.5 rounded-full bg-line" /><span className="h-1.5 w-1.5 rounded-full bg-line" /><span className="h-1.5 w-1.5 rounded-full bg-line" />
          <span className="ml-2 h-1.5 w-20 rounded bg-line-2" />
        </div>
        <div className="absolute left-4 top-10 h-2 w-24 rounded bg-line-2" />
        <div className="absolute left-4 top-14 h-2 w-40 rounded bg-line-2" />
        <div className="absolute left-4 top-[72px] h-2 w-32 rounded bg-line-2" />
        <div
          className="absolute flex items-center justify-center rounded-full shadow-[0_3px_8px_rgba(0,0,0,.2)] transition-[left,right,bottom] duration-[220ms]"
          style={{ width: 58 * scale * 1.6, height: 58 * scale * 1.6, bottom: g * scale + 4, [side]: g * scale + 4, background: color }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v11H8l-4 4z" /></svg>
        </div>
      </div>
    </div>
  );
}
