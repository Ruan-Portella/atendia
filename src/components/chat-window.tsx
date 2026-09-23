"use client";

import { useChat } from "@ai-sdk/react";
import { useRouter } from "next/navigation";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from "react";
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
  /** política de privacidade da agência (link no aviso LGPD do chat) */
  privacyUrl?: string | null;
}

type HandoffMode = "bot" | "requested" | "agent";
/**
 * Item extra na conversa: mensagem de alguém da equipe ou aviso de "entrou"/"encerrou".
 * `after` = quantas mensagens do chat já existiam quando chegou (define onde aparece).
 */
interface TimelineItem {
  key: string;
  kind: "agent" | "joined" | "ended";
  content: string;
  after: number;
}

interface HandoffState {
  mode: HandoffMode;
  timeline: TimelineItem[];
  /** mensagens do chat (visitante + assistente) até agora, para posicionar os itens */
  count: number;
  lastAgentId: number;
}

type HandoffAction =
  | { type: "server"; mode: HandoffMode } // o que o servidor informou (cabeçalho ou consulta)
  | { type: "asked" } // o assistente acabou de chamar a equipe nesta resposta
  | { type: "agent"; messages: Array<{ id: number; content: string }> }
  | { type: "count"; n: number }
  | { type: "restore"; mode: HandoffMode; count: number; agents: Array<{ id: number; content: string; after: number }> }; // conversa retomada depois do F5

/**
 * Estado do atendimento humano no widget. Quem manda é o servidor; aqui só registramos as
 * transições e deixamos o aviso na conversa ("uma pessoa entrou", "atendimento encerrado").
 */
export function handoffReducer(s: HandoffState, a: HandoffAction): HandoffState {
  switch (a.type) {
    case "restore":
      return {
        mode: a.mode,
        count: a.count,
        lastAgentId: a.agents.reduce((m, x) => Math.max(m, x.id), 0),
        timeline: a.agents.map((x) => ({ key: `a${x.id}`, kind: "agent" as const, content: x.content, after: x.after })),
      };
    case "count":
      return a.n === s.count ? s : { ...s, count: a.n };
    case "asked":
      return s.mode === "bot" ? { ...s, mode: "requested" } : s;
    case "agent": {
      const fresh = a.messages.filter((m) => !s.timeline.some((x) => x.key === `a${m.id}`));
      if (!fresh.length) return s;
      return { ...s, lastAgentId: Math.max(s.lastAgentId, ...fresh.map((m) => m.id)), timeline: [...s.timeline, ...fresh.map((m) => ({ key: `a${m.id}`, kind: "agent" as const, content: m.content, after: s.count }))] };
    }
    case "server": {
      if (a.mode === s.mode) return s;
      const kind = a.mode === "agent" ? "joined" : a.mode === "bot" && s.mode === "agent" ? "ended" : null;
      const timeline = kind ? [...s.timeline, { key: `${kind}${s.timeline.length}`, kind, content: "", after: s.count } as TimelineItem] : s.timeline;
      return { ...s, mode: a.mode, timeline };
    }
  }
}

/**
 * Avisa a página do site do cliente (widget.js) quando o chat roda dentro do iframe:
 * mensagem nova (bolinha e prévia no balão), conversa aberta (recarrega o chat em segundo
 * plano depois do F5) e fechar. "*" porque o domínio do site do cliente não é conhecido aqui;
 * o conteúdo é só da conversa deste próprio visitante.
 */
function notifyParent(message: unknown) {
  if (typeof window !== "undefined" && window.parent !== window) window.parent.postMessage(message, "*");
}

