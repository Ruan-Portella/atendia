"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
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

function textOf(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Janela de chat completa: usada no widget (iframe), na página de demo e no teste ao vivo do editor.
 * Guarda a conversa por visitante no localStorage para continuar de onde parou.
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


  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${apiBase}/api/chat`,
        body: () => ({ key: bot.key, conversationId, visitorId, channel }),
        fetch: async (url, init) => {
          const res = await fetch(url, init);
          const cid = res.headers.get("X-Conversation-Id");
          if (cid) setConversationId(cid);
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

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
        {messages.map((m) => {
          const t = textOf(m);
          if (!t && m.role === "assistant") return null;
          return (
            <Bubble key={m.id} side={m.role === "user" ? "right" : "left"} color={bot.color}>
              {t}
            </Bubble>
          );
        })}
        {busy && messages[messages.length - 1]?.role === "user" && (
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
