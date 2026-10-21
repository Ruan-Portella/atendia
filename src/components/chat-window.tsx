"use client";

import { useChat } from "@ai-sdk/react";
import { useRouter } from "next/navigation";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { adoptLegacyStorage, getOrCreateVisitorId } from "@/lib/utils";
import { cardName, parseComponents, type MessageComponent } from "@/lib/components";
import { TICKET_WHATSAPP_CONSENT } from "@/lib/ticket-text";

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
  /** botão "Falar com uma pessoa" (Bot → Atendimento) */
  handoffButton?: boolean;
  /** chamados no chat do site (Caixa de entrada, parte 7a): a aba "Abrir chamado" ou só o formulário */
  ticket?: TicketPublic | null;
}

/** O formulário de chamado do chatbot (tickets.ts TicketForm, sem o que é do servidor). */
export interface TicketPublic {
  mode: "aba" | "sozinho";
  phone: "nao" | "opcional" | "obrigatorio";
  subjects: string[];
  /** o chatbot tem WhatsApp conectado: o aceite do aviso pela resposta aparece junto do telefone (parte 7d) */
  whatsapp?: boolean;
  /** aceita um anexo, foto ou PDF, até 4 MB (leva das sobras, parte 4) */
  attachment?: boolean;
}

const TICKET_FILE_MAX = 4 * 1024 * 1024;

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
  /** quem escreveu ou entrou: nome de exibição e foto (sem nome, "Equipe {empresa}") */
  name?: string | null;
  avatar?: string | null;
  /** imagem ou documento junto (link de 1 hora) */
  file?: AgentFile | null;
  /** botões, lista ou link mandados pela integração (API) */
  components?: MessageComponent | null;
}

/** Arquivo de uma mensagem de atendente (link assinado de 1 hora, gerado a cada consulta). */
interface AgentFile {
  url: string;
  name: string | null;
  kind: "image" | "document";
}

/** Mensagem de atendente vinda do servidor. */
interface AgentMessage {
  id: number;
  content: string;
  name?: string | null;
  avatar?: string | null;
  file?: AgentFile | null;
  components?: MessageComponent | null;
}

/** Quem está atendendo agora (para "Viviane entrou na conversa"). */
interface AgentFace {
  name: string;
  avatar: string | null;
}

interface HandoffState {
  mode: HandoffMode;
  timeline: TimelineItem[];
  /** mensagens do chat (visitante + assistente) até agora, para posicionar os itens */
  count: number;
  lastAgentId: number;
}