const preview = (t: string) => (t.length > 120 ? `${t.slice(0, 117)}…` : t);

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
  embedded = false,
}: {
  bot: ChatBotPublic;
  channel?: "widget" | "demo" | "painel";
  apiBase?: string;
  onClose?: () => void;
  compact?: boolean;
  /** dentro do iframe do widget: conversa com o widget.js da página */
  embedded?: boolean;
}) {
  const storageKey = `atendia:${bot.key}`;
  // no iframe do widget, o X do topo fecha o balão na página do cliente
  const close = onClose ?? (embedded ? () => notifyParent("chat-widget:close") : undefined);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [visitorId] = useState<string | null>(() => getOrCreateVisitorId(storageKey));
  const [input, setInput] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  // o assistente não pode responder agora (cota, teste, falha): mostra o formulário de contato
  const [fallback, setFallback] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [{ mode, timeline, lastAgentId }, dispatch] = useReducer(handoffReducer, { mode: "bot", timeline: [], count: 0, lastAgentId: 0 });
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
          dispatch({ type: "server", mode: h === "agent" || h === "requested" ? h : "bot" });
          setActivity((n) => n + 1);
          if (!res.ok) {
            const j = await res
              .clone()
              .json()
              .catch(() => ({}));
            if (j.fallback === "contact") setFallback(j.message ?? "Deixe seu contato que a equipe retorna.");
            else setErrorText(j.message ?? "Não consegui responder agora. Tente de novo.");
          } else setErrorText(null);
          return res;
        },
      }),
    [apiBase, bot.key, conversationId, visitorId, channel],
  );

  const router = useRouter();
  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
    onFinish: ({ message, messages: all }) => {
      if (embedded && message.role === "assistant" && textOf(message)) notifyParent({ type: "chat-widget:message", from: bot.name, preview: preview(textOf(message)) });
      dispatch({ type: "count", n: all.length });
      // no teste ao vivo do editor, a pergunta sem resposta aparece na lista sem recarregar
      // (espera o servidor terminar de gravar, que acontece logo depois do fim do stream)
      if (channel === "painel") window.setTimeout(() => router.refresh(), 1200);
      if (message.parts.some((part) => part.type === "tool-chamar_atendente")) dispatch({ type: "asked" });
    },
  });
  const busy = status === "submitted" || status === "streaming";

  // F5 / voltou ao site: retoma a conversa aberta deste visitante (não no teste do painel)
  const convKey = `${storageKey}:conversa`;
  const resumes = channel !== "painel" && Boolean(visitorId);
  useEffect(() => {
    if (!resumes) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(convKey);
    } catch {
      return;
    }
    if (!saved) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/chat/history?key=${bot.key}&conversationId=${saved}&visitorId=${encodeURIComponent(visitorId ?? "")}`, { cache: "no-store" });
        const j = (await res.json()) as { resumable?: boolean; mode?: HandoffMode; messages?: Array<{ id: number; role: string; content: string }> };
        if (cancelled) return;
        if (!j.resumable) {
          localStorage.removeItem(convKey);
          if (embedded) notifyParent({ type: "chat-widget:conversation", active: false });
          return;
        }
        const ui: UIMessage[] = [];
        const agents: Array<{ id: number; content: string; after: number }> = [];
        for (const m of j.messages ?? []) {
          if (m.role === "agent") agents.push({ id: m.id, content: m.content, after: ui.length });
          else ui.push({ id: `h${m.id}`, role: m.role === "user" ? "user" : "assistant", parts: [{ type: "text", text: m.content }] });
        }
        setMessages(ui);
        setConversationId(saved);
        dispatch({ type: "restore", mode: j.mode ?? "bot", count: ui.length, agents });
      } catch {
        // sem rede: começa do zero, sem travar o chat
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resumes, convKey, apiBase, bot.key, visitorId, setMessages, embedded]);

  useEffect(() => {
    if (!resumes || !conversationId) return;
    try {
      localStorage.setItem(convKey, conversationId);
      if (embedded) notifyParent({ type: "chat-widget:conversation", active: true });
    } catch {
      // navegador sem armazenamento: só não retoma depois do F5
    }
  }, [resumes, convKey, conversationId, embedded]);

  // Consulta o servidor com a conversa aberta: rápido durante o atendimento humano, a cada
  // 30 s no resto (a agência pode assumir sem o visitante pedir). Cada consulta também avisa
  // que o visitante continua no site ("visitante online" no painel). Aba escondida: pausa.
  useEffect(() => {
    if (!conversationId) return;
    const interval = mode === "agent" ? 4000 : mode === "requested" ? 6000 : 30000;
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`${apiBase}/api/chat/updates?key=${bot.key}&conversationId=${conversationId}&after=${lastAgentId}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { mode: HandoffMode; messages: Array<{ id: number; content: string }> };
        if (j.messages.length) {
          dispatch({ type: "agent", messages: j.messages });
          if (embedded) notifyParent({ type: "chat-widget:message", from: `Equipe ${bot.clientName}`, preview: preview(j.messages.at(-1)!.content) });
        }
        dispatch({ type: "server", mode: j.mode });
      } catch {
        // sem rede: tenta de novo no próximo ciclo
      }
    }, interval);
    return () => window.clearInterval(timer);
  }, [apiBase, bot.key, bot.clientName, conversationId, mode, activity, lastAgentId, embedded]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, timeline]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    dispatch({ type: "count", n: messages.length + 1 });
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
        {close && (
          <button type="button" onClick={close} aria-label="Fechar" className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
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
        {timeline.filter((x) => x.after === 0).map((x) => <Extra key={x.key} item={x} label={`Equipe ${bot.clientName}`} botName={bot.name} />)}
        {messages.map((m, i) => {
          const t = textOf(m);
          const extras = timeline.filter((x) => x.after === i + 1);
          return (
            <Fragment key={m.id}>
              {(t || m.role === "user") && (
                <Bubble side={m.role === "user" ? "right" : "left"} color={bot.color}>
                  {t}
                </Bubble>
              )}
              {extras.map((x) => <Extra key={x.key} item={x} label={`Equipe ${bot.clientName}`} botName={bot.name} />)}
            </Fragment>
          );
        })}
        {timeline.filter((x) => x.after > messages.length).map((x) => <Extra key={x.key} item={x} label={`Equipe ${bot.clientName}`} botName={bot.name} />)}
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
        {errorText && !fallback && <div className="rounded-lg bg-[#fbe6e6] px-3 py-2 text-[13px] text-[#b23a3a]">{errorText}</div>}
        <div ref={bottomRef} />
      </div>

      {fallback ? (
        <ContactFallback bot={bot} apiBase={apiBase} conversationId={conversationId} message={fallback} />
      ) : (
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
      )}
      <p className="px-3 pb-1 text-center text-[10.5px] leading-snug text-[#8a938e]">
        A conversa fica registrada para o atendimento.{bot.privacyUrl ? <> <a href={bot.privacyUrl} target="_blank" rel="noopener" className="underline">Privacidade</a></> : null}
      </p>
      {bot.poweredBy !== null && !compact && (
        <div className="pb-2 text-center text-[11px] text-[#8a938e]">
          Atendimento por <span className="font-semibold text-[#4c5551]">{bot.poweredBy}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Quando o assistente não pode responder (limite do plano, teste encerrado, falha da IA), o
 * visitante deixa o contato aqui em vez de ver um erro. Vai para /api/leads, que não depende
 * da cota, e chega ao painel e ao e-mail da agência como qualquer lead.
 */
function ContactFallback({ bot, apiBase, conversationId, message }: { bot: ChatBotPublic; apiBase: string; conversationId: string | null; message: string }) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const contact = String(fd.get("contact") ?? "").trim();
    const isEmailContact = contact.includes("@");
    setState("sending");
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: bot.key,
          conversationId,
          name: String(fd.get("name") ?? "").trim(),
          ...(isEmailContact ? { email: contact } : { phone: contact }),
          notes: String(fd.get("notes") ?? "").trim().slice(0, 500) || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.message ?? "Confira os dados e tente de novo.");
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError("Sem conexão. Tente de novo.");
      setState("idle");
    }
  }

  if (state === "done") {
    return <div className="border-t border-[#e1e6ea] p-4 text-center text-sm text-[#1b1f1d]">Recebemos seu contato! A equipe de {bot.clientName} vai te responder em breve.</div>;
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-[#e1e6ea] p-3">
      <p className="text-[13px] text-[#4c5551]">{message}</p>
      <input name="name" required minLength={2} maxLength={80} placeholder="Seu nome" autoComplete="name" className="rounded-lg border border-[#e1e6ea] px-3 py-2 text-sm outline-none focus:border-[#9aa39e]" />
      <input name="contact" required maxLength={120} placeholder="WhatsApp ou e-mail" autoComplete="tel" className="rounded-lg border border-[#e1e6ea] px-3 py-2 text-sm outline-none focus:border-[#9aa39e]" />
      <textarea name="notes" rows={2} maxLength={500} placeholder="Como podemos ajudar? (opcional)" className="resize-none rounded-lg border border-[#e1e6ea] px-3 py-2 text-sm outline-none focus:border-[#9aa39e]" />
      {error && <p className="text-[12px] text-[#b23a3a]">{error}</p>}
      <button type="submit" disabled={state === "sending"} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{ background: bot.color }}>
        {state === "sending" ? "Enviando…" : "Enviar contato"}
      </button>
    </form>
  );
}

function Extra({ item, label, botName }: { item: TimelineItem; label: string; botName: string }) {
  if (item.kind === "agent") return <AgentBubble label={label}>{item.content}</AgentBubble>;
  return (
    <div className="self-center rounded-full bg-[#e9ecef] px-3 py-1 text-center text-[12px] text-[#4c5551]">
      {item.kind === "joined" ? "Uma pessoa da equipe entrou na conversa." : `Atendimento encerrado. ${botName} voltou a responder.`}
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
