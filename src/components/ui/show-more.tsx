"use client";

import { Children, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Listas que crescem com o número de chatbots (rodada 2 das telas, 23/10/2026): mostra as
 * primeiras linhas e um "Mostrar todos (N)" no fim, em vez de uma tela comprida. Feito para ficar
 * dentro de um SettingGroup (o botão vira a última linha do cartão).
 */
export function ShowMore({ children, initial = 5 }: { children: React.ReactNode; initial?: number }) {
  const [all, setAll] = useState(false);
  const items = Children.toArray(children);
  // um item escondido só não vale o botão
  if (items.length <= initial + 1) return <>{items}</>;
  return (
    <>
      {all ? items : items.slice(0, initial)}
      <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="flex w-full items-center justify-center gap-1.5 px-4 py-3 text-sm font-medium text-brand transition-colors duration-[120ms] hover:bg-raised">
        {all ? "Mostrar menos" : `Mostrar todos (${items.length})`}
        <ChevronDown size={15} className={all ? "rotate-180" : ""} />
      </button>
    </>
  );
}