type HandoffAction =
  | { type: "server"; mode: HandoffMode; agent?: AgentFace | null } // o que o servidor informou (cabeçalho ou consulta)
  | { type: "asked" } // o assistente acabou de chamar a equipe nesta resposta
  | { type: "agent"; messages: AgentMessage[] }
  | { type: "count"; n: number }
  | { type: "restore"; mode: HandoffMode; count: number; agents: Array<AgentMessage & { after: number }> }; // conversa retomada depois do F5

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
        timeline: a.agents.map((x) => ({ key: `a${x.id}`, kind: "agent" as const, content: x.content, after: x.after, name: x.name, avatar: x.avatar, file: x.file ?? null, components: x.components ?? null })),
      };
    case "count":
      return a.n === s.count ? s : { ...s, count: a.n };
    case "asked":
      return s.mode === "bot" ? { ...s, mode: "requested" } : s;
    case "agent": {
      const fresh = a.messages.filter((m) => !s.timeline.some((x) => x.key === `a${m.id}`));
      if (!fresh.length) return s;
      return { ...s, lastAgentId: Math.max(s.lastAgentId, ...fresh.map((m) => m.id)), timeline: [...s.timeline, ...fresh.map((m) => ({ key: `a${m.id}`, kind: "agent" as const, content: m.content, after: s.count, name: m.name, avatar: m.avatar, file: m.file ?? null, components: m.components ?? null }))] };
    }
    case "server": {
      if (a.mode === s.mode) return s;
      const kind = a.mode === "agent" ? "joined" : a.mode === "bot" && s.mode === "agent" ? "ended" : null;
      const timeline = kind ? [...s.timeline, { key: `${kind}${s.timeline.length}`, kind, content: "", after: s.count, name: kind === "joined" ? (a.agent?.name ?? null) : null, avatar: kind === "joined" ? (a.agent?.avatar ?? null) : null } as TimelineItem] : s.timeline;
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

/** Botões, lista ou link que a IA mostrou nesta mensagem (data-components). */
function componentOf(m: UIMessage): MessageComponent | null {
  const part = m.parts.find((p) => p.type === "data-components") as { data?: unknown } | undefined;
  return part ? parseComponents(JSON.stringify(part.data ?? null)) : null;
}

/** Anexos devolvidos por uma ação nesta resposta (data-files: links assinados de 1 hora). */
function filesOf(m: UIMessage): AgentFile[] {
  const part = m.parts.find((p) => p.type === "data-files") as { data?: unknown } | undefined;
  return Array.isArray(part?.data) ? (part.data as AgentFile[]).filter((f) => typeof f?.url === "string") : [];
}

/**
 * Opções viram botões (o toque manda o título como mensagem do visitante, e o id do botão junto:
 * o Confirmar de uma ação é resolvido pelo id); link vira botão que abre a página; carrossel vira
 * cards que rolam para o lado (o toque manda o botão e o nome do card: "Pedir esta: Pizza
 * Calabresa"). Só a última mensagem aceita toque (o primeiro toque já desabilita); as antigas
 * ficam como lembrete.
 */
function ComponentView({ component, color, active, onPick }: { component: MessageComponent; color: string; active: boolean; onPick: (text: string, buttonId: string) => void }) {
  if (component.type === "carousel") {
    return (
      // shrink-0: na coluna de mensagens (flex com rolagem), a caixa com rolagem lateral encolheria na altura
      <div className="-mx-1 flex max-w-full shrink-0 snap-x gap-2 self-stretch overflow-x-auto px-1 pb-1">
        {component.cards.map((card, i) => (
          <div key={i} className="flex w-[200px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border bg-white" style={{ borderColor: "#e5e7eb" }}>
            {card.media.type === "video" ? (
              <video src={card.media.url} controls muted playsInline preload="metadata" className="aspect-[4/3] w-full bg-black object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- imagem do sistema do cliente, de qualquer domínio
              <img src={card.media.url} alt={cardName(card)} loading="lazy" className="aspect-[4/3] w-full object-cover" />
            )}
            <div className="flex flex-1 flex-col gap-1 p-2.5">
              {card.title && <p className="text-[13px] font-semibold leading-snug text-gray-900">{card.title}</p>}
              {card.text && <p className="whitespace-pre-line text-[12px] leading-snug text-gray-600">{card.text}</p>}
              <div className="mt-auto flex flex-col gap-1 pt-1">
                {card.link ? (
                  <a href={card.link.url} target="_blank" rel="noopener noreferrer" className="rounded-full border px-3 py-1 text-center text-[12px] font-semibold" style={{ borderColor: color, color }}>
                    {card.link.label} ↗
                  </a>
                ) : (
                  (card.buttons ?? []).map((b) => (
                    <button key={b.id} type="button" disabled={!active} onClick={() => onPick(`${b.title}: ${cardName(card)}`, b.id)} className="rounded-full border px-3 py-1 text-[12px] font-medium disabled:opacity-50" style={{ borderColor: color, color }}>
                      {b.title}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (component.type === "link") {
    return (
      <a href={component.url} target="_blank" rel="noopener noreferrer" className="self-start rounded-full border bg-white px-3.5 py-1.5 text-[13px] font-semibold" style={{ borderColor: color, color }}>
        {component.label} ↗
      </a>
    );
  }
  return (
    <div className="flex max-w-[88%] flex-wrap gap-1.5 self-start">
      {component.options.map((o) => (
        <button key={o.id} type="button" disabled={!active} onClick={() => onPick(o.title, o.id)} className="rounded-full border bg-white px-3 py-1.5 text-left text-[13px] font-medium disabled:opacity-50" style={{ borderColor: color, color }}>
          {o.title}
        </button>
      ))}
    </div>
  );
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
  embedded = false,
  identity = false,
  initialProtocol = null,
  onConversation,
}: {
  bot: ChatBotPublic;
  channel?: "widget" | "demo" | "painel";
  apiBase?: string;
  onClose?: () => void;
  compact?: boolean;
  /** dentro do iframe do widget: conversa com o widget.js da página */
  embedded?: boolean;
  /** o site identifica a pessoa (getToken, P2): espera o token antes de retomar a conversa */
  identity?: boolean;
  /** o link do e-mail do chamado (?chamado=): abre o acompanhamento com o protocolo (parte 7c) */
  initialProtocol?: string | null;
  /** o teste ao vivo acompanha a conversa (a faixa do passo do roteiro) */
  onConversation?: (id: string | null) => void;
}) {
  // nome genérico: roda no domínio da agência, nada da plataforma aparece
  const storageKey = `chat:${bot.key}`;
  // no iframe do widget, o X do topo fecha o balão na página do cliente
  const close = onClose ?? (embedded ? () => notifyParent("chat-widget:close") : undefined);
  const [conversationId, setConversationId] = useState<string | null>(null);
  useEffect(() => onConversation?.(conversationId), [conversationId, onConversation]);
  const [visitorId] = useState<string | null>(() => {
    adoptLegacyStorage(`atendia:${bot.key}`, storageKey); // chave de antes da Boavoz
    return getOrCreateVisitorId(storageKey);
  });
  const [input, setInput] = useState("");
  // chamados (parte 7a): com a aba, a pessoa troca entre a conversa e o formulário; sozinho, só o formulário
  const [view, setView] = useState<"chat" | "chamado">(bot.ticket?.mode === "sozinho" || (bot.ticket && initialProtocol) ? "chamado" : "chat");
  const [errorText, setErrorText] = useState<string | null>(null);
  // o assistente não pode responder agora (cota, teste, falha): mostra o formulário de contato
  const [fallback, setFallback] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [{ mode, timeline, lastAgentId }, dispatch] = useReducer(handoffReducer, { mode: "bot", timeline: [], count: 0, lastAgentId: 0 });
  const [activity, setActivity] = useState(0); // sobe a cada resposta do servidor

  // Identidade (P2): o site entrega o token pelo widget.js; ele vai no Authorization de toda
  // requisição. Trocar de pessoa ou de contexto (setContext, logout, getToken que falhou) abre
  // uma conversa nova: a de usuário nunca aparece para outra pessoa nem sem o token.
  const [token, setToken] = useState<string | null>(null);
  // só para comparar dentro do tratamento das mensagens do widget.js (troca de pessoa)
  const tokenRef = useRef<string | null>(null);
  const [identityState, setIdentityState] = useState<"waiting" | "ready">(identity && embedded ? "waiting" : "ready");
  const [identityEpoch, setIdentityEpoch] = useState(0);
  // token recusado: pede outro uma vez; recusado de novo, segue anônimo numa conversa nova
  const [authRetried, setAuthRetried] = useState(false);
  const auth = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});
  // sem identidade daqui em diante: o mesmo caminho do logout (o tratamento das mensagens do
  // widget.js limpa a tela e abre uma conversa anônima)
  const dropIdentity = () => window.dispatchEvent(new MessageEvent("message", { data: { type: "chat-widget:context", token: null }, source: window.parent }));

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${apiBase}/api/chat`,
        // só o texto novo: o servidor monta o histórico a partir do banco
        prepareSendMessagesRequest: ({ messages }) => {
          const last = messages[messages.length - 1];
          const buttonId = (last?.metadata as { buttonId?: string } | undefined)?.buttonId ?? null;
          return { body: { key: bot.key, conversationId, visitorId, channel, text: textOf(last), ...(buttonId ? { buttonId } : {}) } };
        },
        fetch: async (url, init) => {
          const headers = new Headers(init?.headers);
          if (token) headers.set("Authorization", `Bearer ${token}`);
          const res = await fetch(url, { ...init, headers });
          // token vencido ou inválido: o widget.js pede outro ao site (uma vez); recusado de novo,
          // a conversa de usuário some e segue anônimo
          if (res.status === 401) {
            if (!authRetried) {
              setAuthRetried(true);
              notifyParent({ type: "chat-widget:token-request" });
              setErrorText("Sua sessão foi atualizada. Envie a mensagem de novo.");
            } else {
              setAuthRetried(false);
              dropIdentity();
              setErrorText("Não consegui confirmar quem você é. Seguimos por aqui sem identificação: envie de novo.");
            }
            return res;
          }
          if (authRetried) setAuthRetried(false);
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
    [apiBase, bot.key, conversationId, visitorId, channel, token, authRetried],
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
      if (message.parts.some((part) => part.type === "data-handoff")) dispatch({ type: "asked" });
    },
  });
  const busy = status === "submitted" || status === "streaming";

  // F5 / voltou ao site: retoma a conversa aberta deste visitante (não no teste do painel)
  const convKey = `${storageKey}:conversa`;
  const resumes = channel !== "painel" && Boolean(visitorId);

  // mensagens do widget.js: token (ao abrir e 5 min antes de vencer), troca de contexto e logout
  useEffect(() => {
    if (!embedded) return;
    const reset = () => {
      setMessages([]);
      setConversationId(null);
      dispatch({ type: "restore", mode: "bot", count: 0, agents: [] });
      setErrorText(null);
      setFallback(null);
      try {
        localStorage.removeItem(convKey);
      } catch {}
      setIdentityEpoch((n) => n + 1);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const d = e.data as { type?: string; token?: string | null } | null;
      if (!d || typeof d !== "object" || typeof d.type !== "string") return;
      const next = typeof d.token === "string" && d.token ? d.token : null;
      if (d.type === "chat-widget:token") {
        const had = tokenRef.current;
        tokenRef.current = next;
        setToken(next);
        // getToken falhou com uma conversa de usuário na tela: ela some e abre uma anônima
        if (had && !next) reset();
        setIdentityState("ready");
      } else if (d.type === "chat-widget:context" || d.type === "chat-widget:logout") {
        const value = d.type === "chat-widget:logout" ? null : next;
        tokenRef.current = value;
        setToken(value);
        reset();
        setIdentityState("ready");
      }
    };
    window.addEventListener("message", onMessage);
    // o site sem resposta em 5 s: segue anônimo (o token que chegar depois vale a partir dali)
    const timer = identity ? window.setTimeout(() => setIdentityState("ready"), 5000) : undefined;
    if (identity) notifyParent({ type: "chat-widget:token-request" });
    return () => {
      window.removeEventListener("message", onMessage);
      if (timer) window.clearTimeout(timer);
    };
  }, [embedded, identity, convKey, setMessages]);

  useEffect(() => {
    if (!resumes || identityState === "waiting") return;
    // com token, o servidor acha sozinho a conversa desta pessoa; sem token, a que o navegador guardou
    let saved: string | null = null;
    if (!token) {
      try {
        saved = localStorage.getItem(convKey);
      } catch {
        return;
      }
      if (!saved) return;
    }
    let cancelled = false;
    (async () => {
      try {
        const qs = `key=${bot.key}&visitorId=${encodeURIComponent(visitorId ?? "")}${saved ? `&conversationId=${saved}` : ""}`;
        const res = await fetch(`${apiBase}/api/chat/history?${qs}`, { cache: "no-store", headers: auth() });
        const j = (await res.json()) as { resumable?: boolean; conversationId?: string; mode?: HandoffMode; messages?: Array<{ id: number; role: string; content: string; name?: string | null; avatar?: string | null; components?: MessageComponent | null; file?: AgentFile | null; files?: AgentFile[] }> };
        if (cancelled) return;
        if (!j.resumable || !j.conversationId) {
          if (saved) localStorage.removeItem(convKey);
          if (embedded) notifyParent({ type: "chat-widget:conversation", active: false });
          return;
        }
        const ui: UIMessage[] = [];
        const agents: Array<AgentMessage & { after: number }> = [];
        for (const m of j.messages ?? []) {
          if (m.role === "agent") agents.push({ id: m.id, content: m.content, after: ui.length, name: m.name, avatar: m.avatar, file: m.file ?? null, components: m.components ?? null });
          else ui.push({ id: `h${m.id}`, role: m.role === "user" ? "user" : "assistant", parts: [{ type: "text", text: m.content }, ...(m.components ? [{ type: "data-components" as const, data: m.components }] : []), ...(m.files?.length ? [{ type: "data-files" as const, data: m.files }] : [])] });
        }
        setMessages(ui);
        setConversationId(j.conversationId);
        dispatch({ type: "restore", mode: j.mode ?? "bot", count: ui.length, agents });
      } catch {
        // sem rede: começa do zero, sem travar o chat
      }
    })();
    return () => {
      cancelled = true;
    };
    // o token renovado (mesma pessoa) não recarrega a conversa; identityEpoch muda quando a pessoa ou o contexto trocam
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumes, identityState, identityEpoch, convKey, apiBase, bot.key, visitorId, setMessages, embedded]);

  useEffect(() => {
    // o navegador só guarda o id de conversas anônimas (a de usuário volta pelo token)
    if (!resumes || !conversationId || token) return;
    try {
      localStorage.setItem(convKey, conversationId);
      if (embedded) notifyParent({ type: "chat-widget:conversation", active: true });
    } catch {
      // navegador sem armazenamento: só não retoma depois do F5
    }
  }, [resumes, convKey, conversationId, embedded, token]);

  // Consulta o servidor com a conversa aberta: rápido durante o atendimento humano, a cada
  // 30 s no resto (a agência pode assumir sem o visitante pedir). Cada consulta também avisa
  // que o visitante continua no site ("visitante online" no painel). Aba escondida: pausa.
  useEffect(() => {
    if (!conversationId) return;
    const interval = mode === "agent" ? 4000 : mode === "requested" ? 6000 : 30000;
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`${apiBase}/api/chat/updates?key=${bot.key}&conversationId=${conversationId}&after=${lastAgentId}&visitorId=${encodeURIComponent(visitorId ?? "")}`, { cache: "no-store", headers: auth() });
        if (!res.ok) return;
        const j = (await res.json()) as { mode: HandoffMode; agent?: AgentFace | null; messages: AgentMessage[] };
        if (j.messages.length) {
          dispatch({ type: "agent", messages: j.messages });
          if (embedded) notifyParent({ type: "chat-widget:message", from: j.messages.at(-1)!.name ?? `Equipe ${bot.clientName}`, preview: preview(j.messages.at(-1)!.content) });
        }
        dispatch({ type: "server", mode: j.mode, agent: j.agent ?? null });
      } catch {
        // sem rede: tenta de novo no próximo ciclo
      }
    }, interval);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, bot.key, bot.clientName, conversationId, mode, activity, lastAgentId, embedded, visitorId, token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, timeline]);

  const send = (text: string, buttonId?: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    dispatch({ type: "count", n: messages.length + 1 });
    sendMessage({ text: t, ...(buttonId ? { metadata: { buttonId } } : {}) });
  };

  const showSuggestions = messages.length === 0 && bot.suggestedQuestions.length > 0;
  // botões de uma mensagem da equipe ou da integração: só a última coisa da conversa aceita toque
  const lastExtra = timeline[timeline.length - 1];
  const extraActive = (x: TimelineItem) => x.key === lastExtra?.key && x.after >= messages.length && !busy;

  // botão "Falar com uma pessoa": pede atendente sem passar pela IA (a conversa vai para a equipe)
  const [askingHuman, setAskingHuman] = useState(false);
  const askHuman = async () => {
    if (askingHuman || busy) return;
    setAskingHuman(true);
    try {
      const res = await fetch(`${apiBase}/api/chat/handoff`, { method: "POST", headers: { "Content-Type": "application/json", ...auth() }, body: JSON.stringify({ key: bot.key, conversationId, visitorId, channel }) });
      const j = (await res.json().catch(() => ({}))) as { conversationId?: string; userText?: string; notice?: string; fallback?: string; message?: string };
      if (!res.ok || !j.conversationId) {
        if (j.fallback === "contact") setFallback(j.message ?? "Deixe seu contato que a equipe retorna.");
        else setErrorText(j.message ?? "Não consegui chamar a equipe agora. Tente de novo.");
        return;
      }
      setConversationId(j.conversationId);
      const now = Date.now();
      const next: UIMessage[] = [
        ...messages,
        { id: `hu${now}`, role: "user", parts: [{ type: "text", text: j.userText ?? "Quero falar com uma pessoa" }] },
        { id: `ha${now}`, role: "assistant", parts: [{ type: "text", text: j.notice ?? "" }] },
      ];
      setMessages(next);
      dispatch({ type: "count", n: next.length });
      dispatch({ type: "asked" });
      setErrorText(null);
    } catch {
      setErrorText("Sem conexão. Tente de novo.");
    } finally {
      setAskingHuman(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-white text-[#1b1f1d]" style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div className="flex items-center gap-2.5 px-4 py-3 text-white" style={{ background: bot.color }}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold" style={{ color: bot.color }}>
          {bot.avatarText}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="text-[15px] font-semibold">{bot.name}</div>
          <div className="text-xs opacity-85">{bot.clientName} · {bot.ticket?.mode === "sozinho" ? "abra um chamado" : "responde na hora"}</div>
        </div>
        {close && (
          <button type="button" onClick={close} aria-label="Fechar" className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        )}
      </div>

      {bot.ticket?.mode === "aba" && (
        <div className="flex border-b border-[#e1e6ea] bg-white text-[13px] font-semibold" role="tablist">
          {(["chat", "chamado"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className="flex-1 border-b-2 px-3 py-2" style={view === v ? { borderColor: bot.color, color: bot.color } : { borderColor: "transparent", color: "#4c5551" }}>
              {v === "chat" ? "Conversar" : "Abrir chamado"}
            </button>
          ))}
        </div>
      )}
      {bot.ticket && view === "chamado" ? (
        <TicketPanel bot={bot} ticket={bot.ticket} apiBase={apiBase} visitorId={visitorId} storageKey={storageKey} initialProtocol={initialProtocol} onBack={bot.ticket.mode === "aba" ? () => setView("chat") : undefined} />
      ) : (
      <>
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
        {timeline.filter((x) => x.after === 0).map((x) => <Extra key={x.key} item={x} label={`Equipe ${bot.clientName}`} botName={bot.name} color={bot.color} active={extraActive(x)} onPick={send} />)}
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
              {m.role === "assistant" && filesOf(m).length > 0 && (
                <div className="flex max-w-[82%] flex-col gap-1 self-start">
                  {filesOf(m).map((f) => (
                    <AgentAttachment key={f.url} file={f} />
                  ))}
                </div>
              )}
              {m.role === "assistant" && componentOf(m) && <ComponentView component={componentOf(m)!} color={bot.color} active={i === messages.length - 1 && !busy && mode !== "agent"} onPick={send} />}
              {extras.map((x) => <Extra key={x.key} item={x} label={`Equipe ${bot.clientName}`} botName={bot.name} color={bot.color} active={extraActive(x)} onPick={send} />)}
            </Fragment>
          );
        })}
        {timeline.filter((x) => x.after > messages.length).map((x) => <Extra key={x.key} item={x} label={`Equipe ${bot.clientName}`} botName={bot.name} color={bot.color} active={extraActive(x)} onPick={send} />)}
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

      {!fallback && bot.handoffButton && mode === "bot" && (
        <div className="flex justify-center border-t border-[#e1e6ea] px-2.5 pt-2">
          <button type="button" onClick={askHuman} disabled={askingHuman || busy} className="rounded-full border bg-white px-3 py-1 text-[12.5px] font-medium disabled:opacity-50" style={{ borderColor: bot.color, color: bot.color }}>
            {askingHuman ? "Chamando a equipe…" : "Falar com uma pessoa"}
          </button>
        </div>
      )}
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
      </>
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

/** Quantas letras na descrição antes de a sugestão da base ser procurada, e quantas vezes por chamado. */
const SUGGEST_AFTER_CHARS = 30;
const SUGGEST_MAX = 2;

/**
 * Abrir chamado (Caixa de entrada, parte 7a): nome, e-mail, telefone (se o chatbot pede), assunto
 * (se há lista) e descrição. O protocolo fica guardado no navegador, para acompanhar depois.
 * Enquanto a pessoa escreve, a IA procura a resposta na base (parte 7b, "Isso ajuda?"); se
 * resolver, o chamado não é aberto e isso conta no relatório.
 */
function TicketPanel({ bot, ticket, apiBase, visitorId, storageKey, initialProtocol, onBack }: { bot: ChatBotPublic; ticket: TicketPublic; apiBase: string; visitorId: string | null; storageKey: string; initialProtocol?: string | null; onBack?: () => void }) {
  const [following, setFollowing] = useState(Boolean(initialProtocol));
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [subject, setSubject] = useState("");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [avoided, setAvoided] = useState(false);

  // a pessoa parou de escrever por 1,5 s: procura na base (até 2 vezes por chamado)
  useEffect(() => {
    const text = description.trim();
    if (dismissed || suggestion || asked >= SUGGEST_MAX || text.length < SUGGEST_AFTER_CHARS) return;
    const timer = window.setTimeout(async () => {
      setAsked((n) => n + 1);
      try {
        const res = await fetch(`${apiBase}/api/widget/ticket/suggest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: bot.key, visitorId, subject: subject || null, text }) });
        const j = (await res.json().catch(() => ({}))) as { suggestion?: string | null };
        if (j.suggestion) setSuggestion(j.suggestion);
      } catch {
        // sem rede: segue o chamado normal
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [description, subject, dismissed, suggestion, asked, apiBase, bot.key, visitorId]);

  async function resolvedBySuggestion() {
    setAvoided(true);
    try {
      await fetch(`${apiBase}/api/widget/ticket/resolved`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: bot.key, subject: subject || null }) });
    } catch {
      // a contagem é só para o relatório
    }
  }
  const field = "rounded-lg border border-[#e1e6ea] bg-white px-3 py-2 text-sm outline-none focus:border-[#9aa39e]";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const file = fd.get("file");
    const hasFile = file instanceof File && file.size > 0;
    if (hasFile && file.size > TICKET_FILE_MAX) return setError("O anexo vai até 4 MB. Mande uma foto menor ou um PDF mais leve.");
    setState("sending");
    setError(null);
    try {
      const fields = { key: bot.key, visitorId, name: get("name"), email: get("email"), phone: get("phone") || null, subject: get("subject") || null, description: get("description"), whatsapp: fd.get("whatsapp") === "on" };
      // com anexo, vai como formulário (multipart); sem, como JSON
      let body: BodyInit = JSON.stringify(fields);
      if (hasFile) {
        const multipart = new FormData();
        for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined) multipart.set(k, String(v));
        multipart.set("file", file);
        body = multipart;
      }
      const res = await fetch(`${apiBase}/api/widget/ticket`, { method: "POST", ...(hasFile ? {} : { headers: { "Content-Type": "application/json" } }), body });
      const j = (await res.json().catch(() => ({}))) as { protocol?: string; message?: string };
      if (!res.ok || !j.protocol) {
        setError(j.message ?? "Confira os dados e tente de novo.");
        return;
      }
      setProtocol(j.protocol);
      // "Abrir outro chamado" começa do zero (e a sugestão pode aparecer de novo)
      setDescription("");
      setSubject("");
      setSuggestion(null);
      setAsked(0);
      setDismissed(false);
      try {
        const key = `${storageKey}:chamados`;
        const saved = JSON.parse(localStorage.getItem(key) ?? "[]") as Array<{ protocol: string; email?: string; at: string }>;
        localStorage.setItem(key, JSON.stringify([{ protocol: j.protocol, email: get("email"), at: new Date().toISOString() }, ...saved].slice(0, 10)));
      } catch {
        // navegador sem armazenamento: o protocolo continua na tela e no e-mail
      }
    } catch {
      setError("Sem conexão. Tente de novo.");
    } finally {
      setState("idle");
    }
  }

  if (following) return <TicketFollow bot={bot} apiBase={apiBase} storageKey={storageKey} initialProtocol={initialProtocol ?? null} onBack={() => setFollowing(false)} />;
  if (avoided) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#f4f6f8] p-6 text-center">
        <p className="text-[15px] font-semibold">Que bom que resolveu!</p>
        <p className="text-[13px] text-[#4c5551]">Se precisar de mais alguma coisa, é só voltar aqui.</p>
        {onBack && <button type="button" onClick={onBack} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-white" style={{ background: bot.color }}>Voltar à conversa</button>}
      </div>
    );
  }
  if (protocol) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#f4f6f8] p-6 text-center">
        <p className="text-[15px] font-semibold">Chamado aberto!</p>
        <p className="text-sm text-[#4c5551]">Seu protocolo é</p>
        <p className="rounded-lg bg-white px-4 py-2 font-mono text-lg font-bold tracking-wider" style={{ color: bot.color }}>{protocol}</p>
        <p className="text-[13px] text-[#4c5551]">A equipe de {bot.clientName} responde no seu e-mail. Guarde o protocolo para acompanhar.</p>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <button type="button" onClick={() => setFollowing(true)} className="rounded-full border bg-white px-3 py-1.5 text-[13px] font-medium" style={{ borderColor: bot.color, color: bot.color }}>Acompanhar</button>
          <button type="button" onClick={() => setProtocol(null)} className="rounded-full border bg-white px-3 py-1.5 text-[13px] font-medium" style={{ borderColor: bot.color, color: bot.color }}>Abrir outro chamado</button>
          {onBack && <button type="button" onClick={onBack} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-white" style={{ background: bot.color }}>Voltar à conversa</button>}
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-2 overflow-y-auto bg-[#f4f6f8] p-3.5">
      <p className="text-[13px] text-[#4c5551]">Conte o que aconteceu: a equipe de {bot.clientName} responde no seu e-mail, com um protocolo para acompanhar.</p>
      <button type="button" onClick={() => setFollowing(true)} className="self-start text-[12.5px] font-semibold underline" style={{ color: bot.color }}>Já tem um chamado? Acompanhar</button>
      <label className="sr-only" htmlFor={`t-name-${bot.key}`}>Nome</label>
      <input id={`t-name-${bot.key}`} name="name" required minLength={2} maxLength={80} placeholder="Seu nome" autoComplete="name" className={field} />
      <label className="sr-only" htmlFor={`t-email-${bot.key}`}>E-mail</label>
      <input id={`t-email-${bot.key}`} name="email" type="email" required maxLength={200} placeholder="Seu e-mail" autoComplete="email" className={field} />
      {ticket.phone !== "nao" && (
        <>
          <label className="sr-only" htmlFor={`t-phone-${bot.key}`}>Telefone</label>
          <input id={`t-phone-${bot.key}`} name="phone" type="tel" required={ticket.phone === "obrigatorio"} maxLength={40} placeholder={ticket.phone === "obrigatorio" ? "Telefone com DDD" : "Telefone com DDD (opcional)"} autoComplete="tel" className={field} />
          {ticket.whatsapp && (
            <label className="flex items-start gap-2 text-[12.5px] text-[#4c5551]">
              <input type="checkbox" name="whatsapp" className="mt-0.5" />
              <span>{TICKET_WHATSAPP_CONSENT}</span>
            </label>
          )}
        </>
      )}
      {ticket.subjects.length > 0 && (
        <>
          <label className="sr-only" htmlFor={`t-subject-${bot.key}`}>Assunto</label>
          <select id={`t-subject-${bot.key}`} name="subject" required value={subject} onChange={(e) => setSubject(e.target.value)} className={field}>
            <option value="" disabled>Assunto</option>
            {ticket.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </>
      )}
      <label className="sr-only" htmlFor={`t-desc-${bot.key}`}>Descrição</label>
      <textarea id={`t-desc-${bot.key}`} name="description" required minLength={10} maxLength={2000} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="O que aconteceu? Quanto mais detalhe, mais rápido a equipe resolve." className={`${field} resize-none`} />
      {ticket.attachment && (
        <label className="flex flex-col gap-1 text-[12.5px] text-[#4c5551]" htmlFor={`t-file-${bot.key}`}>
          <span>Anexo (opcional): uma foto ou um PDF, até 4 MB</span>
          <input id={`t-file-${bot.key}`} name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="text-[12.5px]" />
        </label>
      )}
      {suggestion && !dismissed && (
        <div className="flex flex-col gap-2 rounded-lg border bg-white p-3 text-sm" style={{ borderColor: bot.color }} role="status">
          <p className="text-[12px] font-semibold" style={{ color: bot.color }}>Isso ajuda?</p>
          <p className="whitespace-pre-wrap text-[13px] text-[#1b1f1d]">{suggestion}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={resolvedBySuggestion} className="rounded-full px-3 py-1 text-[12.5px] font-medium text-white" style={{ background: bot.color }}>Resolveu, não preciso abrir</button>
            <button type="button" onClick={() => setDismissed(true)} className="rounded-full border bg-white px-3 py-1 text-[12.5px] font-medium" style={{ borderColor: bot.color, color: bot.color }}>Não, quero abrir o chamado</button>
          </div>
        </div>
      )}
      {error && <p className="text-[12px] text-[#b23a3a]">{error}</p>}
      <button type="submit" disabled={state === "sending"} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{ background: bot.color }}>
        {state === "sending" ? "Abrindo…" : "Abrir chamado"}
      </button>
    </form>
  );
}

