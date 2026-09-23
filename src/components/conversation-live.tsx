"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { signal } from "@/lib/attention";

interface Props {
  /** atualiza sozinha enquanto a conversa está viva (visitante online ou mensagem recente) */
  live: boolean;
  /** o atendimento humano já tem o próprio refresh rápido; aqui só não duplica */
  handoffOpen: boolean;
  visitorMessages: number;
  lastVisitorText: string;
}

/**
 * Tela de uma conversa: mensagens novas aparecem sem recarregar e, quando o visitante
 * escreve, toca o aviso (som; com a aba em segundo plano, contador no título e notificação).
 */
export function ConversationLive({ live, handoffOpen, visitorMessages, lastVisitorText }: Props) {
  const router = useRouter();
  const previous = useRef<number | null>(null);

  useEffect(() => {
    if (!live || handoffOpen) return;
    const t = window.setInterval(() => {
      if (!document.hidden) router.refresh();
    }, 5000);
    return () => window.clearInterval(t);
  }, [live, handoffOpen, router]);

  useEffect(() => {
    if (previous.current !== null && visitorMessages > previous.current) {
      signal({ title: "Nova mensagem do visitante", body: lastVisitorText.slice(0, 140), tag: "conversation-message" });
    }
    previous.current = visitorMessages;
  }, [visitorMessages, lastVisitorText]);

  return null;
}
