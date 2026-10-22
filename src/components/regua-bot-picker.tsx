"use client";

import { useRouter } from "next/navigation";

/** Qual chatbot mostrar nas Réguas: trocar já abre o outro (redesenho, etapa 5: sem o botão Ver). */
export function ReguaBotPicker({ bots, current }: { bots: Array<{ id: string; label: string }>; current: string }) {
  const router = useRouter();
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">Réguas do chatbot</span>
      <select value={current} onChange={(e) => router.push(`/painel/campanhas/reguas?bot=${e.target.value}`)} className="input w-auto min-w-[240px] py-2" aria-label="Chatbot das réguas">
        {bots.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </select>
    </label>
  );
}