const TICKET_STATUS_TEXT: Record<string, string> = { aberto: "Aberto: a equipe ainda vai responder", em_andamento: "Em andamento", aguardando_cliente: "Aguardando você: a equipe respondeu", resolvido: "Resolvido" };

interface FollowedTicket {
  protocol: string;
  status: string;
  subject: string | null;
  messages: Array<{ from: "cliente" | "equipe"; name: string | null; text: string; at: string }>;
}

/**
 * Acompanhar o chamado (Chamados, parte 7c): protocolo e e-mail de quem abriu (os do navegador vêm
 * preenchidos), o status e as mensagens; escrever de novo devolve o chamado para a equipe.
 */
function TicketFollow({ bot, apiBase, storageKey, initialProtocol, onBack }: { bot: ChatBotPublic; apiBase: string; storageKey: string; initialProtocol: string | null; onBack: () => void }) {
  const [saved] = useState<{ protocol: string; email: string }>(() => {
    try {
      const list = JSON.parse(localStorage.getItem(`${storageKey}:chamados`) ?? "[]") as Array<{ protocol: string; email?: string }>;
      const hit = (initialProtocol && list.find((x) => x.protocol === initialProtocol)) || list[0];
      return { protocol: initialProtocol ?? hit?.protocol ?? "", email: hit?.email ?? "" };
    } catch {
      return { protocol: initialProtocol ?? "", email: "" };
    }
  });
  const [ticket, setTicket] = useState<FollowedTicket | null>(null);
  const [who, setWho] = useState<{ protocol: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const field = "rounded-lg border border-[#e1e6ea] bg-white px-3 py-2 text-sm outline-none focus:border-[#9aa39e]";

  async function load(body: { protocol: string; email: string; text?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/widget/ticket/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: bot.key, ...body }) });
      const j = (await res.json().catch(() => ({}))) as Partial<FollowedTicket> & { message?: string };
      if (!res.ok || !j.protocol) {
        setError(j.message ?? "Não achamos esse chamado.");
        return false;
      }
      setTicket(j as FollowedTicket);
      setWho({ protocol: body.protocol, email: body.email });
      return true;
    } catch {
      setError("Sem conexão. Tente de novo.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!ticket || !who) {
    return (
      <form
        className="flex flex-1 flex-col gap-2 overflow-y-auto bg-[#f4f6f8] p-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          void load({ protocol: String(fd.get("protocol") ?? ""), email: String(fd.get("email") ?? "") });
        }}
      >
        <p className="text-[13px] text-[#4c5551]">Informe o protocolo e o e-mail que você usou para abrir o chamado.</p>
        <label className="sr-only" htmlFor={`f-prot-${bot.key}`}>Protocolo</label>
        <input id={`f-prot-${bot.key}`} name="protocol" required defaultValue={saved.protocol} maxLength={20} placeholder="Protocolo (ex.: K7Q2-9XMP)" className={`${field} font-mono uppercase`} autoComplete="off" />
        <label className="sr-only" htmlFor={`f-mail-${bot.key}`}>E-mail</label>
        <input id={`f-mail-${bot.key}`} name="email" type="email" required defaultValue={saved.email} maxLength={200} placeholder="Seu e-mail" autoComplete="email" className={field} />
        {error && <p className="text-[12px] text-[#b23a3a]">{error}</p>}
        <button type="submit" disabled={busy} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{ background: bot.color }}>{busy ? "Procurando…" : "Ver o chamado"}</button>
        <button type="button" onClick={onBack} className="text-[12.5px] font-semibold underline" style={{ color: bot.color }}>Abrir um chamado novo</button>
      </form>
    );
  }
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#f4f6f8]">
      <div className="border-b border-[#e1e6ea] bg-white px-3.5 py-2 text-[12.5px]">
        <span className="font-mono font-bold" style={{ color: bot.color }}>{ticket.protocol}</span>
        {ticket.subject ? <span className="text-[#4c5551]"> · {ticket.subject}</span> : null}
        <div className="text-[#4c5551]">{TICKET_STATUS_TEXT[ticket.status] ?? ticket.status}</div>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3.5">
        {ticket.messages.map((m, i) => (
          <Bubble key={i} side={m.from === "cliente" ? "right" : "left"} color={bot.color}>
            {m.from === "equipe" && <span className="mb-0.5 block text-[11px] font-semibold" style={{ color: bot.color }}>{m.name ?? `Equipe ${bot.clientName}`}</span>}
            {m.text}
          </Bubble>
        ))}
      </div>
      <form
        className="flex flex-col gap-2 border-t border-[#e1e6ea] bg-white p-2.5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (text.trim().length < 2 || busy) return;
          if (await load({ ...who, text })) setText("");
        }}
      >
        {error && <p className="text-[12px] text-[#b23a3a]">{error}</p>}
        <label className="sr-only" htmlFor={`f-text-${bot.key}`}>Mensagem para a equipe</label>
        <textarea id={`f-text-${bot.key}`} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder={ticket.status === "resolvido" ? "Escreva para reabrir o chamado…" : "Escreva para a equipe…"} className={`${field} resize-none`} />
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => { setTicket(null); setWho(null); }} className="text-[12.5px] font-semibold underline" style={{ color: bot.color }}>Outro chamado</button>
          <button type="submit" disabled={busy || text.trim().length < 2} className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: bot.color }}>{busy ? "Enviando…" : "Enviar"}</button>
        </div>
      </form>
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

