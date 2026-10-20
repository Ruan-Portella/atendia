import { ThumbsUp } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { boardOf, likeable, type RoadmapItem, type RoadmapStatus } from "@/lib/roadmap";
import { RoadmapLike } from "./roadmap-like";

const DOT: Record<RoadmapStatus, string> = { ideia: "bg-muted", vamos_fazer: "bg-amber", fazendo: "bg-brand-tint", pronto: "bg-brand" };

/**
 * As quatro colunas do roadmap (Lançamento, parte 5). Com `like` (painel), cada item curtível tem o
 * botão; sem (página aberta), só a contagem.
 */
export function RoadmapBoard({ items, liked, like }: { items: RoadmapItem[]; liked?: Set<string>; like?: (itemId: string) => Promise<ActionResult> }) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
      {boardOf(items).map((col) => (
        <section key={col.status} aria-labelledby={`roadmap-${col.status}`} className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id={`roadmap-${col.status}`} className="flex items-center gap-2 text-base font-bold">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[col.status]}`} aria-hidden />
              {col.title}
              <span className="font-normal text-muted tabular-nums">{col.items.length + col.more}</span>
            </h2>
            <p className="text-xs text-muted">{col.hint}</p>
          </div>
          {col.items.length === 0 && <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Nada aqui por enquanto.</p>}
          <ul className="flex flex-col gap-2.5">
            {col.items.map((item) => (
              <li key={item.id} className="card flex flex-col gap-2 p-4">
                <h3 className="text-[15px] font-semibold leading-snug" style={{ textWrap: "balance" }}>{item.title}</h3>
                {item.summary && <p className="text-sm text-ink-2">{item.summary}</p>}
                {likeable(item.status) && (
                  <div className="flex">
                    {like ? (
                      <RoadmapLike itemId={item.id} liked={liked?.has(item.id) ?? false} count={item.likes} action={like} />
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
          {col.more > 0 && <p className="text-xs text-muted">e mais {col.more} já prontos.</p>}
        </section>
      ))}
    </div>
  );
}
