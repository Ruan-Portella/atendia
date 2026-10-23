"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Área de mensagens com rolagem própria: abre no fim e, quando chega mensagem nova (a página
 * atualiza sozinha), desce junto, a menos que a pessoa tenha subido para ler o histórico. Quando o
 * histórico cresce em cima ("Ver a conversa anterior", que muda o `anchor`), a tela fica onde a
 * pessoa estava, com um pedaço do que entrou à vista, em vez de pular para o começo (23/10/2026).
 * É `relative` para conter os elementos absolutos de dentro (o texto só para leitor de tela do
 * aviso automático): sem isso, eles ficam presos à página e criam uma rolagem fantasma.
 */
export function MessageScroller({ count, anchor, className, children }: { count: number; anchor?: number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  // a distância até o fim antes de o histórico crescer em cima
  const fromBottom = useRef<number | null>(null);
  const lastAnchor = useRef(anchor);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (anchor !== lastAnchor.current && fromBottom.current !== null) {
      lastAnchor.current = anchor;
      el.scrollTop = Math.max(0, el.scrollHeight - fromBottom.current - 96);
      return;
    }
    lastAnchor.current = anchor;
    if (nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [count, anchor]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      fromBottom.current = el.scrollHeight - el.scrollTop;
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div ref={ref} className={className ? `relative ${className}` : "relative"}>
      {children}
    </div>
  );
}
