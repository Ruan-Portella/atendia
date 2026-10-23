"use client";

import { useState } from "react";
import { CheckCircle2, ThumbsUp } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { boardOf, likeable, type RoadmapItem, type RoadmapStatus } from "@/lib/roadmap";
import { cn } from "@/lib/utils";
import { RoadmapLike } from "./roadmap-like";

const DOT: Record<RoadmapStatus, string> = { ideia: "bg-muted", vamos_fazer: "bg-amber", fazendo: "bg-brand-tint", pronto: "bg-brand" };

/**
 * As quatro colunas do roadmap (Lançamento, parte 5). Com `like` (painel), cada item curtível tem o
 * botão; sem (página aberta), só a contagem. Redesenho (23/10/2026): no computador largo, as quatro
 * lado a lado; no celular e no tablet, uma de cada vez, escolhida nas pílulas do alto.
 */
export function RoadmapBoard({ items, liked, like }: { items: RoadmapItem[]; liked?: Set<string> | string[]; like?: (itemId: string) => Promise<ActionResult> }) {
  const cols = boardOf(items);
  const [open, setOpen] = useState<RoadmapStatus>(cols.find((c) => c.status === "fazendo" && c.items.length)?.status ?? cols[0]?.status ?? "ideia");
  const likedSet = liked instanceof Set ? liked : new Set(liked ?? []);
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Colunas do roadmap" className="flex flex-wrap gap-1 xl:hidden">
        {cols.map((col) => (
          <button
            key={col.status}
            type="button"
            onClick={() => setOpen(col.status)}
            aria-pressed={open === col.status}
            className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors duration-[120ms]", open === col.status ? "bg-ink font-medium text-ground" : "bg-raised/70 text-ink-2 hover:bg-raised hover:text-ink")}
          >
            <span className={cn("h-2 w-2 rounded-full", DOT[col.status])} aria-hidden />
            {col.title}
            <span className={cn("font-mono text-[11px]", open === col.status ? "text-ground/70" : "text-muted")}>{col.items.length + col.more}</span>
          </button>
        ))}
      </nav>
      <div className="grid gap-5 xl:grid-cols-4">
        {cols.map((col) => (
          <section key={col.status} aria-labelledby={`roadmap-${col.status}`} className={cn("min-w-0 flex-col gap-3 rounded-[18px] bg-raised/40 p-3 xl:flex", open === col.status ? "flex" : "hidden")}>
            <div className="flex flex-col gap-0.5 px-1">
              <h2 id={`roadmap-${col.status}`} className="flex items-center gap-2 text-base font-medium">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[col.status]}`} aria-hidden />
                {col.title}
                <span className="ml-auto rounded-full bg-panel px-2 font-mono text-[11px] font-normal text-muted tabular-nums">{col.items.length + col.more}</span>
              </h2>
              <p className="text-xs text-muted">{col.hint}</p>
            </div>
            {col.items.length === 0 && <p className="rounded-[14px] border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Nada aqui por enquanto.</p>}
            <ul className="flex flex-col gap-2">
              {col.items.map((item) => (
                <li key={item.id} className="card flex flex-col gap-2 p-4">
                  <h3 className="flex items-start gap-2 text-[15px] font-medium leading-snug text-ink" style={{ textWrap: "balance" }}>
                    {col.status === "pronto" && <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden />}
                    {item.title}
                  </h3>
                  {item.summary && <p className="text-sm text-ink-2">{item.summary}</p>}
                  {likeable(item.status) && (
                    <div className="flex justify-end">
                      {like ? (
                        <RoadmapLike itemId={item.id} liked={likedSet.has(item.id)} count={item.likes} action={like} />
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted tabular-nums" aria-label={`${item.likes} curtida${item.likes === 1 ? "" : "s"}`}>
                          <ThumbsUp size={13} aria-hidden />
                          {item.likes}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {col.more > 0 && <p className="px-1 text-xs text-muted">e mais {col.more} já prontos.</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
