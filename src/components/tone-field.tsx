"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Os tons prontos: o texto vai como está para o assistente (o primeiro é o padrão de sempre). */
const TONES = [
  { label: "Amigável", value: "amigável, direto e profissional" },
  { label: "Formal", value: "formal, cordial e respeitoso" },
  { label: "Descontraído", value: "descontraído e bem-humorado, sem exagerar" },
  { label: "Acolhedor", value: "acolhedor, paciente e gentil" },
  { label: "Objetivo", value: "objetivo e técnico, com respostas curtas" },
  { label: "Animado", value: "jovem e animado, com emojis com moderação" },
];

/**
 * O tom de voz (redesenho, etapa 5): opções prontas para tocar e o campo para escrever o próprio.
 * Tocar troca o texto do campo; o que vale é o que estiver escrito.
 */
export function ToneField({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="tone" className="label mb-0">
        Tom de voz
      </label>
      <div role="group" aria-label="Tons prontos" className="flex flex-wrap gap-1.5">
        {TONES.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={value.trim() === t.value}
            onClick={() => setValue(t.value)}
            title={t.value}
            className={cn("rounded-full border px-3 py-1 text-[13px] font-medium transition-colors duration-[120ms]", value.trim() === t.value ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:border-line-strong")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <input id="tone" name="tone" maxLength={200} value={value} onChange={(e) => setValue(e.target.value)} className="input" placeholder="Ou escreva o seu: ex.: simpático, fala como um vendedor de bairro" />
      <p className="text-xs text-muted">Toque num tom pronto ou escreva o seu. O assistente segue o que estiver no campo.</p>
    </div>
  );
}
