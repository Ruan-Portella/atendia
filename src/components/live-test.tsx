"use client";

import { useEffect, useState } from "react";
import { ListChecks } from "lucide-react";
import { ChatWindow, type ChatBotPublic } from "@/components/chat-window";
import { routineTestTitle, type RoutineTestView } from "@/lib/routine-test-view";
import { cn } from "@/lib/utils";

const POLL_MS = 3_000;

/**
 * O teste ao vivo do chatbot: o chat e, com roteiro ligado, a faixa do passo atual (itens menores
 * da conferência de 20/10, parte 5). A faixa pergunta a cada 3 segundos, só com a aba visível e
 * depois da primeira mensagem.
 */
export function LiveTest({ botId, bot, hasRoutines, className, chatClassName }: { botId: string; bot: ChatBotPublic; hasRoutines: boolean; className?: string; chatClassName?: string }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  // a leitura fica presa à conversa: conversa nova (ou nenhuma) não mostra a faixa da anterior
  const [read, setRead] = useState<{ conversationId: string; run: RoutineTestView | null } | null>(null);
  const run = read && read.conversationId === conversationId ? read.run : null;

  useEffect(() => {
    if (!hasRoutines || !conversationId) return;
    let alive = true;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/bots/${botId}/routine-test?conversationId=${conversationId}`, { cache: "no-store" });
        if (res.ok && alive) setRead({ conversationId, run: ((await res.json()) as { run: RoutineTestView | null }).run });
      } catch {
        // sem rede: a próxima leitura tenta de novo
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [botId, conversationId, hasRoutines]);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {run && <RoutineStrip run={run} />}
      <div className={chatClassName}>
        <ChatWindow channel="painel" bot={bot} onConversation={setConversationId} />
      </div>
    </div>
  );
}

function RoutineStrip({ run }: { run: RoutineTestView }) {
  const active = run.status === "active";
  return (
    <div className={cn("flex shrink-0 flex-col gap-1 rounded-xl border px-3 py-2 text-xs", active ? "border-brand/30 bg-brand-soft text-ink" : "border-line bg-panel text-ink-2")} aria-live="polite">
      <p className="flex items-center gap-1.5 font-semibold">
        <ListChecks size={14} className={active ? "text-brand" : "text-muted"} />
        {routineTestTitle(run)}
      </p>
      {active && run.stepLabel && (
        <p>
          <span className="font-semibold">{run.stepLabel}</span>
          {run.stepText ? `: ${run.stepText}` : ""}
        </p>
      )}
      {active && run.attempts > 0 && !run.failing && <p className="text-muted">Tentativa {run.attempts} de {run.maxAttempts} do dado.</p>}
      {active && run.failing && <p className="text-amber-ink">{run.maxAttempts} tentativas sem conferir: a pessoa vê “Falar com a equipe” e “Cancelar”.</p>}
      {active && run.collected.length > 0 && <p className="text-muted">Já recebidos: {run.collected.join(", ")}</p>}
    </div>
  );
}
