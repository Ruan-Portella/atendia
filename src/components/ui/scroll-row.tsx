"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Fileira que rola de lado (as filas da Caixa de entrada, por exemplo): no celular, com o dedo; no
 * computador, arrastando com o mouse, com a rodinha e com as setas que aparecem nas pontas quando
 * há mais itens escondidos. Um arrasto não vira clique no item onde ele terminou.
 */
export function ScrollRow({ children, className, innerClassName, label }: { children: React.ReactNode; className?: string; /** o espaço de dentro (a fileira rola até a borda) */ innerClassName?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    // a rodinha (para cima e para baixo) rola de lado quando há o que rolar
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, []);

  const by = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * Math.max(120, (ref.current?.clientWidth ?? 0) * 0.7), behavior: "smooth" });

  return (
    <div className={cn("relative", className)}>
      <div
        ref={ref}
        role={label ? "group" : undefined}
        aria-label={label}
        className={cn("flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", innerClassName)}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse" || e.button !== 0 || !ref.current) return;
          drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !ref.current) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) < 5) return;
          if (!d.moved) ref.current.setPointerCapture(e.pointerId);
          d.moved = true;
          ref.current.scrollLeft = d.left - dx;
        }}
        onPointerUp={(e) => {
          if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId);
          // o clique que vem logo depois de um arrasto não abre o item
          if (drag.current?.moved) window.setTimeout(() => (drag.current = null), 0);
          else drag.current = null;
        }}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.preventDefault();
            e.stopPropagation();
            drag.current = null;
          }
        }}
        onDragStart={(e) => e.preventDefault()}
      >
        {children}
      </div>
      {edges.left && (
        <button type="button" onClick={() => by(-1)} aria-label="Ver as anteriores" className="absolute inset-y-0 left-0 hidden items-center bg-gradient-to-r from-panel via-panel/90 to-transparent pl-0.5 pr-4 text-muted hover:text-ink sm:flex">
          <ChevronLeft size={16} />
        </button>
      )}
      {edges.right && (
        <button type="button" onClick={() => by(1)} aria-label="Ver as próximas" className="absolute inset-y-0 right-0 hidden items-center bg-gradient-to-l from-panel via-panel/90 to-transparent pl-4 pr-0.5 text-muted hover:text-ink sm:flex">
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}
