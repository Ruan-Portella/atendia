"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getOrCreateVisitorId } from "@/lib/utils";

export interface ChatBotPublic {
  key: string;
  name: string;
  clientName: string;
  color: string;
  avatarText: string;
  welcome: string;
  suggestedQuestions: string[];
  poweredBy?: string | null; // nome da agência (white-label) ou null para esconder
  leadForm?: boolean;
}

type HandoffMode = "bot" | "requested" | "agent";
/** Mensagem de alguém da equipe; `after` = quantas mensagens do chat já existiam quando chegou. */
interface AgentMessage {
  id: number;
  content: string;
  after: number;
}

function textOf(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Janela de chat completa: usada no widget (iframe), na página de demo e no teste ao vivo do editor.
 * Guarda a conversa por visitante no localStorage para continuar de onde parou.
 * Quando o visitante pede atendente (ou alguém da agência assume), consulta
 * /api/chat/updates para mostrar as respostas da equipe no meio da conversa.
 */
export function ChatWindow({
  bot,
  channel = "widget",
  apiBase = "",
  onClose,
  compact = false,
}: {
  bot: ChatBotPublic;
  channel?: "widget" | "demo" | "painel";
  apiBase?: string;
  onClose?: () => void;
  compact?: boolean;
}) {
  const storageKey = `atendia:${bot.key}`;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [visitorId] = useState<string | null>(() => getOrCreateVisitorId(storageKey));
  const [input, setInput] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [handoff, setHandoff] = useState<HandoffMode>("bot");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [activity, setActivity] = useState(0); // sobe a cada resposta do servidor


  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${apiBase}/api/chat`,
        body: () => ({ key: bot.key, conversationId, visitorId, channel }),
        fetch: async (url, init) => {
          const res = await fetch(url, init);
          const cid = res.headers.get("X-Conversation-Id");
          if (cid) setConversationId(cid);
          const h = res.headers.get("X-Handoff");
          setHandoff(h === "agent" || h === "requested" ? h : "bot");
          setActivity((n) => n + 1);
          if (!res.ok) {
            const j = await res
              .clone()
              .json()
              .catch(() => ({}));
            setErrorText(j.message ?? "Não consegui responder agora. Tente de novo.");
          } else setErrorText(null);
          return res;
        },
      }),
    [apiBase, bot.key, conversationId, visitorId, channel],
  );

  const { messages, sendMessage, status } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  // o assistente chamou a ferramenta de pedir atendente nesta resposta
  const askedForHuman = messages.some((m) => m.parts.some((part) => part.type === "tool-chamar_atendente"));
  const mode: HandoffMode = handoff === "bot" && askedForHuman ? "requested" : handoff;

  // Consulta respostas da equipe: rápido durante o atendimento humano, devagar logo depois
  // de uma conversa (a agência pode assumir sem o visitante pedir), e para quando esfria.
  const messageCount = messages.length;
  const lastAgentId = agentMessages.at(-1)?.id ?? 0;
  useEffect(() => {
    if (!conversationId) return;
    const startedAt = Date.now();
    const interval = mode === "agent" ? 4000 : mode === "requested" ? 6000 : 20000;
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      if (mode === "bot" && Date.now() - startedAt > 10 * 60_000) return;
      try {
        const res = await fetch(`${apiBase}/api/chat/updates?key=${bot.key}&conversationId=${conversationId}&after=${lastAgentId}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { mode: HandoffMode; messages: Array<{ id: number; content: string }> };
        setHandoff(j.mode);
        if (j.messages.length) setAgentMessages((prev) => [...prev, ...j.messages.filter((m) => !prev.some((x) => x.id === m.id)).map((m) => ({ ...m, after: messageCount }))]);
      } catch {
        // sem rede: tenta de novo no próximo ciclo
      }
    }, interval);
    return () => window.clearInterval(timer);
  }, [apiBase, bot.key, conversationId, mode, activity, lastAgentId, messageCount]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, agentMessages]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    sendMessage({ text: t });
  };

  const showSuggestions = messages.length === 0 && bot.suggestedQuestions.length > 0;

  return (
    <div className="flex h-full flex-col bg-white text-[#1b1f1d]" style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div className="flex items-center gap-2.5 px-4 py-3 text-white" style={{ background: bot.color }}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold" style={{ color: bot.color }}>
          {bot.avatarText}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="text-[15px] font-semibold">{bot.name}</div>
          <div className="text-xs opacity-85">{bot.clientName} · responde na hora</div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Fechar" className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-[#f4f6f8] p-3.5">
        <Bubble side="left">{bot.welcome}</Bubble>
        {showSuggestions && (
          <div className="flex flex-wrap gap-1.5 pb-1">
            {bot.suggestedQuestions.map((q) => (
              <button key={q} type="button" onClick={() => send(q)} className="rounded-full border bg-white px-3 py-1.5 text-[13px] font-medium" style={{ borderColor: bot.color, color: bot.color }}>
                {q}
              </button>
            ))}
          </div>
        )}
        {agentMessages.filter((a) => a.after === 0).map((a) => <AgentBubble key={`a${a.id}`} label={`Equipe ${bot.clientName}`}>{a.content}</AgentBubble>)}
        {messages.map((m, i) => {
          const t = textOf(m);
          const agents = agentMessages.filter((a) => a.after === i + 1);
          return (
            <Fragment key={m.id}>
              {(t || m.role === "user") && (
                <Bubble side={m.role === "user" ? "right" : "left"} color={bot.color}>
                  {t}
                </Bubble>
              )}
              {agents.map((a) => <AgentBubble key={`a${a.id}`} label={`Equipe ${bot.clientName}`}>{a.content}</AgentBubble>)}
            </Fragment>
          );
        })}
        {agentMessages.filter((a) => a.after > messages.length).map((a) => <AgentBubble key={`a${a.id}`} label={`Equipe ${bot.clientName}`}>{a.content}</AgentBubble>)}
        {mode !== "bot" && (
          <div className="self-center rounded-full bg-white px-3 py-1 text-center text-[12px] text-[#4c5551] shadow-sm">
            {mode === "agent" ? "Você está falando com uma pessoa da equipe" : "Avisamos a equipe. Alguém vai responder aqui."}
          </div>
        )}
        {busy && mode !== "agent" && messages[messages.length - 1]?.role === "user" && (
          <Bubble side="left">
            <span className="inline-flex gap-1 align-middle">
              <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#9aa39e]" />
              <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#9aa39e] [animation-delay:120ms]" />
              <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#9aa39e] [animation-delay:240ms]" />
            </span>
          </Bubble>
        )}
        {errorText && <div className="rounded-lg bg-[#fbe6e6] px-3 py-2 text-[13px] text-[#b23a3a]">{errorText}</div>}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-center gap-2 border-t border-[#e1e6ea] p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label htmlFor={`msg-${bot.key}`} className="sr-only">Mensagem</label>
        <input
          id={`msg-${bot.key}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva uma mensagem…"
          className="min-w-0 flex-1 rounded-full border border-[#e1e6ea] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#9aa39e]"
          autoComplete="off"
        />
        <button type="submit" aria-label="Enviar" disabled={busy || !input.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50" style={{ background: bot.color }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </form>
      {bot.poweredBy !== null && !compact && (
        <div className="pb-2 text-center text-[11px] text-[#8a938e]">
          Atendimento por <span className="font-semibold text-[#4c5551]">{bot.poweredBy}</span>
        </div>
      )}
    </div>
  );
}

function AgentBubble({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="max-w-[88%] self-start rounded-[14px_14px_14px_4px] border border-[#cfe3d8] bg-[#eef6f1] px-3.5 py-2.5 text-sm leading-[1.45]">
      <div className="mb-0.5 text-[11px] font-semibold text-[#1f4e3d]">{label}</div>
      <div className="whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function Bubble({ side, color, children }: { side: "left" | "right"; color?: string; children: React.ReactNode }) {
  if (side === "right") {
    return (
      <div className="max-w-[82%] self-end whitespace-pre-wrap rounded-[14px_14px_4px_14px] px-3.5 py-2.5 text-sm leading-[1.45] text-white" style={{ background: color ?? "#1b1f1d" }}>
        {children}
      </div>
    );
  }
  return <div className="max-w-[88%] self-start whitespace-pre-wrap rounded-[14px_14px_14px_4px] border border-[#e1e6ea] bg-white px-3.5 py-2.5 text-sm leading-[1.45]">{children}</div>;
}
