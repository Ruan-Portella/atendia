"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { BotFace } from "@/components/bot-face";
import { ACCESSORIES, EYES, FACE_COLORS, type BotFaceStyle } from "@/lib/bot-face";
import { cn } from "@/lib/utils";

/**
 * O editor do rosto do chatbot (redesenho, etapa 3), dentro do formulário de Rosto e aparência: a
 * cor (as prontas ou qualquer outra), os olhos e o acessório, com o rosto grande ao vivo e como ele
 * aparece no menu, na lista, na conversa e no chat do site. Os campos vão no formulário (color,
 * face_eyes, face_acc); a cor fica travada quando vem do modelo.
 */
export function FaceEditor({ initialColor, initialFace, botName, clientName, colorLocked = false }: { initialColor: string; initialFace: BotFaceStyle; botName: string; clientName: string; colorLocked?: boolean }) {
  const [color, setColor] = useState(initialColor);
  const [eyes, setEyes] = useState(initialFace.eyes);
  const [acc, setAcc] = useState(initialFace.acc);
  const face = { eyes, acc };
  const custom = !FACE_COLORS.some((c) => c.hex.toLowerCase() === color.toLowerCase());

  return (
    <div className="grid gap-6 rounded-[18px] bg-panel p-5 shadow-[inset_0_0_0_1px_var(--color-line),inset_0_1px_0_var(--highlight)] md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      <input type="hidden" name="face_eyes" value={eyes} />
      <input type="hidden" name="face_acc" value={acc} />

      <div className="flex flex-col items-center gap-5">
        <div className="flex flex-col items-center gap-3 pt-10">
          <span className="[animation:bv-pop_var(--dur-slow)_var(--ease-spring)]" key={`${color}-${eyes}-${acc}`}>
            <BotFace color={color} face={face} size={132} alive />
          </span>
          <div className="text-center">
            <div className="font-display text-2xl font-light">{botName}</div>
            <div className="text-[13px] text-muted">{clientName}</div>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2">
          <span className="text-center font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">Assim ele aparece</span>
          <div className="flex items-end justify-center gap-4">
            <span className="flex flex-col items-center gap-1.5">
              <BotFace color={color} face={face} size={22} />
              <span className="text-[11px] text-muted">menu</span>
            </span>
            <span className="flex flex-col items-center gap-1.5">
              <BotFace color={color} face={face} size={30} />
              <span className="text-[11px] text-muted">conversa</span>
            </span>
            <span className="flex flex-col items-center gap-1.5">
              <span className="flex items-center gap-1.5 rounded-[10px] px-2 py-1.5" style={{ background: color }}>
                <BotFace color={color} face={face} size={24} inverted />
                <span className="text-[11px] font-semibold text-white">{botName}</span>
              </span>
              <span className="text-[11px] text-muted">chat do site</span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <fieldset disabled={colorLocked} className="flex flex-col gap-2.5 disabled:opacity-60">
          <legend className="mb-2 text-[13px] font-medium">Cor</legend>
          <div role="radiogroup" aria-label="Cor" className="flex flex-wrap items-center gap-2.5">
            {FACE_COLORS.map((c) => {
              const on = c.hex.toLowerCase() === color.toLowerCase();
              return (
                <button key={c.hex} type="button" role="radio" aria-checked={on} aria-label={c.label} title={c.label} onClick={() => setColor(c.hex)} className="flex h-9 w-9 items-center justify-center rounded-[11px] transition-transform duration-[120ms] ease-[var(--ease-spring)] hover:-translate-y-0.5 active:scale-95" style={{ background: c.hex, boxShadow: on ? `0 0 0 2px var(--color-panel), 0 0 0 4px ${c.hex}` : "inset 0 0 0 1px #00000026" }}>
                  {on && <Check size={16} className="text-white" />}
                </button>
              );
            })}
            <label className={cn("relative flex h-9 cursor-pointer items-center gap-2 rounded-[11px] px-2.5 text-[12.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)]", custom && "shadow-[inset_0_0_0_2px_var(--color-brand)]")} title="Outra cor">
              <span className="h-4 w-4 rounded-full" style={{ background: color }} />
              Outra
              <input name="color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Outra cor" />
            </label>
          </div>
          <p className="text-[12px] text-muted">{colorLocked ? "A cor vem do modelo: muda só lá." : "A mesma cor do balão e do topo do chat do site."}</p>
        </fieldset>

        <div className="flex flex-col gap-2.5">
          <span className="text-[13px] font-medium">Olhos</span>
          <div role="radiogroup" aria-label="Olhos" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {EYES.map((e) => {
              const on = e.id === eyes;
              return (
                <button key={e.id} type="button" role="radio" aria-checked={on} onClick={() => setEyes(e.id)} className={cn("flex flex-col items-center gap-2 rounded-[14px] px-2 py-2.5 text-[12px] transition-[background-color,transform] duration-[120ms] ease-[var(--ease-spring)] hover:-translate-y-0.5 active:scale-95", on ? "bg-brand-soft text-ink shadow-[inset_0_0_0_2px_var(--color-brand)]" : "bg-field text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]")}>
                  <BotFace color={color} face={{ eyes: e.id, acc: "nenhum" }} size={30} />
                  {e.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <span className="text-[13px] font-medium">Acessório</span>
          <div role="radiogroup" aria-label="Acessório" className="flex flex-wrap gap-2">
            {ACCESSORIES.map((a) => {
              const on = a.id === acc;
              return (
                <button key={a.id} type="button" role="radio" aria-checked={on} onClick={() => setAcc(a.id)} className={cn("rounded-[11px] px-3.5 py-2 text-[13px] transition-[background-color,transform] duration-[120ms] ease-[var(--ease-spring)] active:scale-95", on ? "bg-brand-soft font-medium text-ink shadow-[inset_0_0_0_2px_var(--color-brand)]" : "bg-field text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-ink")}>
                  {a.label}
                </button>
              );
            })}
          </div>
          <p className="text-[12px] text-muted">O acessório aparece no rosto grande (aqui e na visão geral do chatbot); no menu e na lista ficam só os olhos.</p>
        </div>
      </div>
    </div>
  );
}
