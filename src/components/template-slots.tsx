"use client";

import { cn } from "@/lib/utils";

const PILL = "mx-0.5 inline-flex max-w-[16rem] items-center truncate rounded-full px-2 py-px align-baseline text-[12.5px] font-medium transition-colors duration-[120ms]";

/**
 * O texto do modelo da Meta como um balão, com cada {{n}} numa etiqueta (redesenho, etapa 5, a pedido
 * do usuário em 22/10: nada de {{1}} à mostra). `label` diz o que entra no lugar; `active` acende a
 * etiqueta do campo que a pessoa está editando.
 */
export function TemplateBody({ body, label, active }: { body: string; label: (i: number) => string; active?: number | null }) {
  return (
    <p className="max-w-[460px] whitespace-pre-line rounded-[14px] rounded-tl-sm bg-ground px-3.5 py-2.5 text-sm leading-relaxed text-ink">
      {body.split(/(\{\{\d+\}\})/).map((part, k) => {
        const m = /^\{\{(\d+)\}\}$/.exec(part);
        if (!m) return part;
        const i = Number(m[1]) - 1;
        return (
          <span key={k} className={cn(PILL, active === i ? "bg-brand text-on-brand" : "bg-brand-soft text-brand")}>
            {label(i)}
          </span>
        );
      })}
    </p>
  );
}

/** Escolha curta entre poucas opções, em botões lado a lado. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-0.5 self-start rounded-[10px] bg-raised p-0.5">
      {options.map(([k, text]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          className={cn("rounded-[8px] px-2.5 py-1 text-[13px] font-medium transition-colors duration-[120ms]", value === k ? "bg-panel text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted hover:text-ink")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** O nome de cada campo do modelo na tela: "Campo 1", "Campo 2"… (um só: "Campo do modelo"). */
export const slotName = (i: number, total: number) => (total > 1 ? `Campo ${i + 1}` : "Campo do modelo");

/** Campo que vem logo depois de um cumprimento ("Olá {{1}}"): começa como o primeiro nome. */
export function greetingSlot(body: string): number | null {
  const m = /(?:^|[^\p{L}])(?:ol[áa]|oi|ei|bom dia|boa tarde|boa noite|prezad[oa]|car[oa])[,!]?\s*\{\{(\d+)\}\}/iu.exec(body);
  return m ? Number(m[1]) - 1 : null;
}

/** O texto curto da etiqueta: o que foi escrito, cortado. */
export const shortText = (s: string) => (s.trim().length > 24 ? `${s.trim().slice(0, 23)}…` : s.trim());
