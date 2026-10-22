"use client";

import { useState, useTransition } from "react";
import { Reply, SmilePlus } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { useToast } from "@/components/ui/toast";

/** O campo de resposta da equipe ouve este evento: a mensagem citada vai junto do próximo envio. */
export const QUOTE_EVENT = "boavoz:quote";
export type QuoteDetail = { id: number; snippet: string };

/**
 * Responder citando e reagir, embaixo de uma mensagem do WhatsApp ou do Instagram (Conversa mais
 * natural, parte 2). "Responder" leva o trecho para o campo de resposta; "Reagir" abre a paleta
 * (no Instagram, só o coração). O mesmo emoji de novo tira a reação.
 */
export function MessageActions({ id, snippet, reactions, current, onReact, align }: {
  id: number;
  snippet: string;
  /** os emojis do canal; vazio: sem reagir (a mensagem não é do contato ou o prazo passou) */
  reactions: readonly string[];
  /** a reação que a equipe já deixou */
  current: string | null;
  onReact: ((messageId: number, emoji: string | null) => Promise<ActionResult>) | null;
  align: "start" | "end";
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const react = (emoji: string) =>
    start(async () => {
      if (!onReact) return;
      try {
        const r = await onReact(id, emoji === current ? null : emoji);
        if (r.ok) setOpen(false);
        else toast.error(r.message);
      } catch {
        toast.error("Não foi possível reagir agora. Verifique a conexão e tente de novo.");
      }
    });

  const quote = () => {
    window.dispatchEvent(new CustomEvent<QuoteDetail>(QUOTE_EVENT, { detail: { id, snippet } }));
  };

  const canReact = Boolean(onReact) && reactions.length > 0;
  return (
    <div className={`flex items-center gap-1 text-[11px] text-muted transition-opacity ${align === "end" ? "self-end" : "self-start"} ${open ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"}`}>
      <button type="button" onClick={quote} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-panel hover:text-ink" title="Responder citando esta mensagem">
        <Reply size={13} />
        Responder
      </button>
      {canReact && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-panel hover:text-ink" title="Reagir a esta mensagem">
          <SmilePlus size={13} />
          Reagir
        </button>
      )}
      {open && canReact && (
        <div role="group" aria-label="Escolha a reação" className="flex items-center gap-0.5 rounded-full border border-line bg-panel px-1 py-0.5 shadow-sm">
          {reactions.map((e) => (
            <button
              key={e}
              type="button"
              disabled={pending}
              onClick={() => react(e)}
              aria-pressed={e === current}
              title={e === current ? "Tirar a reação" : "Reagir com este emoji"}
              className={`rounded-full px-1 text-base leading-6 disabled:opacity-50 ${e === current ? "bg-brand-soft" : "hover:bg-ground"}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
