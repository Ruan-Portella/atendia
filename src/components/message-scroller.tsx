"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Área de mensagens com rolagem própria: abre no fim e, quando chega mensagem nova (a página
 * atualiza sozinha), desce junto, a menos que a pessoa tenha subido para ler o histórico.
 */
export function MessageScroller({ count, className, children }: { count: number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => (nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
