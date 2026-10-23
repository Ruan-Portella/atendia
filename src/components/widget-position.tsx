"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  position: "left" | "right";
  offset: number;
  color: string;
}

const SIDES = [
  ["left", "Esquerda"],
  ["right", "Direita (padrão)"],
] as const;

/**
 * Escolha do canto do balão e da distância da borda, com prévia de como fica no site do cliente.
 * Só campos de formulário (position, offset): o salvar é o do formulário da aba. Redesenho
 * (23/10/2026): os lados na ordem da tela (esquerda à esquerda), cada um com o desenho do canto, e a
 * distância num controle deslizante com o número ao lado.
 */
export function WidgetPositionPicker({ position, offset, color }: Props) {
  const [side, setSide] = useState<"left" | "right">(position);
  const [gap, setGap] = useState(Math.min(200, Math.max(0, offset || 0)));
  const scale = 0.4; // prévia em 40% do tamanho

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="label">Canto da tela</legend>
        <div className="grid grid-cols-2 gap-2">
          {SIDES.map(([v, label]) => (
            <label key={v} className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-[14px] border p-3 text-sm transition-colors duration-[120ms]", side === v ? "border-brand bg-brand-soft/60 font-medium text-ink" : "border-line text-ink-2 hover:border-line-strong")}>
              <input type="radio" name="position" value={v} checked={side === v} onChange={() => setSide(v)} className="sr-only" />
              <span aria-hidden className="relative h-10 w-16 rounded-[7px] border border-line-strong bg-raised">
                <span className={cn("absolute bottom-1 h-2.5 w-2.5 rounded-full", v === "left" ? "left-1" : "right-1")} style={{ background: side === v ? color : "var(--color-muted)" }} />
              </span>
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <label htmlFor="offset" className="label">
          Distância da borda
        </label>
        <div className="flex items-center gap-3">
          <input type="range" min={0} max={200} step={4} value={gap} onChange={(e) => setGap(Number(e.target.value))} className="min-w-0 flex-1 accent-brand" aria-label="Distância da borda" />
          <span className="flex shrink-0 items-center gap-1">
            <input id="offset" name="offset" type="number" min={0} max={200} step={4} value={gap} onChange={(e) => setGap(Math.min(200, Math.max(0, Number(e.target.value) || 0)))} className="input w-[76px] text-right" />
            <span className="text-sm text-muted">px</span>
          </span>
        </div>
        <p className="text-xs text-muted">Aumente se o site já tem um botão de WhatsApp no mesmo canto, ou mude o lado.</p>
      </div>

      {/* prévia: uma página de site com o balão no canto escolhido */}
      <div className="flex flex-col gap-2">
        <span className="kpi-label">Como fica no site</span>
        <div aria-hidden className="relative h-[190px] overflow-hidden rounded-[14px] border border-line" style={{ background: "linear-gradient(#ffffff, #f3f4f1)" }}>
          <div className="absolute inset-x-0 top-0 flex h-7 items-center gap-1 border-b border-[#e3e6e2] bg-[#f6f7f5] px-2.5">
            <span className="h-2 w-2 rounded-full bg-[#dcdfdb]" />
            <span className="h-2 w-2 rounded-full bg-[#dcdfdb]" />
            <span className="h-2 w-2 rounded-full bg-[#dcdfdb]" />
            <span className="ml-2 h-2 w-28 rounded bg-[#e8eae6]" />
          </div>
          <div className="absolute left-5 top-12 h-2.5 w-28 rounded bg-[#e8eae6]" />
          <div className="absolute left-5 top-[68px] h-2.5 w-48 max-w-[60%] rounded bg-[#e8eae6]" />
          <div className="absolute left-5 top-[88px] h-2.5 w-40 max-w-[50%] rounded bg-[#e8eae6]" />
          <div
            className="absolute flex items-center justify-center rounded-full shadow-[0_4px_12px_rgba(0,0,0,.22)] transition-[left,right,bottom] duration-[220ms]"
            style={{ width: 58 * scale, height: 58 * scale, bottom: gap * scale + 6, [side]: gap * scale + 6, background: color }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h16v11H8l-4 4z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