function Extra({ item, label, botName, color, active, onPick }: { item: TimelineItem; label: string; botName: string; color: string; active: boolean; onPick: (text: string, buttonId: string) => void }) {
  if (item.kind === "agent")
    return (
      <>
        <AgentBubble label={item.name ?? label} avatar={item.avatar ?? null} file={item.file ?? null}>
          {item.file ? fileCaption(item.content) : item.content}
        </AgentBubble>
        {item.components && <ComponentView component={item.components} color={color} active={active} onPick={onPick} />}
      </>
    );
  return (
    <div className="self-center rounded-full bg-[#e9ecef] px-3 py-1 text-center text-[12px] text-[#4c5551]">
      {item.kind === "joined" ? (item.name ? `${item.name} entrou na conversa.` : "Uma pessoa da equipe entrou na conversa.") : `Atendimento encerrado. ${botName} voltou a responder.`}
    </div>
  );
}

/** Com arquivo, o rótulo gravado ("📷 (foto)", "📄 nome.pdf") não aparece: o arquivo já está ali. */
const fileCaption = (content: string) => (/^(📷 \(foto\)|📄 \S[^\n]*)$/u.test(content.trim()) ? "" : content);

/** Imagem (abre ampliada em outra aba) ou documento (link com o nome). */
function AgentAttachment({ file }: { file: AgentFile }) {
  if (file.kind === "image") {
    return (
      <a href={file.url} target="_blank" rel="noopener noreferrer" className="mt-1 block">
        {/* imagem da conversa, pelo link assinado do BoaVoz */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={file.url} alt={file.name ?? "imagem"} className="max-h-60 max-w-full rounded-lg" />
      </a>
    );
  }
  return (
    <a href={file.url} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1.5 rounded-lg border border-[#cfe3d8] bg-white px-2.5 py-1.5 text-[13px] font-semibold text-[#1f4e3d] underline-offset-2 hover:underline">
      📄 <span className="min-w-0 truncate">{file.name ?? "Documento"}</span>
    </a>
  );
}

/** Mensagem de alguém da equipe: foto (ou a inicial) e o nome de exibição. */
function AgentBubble({ label, avatar, file, children }: { label: string; avatar: string | null; file?: AgentFile | null; children: React.ReactNode }) {
  return (
    <div className="flex max-w-[92%] items-end gap-2 self-start">
      {avatar ? (
        // foto do atendente, do Storage público da plataforma
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#cfe3d8] text-[11px] font-bold text-[#1f4e3d]">{label.trim().charAt(0).toUpperCase()}</span>
      )}
      <div className="min-w-0 rounded-[14px_14px_14px_4px] border border-[#cfe3d8] bg-[#eef6f1] px-3.5 py-2.5 text-sm leading-[1.45]">
        <div className="mb-0.5 text-[11px] font-semibold text-[#1f4e3d]">{label}</div>
        {children ? <div className="whitespace-pre-wrap">{children}</div> : null}
        {file && <AgentAttachment file={file} />}
      </div>
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
