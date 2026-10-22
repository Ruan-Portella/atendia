import { Fragment } from "react";
import { asButtons, cardName, parseComponents } from "@/lib/components";
import { parsePhotoReading, photoReadingLines } from "@/lib/photo-note";
import { failureReason } from "@/lib/send-errors";
import type { ActionResult } from "@/lib/action-result";
import { MessageActions } from "@/components/message-actions";
import { quoteSnippet } from "@/lib/message-links";
import { ChevronDown, Sparkles } from "lucide-react";
import { BotFace } from "@/components/bot-face";
import { aiTrace, durationLabel } from "@/lib/ai-trace";
import { initials } from "@/lib/utils";

export interface ThreadMessage {
  id: number;
  role: string;
  content: string;
  author?: string | null;
  /** quem escreveu (leva B1'): tipo, id e o nome mostrado no momento do envio */
  author_type?: string | null;
  author_id?: string | null;
  author_display_name?: string | null;
  /** caracteres do começo que são anúncio (entrada do atendente, aviso de IA, "Voltei!") */
  announce_chars?: number | null;
  /** botões, lista ou link mostrados junto (JSON) */
  components_enc?: string | null;
  sources?: unknown;
  /** As ferramentas que a IA chamou nesta resposta (o "O que a IA fez" do painel). */
  tool_results?: unknown;
  /** Barrada pela regra de estado na hora do envio (ex.: alguém assumiu enquanto a IA respondia). */
  blocked_reason?: string | null;
  /** O canal recusou: o contato não recebeu. */
  failed_at?: string | null;
  error_code?: string | null;
  /** O contato editou (Instagram) ou desfez a mensagem. */
  edited_at?: string | null;
  deleted_at?: string | null;
  /** Post ou reel do Instagram compartilhado pelo contato. */
  channel_ref?: { kind?: string; url?: string | null; permalink?: string | null; title?: string | null } | null;
  created_at?: string;
  /** Arquivos que o contato mandou (guardados cifrados; abertos pela rota /api/files). */
  attachments?: Array<{ id: string; mime: string; size: number; doc_type: string; filename: string | null }>;
  /** O que a IA leu das fotos do contato (JSON aberto pela camada de mensagens). */
  photo_reading_enc?: string | null;
  /** Transferência (role "transferencia", Caixa de entrada, parte 4): para quem foi. */
  target_label?: string | null;
  /** A mensagem citada (Conversa mais natural): o trecho e de quem era. */
  quote?: { snippet: string; fromContact: boolean } | null;
  /** A reação do contato e a da equipe (um emoji). */
  contact_reaction?: string | null;
  agent_reaction?: string | null;
  /** Tem o id do canal: a equipe pode citar e reagir (WhatsApp e Instagram). */
  linkable?: boolean;
}

/** Citar e reagir pela conversa (só quem está com ela, no WhatsApp e no Instagram). */
export interface ThreadActions {
  /** null: o prazo de 24 h passou (citar ainda vale no Instagram com a tag de atendimento humano) */
  onReact: ((messageId: number, emoji: string | null) => Promise<ActionResult>) | null;
  reactions: readonly string[];
}

/** Nota interna e transferência (Caixa de entrada, parte 4): só a equipe vê. */
const isNote = (m: ThreadMessage) => m.role === "nota" || m.role === "transferencia";

/** As notas e transferências no meio das mensagens, pela hora. Pura. */
export function withNotes(messages: ThreadMessage[], notes: Array<{ kind: string; authorName: string; body: string | null; targetLabel: string | null; createdAt: string }>): ThreadMessage[] {
  if (!notes.length) return messages;
  const asMessages: ThreadMessage[] = notes.map((n, i) => ({ id: -(i + 1), role: n.kind, content: n.body ?? "", author_display_name: n.authorName, target_label: n.targetLabel, created_at: n.createdAt }));
  return [...messages, ...asMessages].sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? "") || a.id - b.id);
}

function NoteView({ m }: { m: ThreadMessage }) {
  return (
    <div className="max-w-[90%] self-center rounded-lg border border-dashed border-amber-line bg-amber-soft px-3 py-2 text-sm text-amber-ink">
      <div className="text-[11px] font-semibold">
        {m.role === "transferencia" ? `${m.author_display_name ?? "Alguém da equipe"} transferiu para ${m.target_label ?? "outra pessoa"}` : `Nota interna · ${m.author_display_name ?? "equipe"}`}
        <span className="font-normal opacity-80"> · só a equipe vê</span>
      </div>
      {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
    </div>
  );
}

const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Foto, áudio e vídeo na própria conversa; documento como link para baixar. */
function AttachmentView({ a, fromContact }: { a: NonNullable<ThreadMessage["attachments"]>[number]; fromContact: boolean }) {
  const src = `/api/files/${a.id}`;
  if (a.doc_type === "image" || a.doc_type === "sticker") {
    return (
      <a href={src} target="_blank" rel="noopener" className="mt-1.5 block">
        {/* arquivo do contato, pela rota autenticada (sem otimização de imagem) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={a.filename ?? (fromContact ? "Imagem enviada pelo contato" : "Imagem enviada pela empresa")} loading="lazy" className={a.doc_type === "sticker" ? "h-24 w-24 object-contain" : "max-h-72 max-w-full rounded-lg"} />
      </a>
    );
  }
  if (a.doc_type === "audio") return <audio controls preload="none" src={src} className="mt-1.5 w-full max-w-[320px]" />;
  if (a.doc_type === "video") return <video controls preload="none" src={src} className="mt-1.5 max-h-72 max-w-full rounded-lg" />;
  return (
    <a href={src} className="mt-1.5 block text-[12px] underline opacity-90">
      Baixar {a.filename ?? "arquivo"} ({kb(a.size)})
    </a>
  );
}

/** O que a IA leu das fotos do contato (leva de leitura de fotos): a equipe entende a resposta dela. */
function PhotoReadingView({ json }: { json?: string | null }) {
  const lines = photoReadingLines(parsePhotoReading(json));
  if (!lines.length) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] leading-snug opacity-80">
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

/**
 * O texto, com o anúncio do começo (entrada do atendente, aviso de IA ou "Voltei!") marcado:
 * o contato recebeu tudo junto, numa mensagem só.
 */
function MessageText({ m }: { m: ThreadMessage }) {
  const n = m.announce_chars ?? 0;
  if (m.deleted_at || n <= 0 || n >= m.content.length) return <div className={m.deleted_at ? "whitespace-pre-wrap italic opacity-70" : "whitespace-pre-wrap"}>{m.content}</div>;
  return (
    <>
      <div className="mb-1.5 rounded-md border border-dashed border-line px-2 py-1 text-[12px] text-muted">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.06em]">anúncio</span>
        <span className="whitespace-pre-wrap">{m.content.slice(0, n).trim()}</span>
      </div>
      <div className="whitespace-pre-wrap">{m.content.slice(n)}</div>
    </>
  );
}

/** O que o contato viu junto da mensagem: as opções (botões ou lista), o botão de link ou o carrossel. */
function ShownComponent({ json }: { json?: string | null }) {
  const c = parseComponents(json);
  if (!c) return null;
  if (c.type === "carousel") {
    return (
      <div className="mt-1.5 flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">carrossel · {c.cards.length} {c.cards.length === 1 ? "card" : "cards"}</span>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {c.cards.map((card, i) => (
            <div key={i} className="flex w-[132px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-panel text-[11px]">
              {card.media.type === "video" ? (
                <div className="flex aspect-[4/3] items-center justify-center bg-ground text-muted">vídeo</div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- imagem do sistema do cliente, de qualquer domínio
                <img src={card.media.url} alt={cardName(card)} loading="lazy" className="aspect-[4/3] w-full object-cover" />
              )}
              <div className="flex flex-col gap-0.5 p-1.5">
                <span className="font-semibold">{cardName(card)}</span>
                {card.link ? <a href={card.link.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand">{card.link.label} ↗</a> : (card.buttons ?? []).map((b) => <span key={b.id} className="rounded-full border border-line px-1.5 text-center">{b.title}</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (c.type === "link") {
    return (
      <a href={c.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block rounded-full border border-line bg-panel px-2.5 py-0.5 text-[12px] font-semibold text-brand">
        {c.label} ↗
      </a>
    );
  }
  // o botão do WhatsApp para a pessoa compartilhar o número (contato que fala pelo nome de usuário)
  if (c.type === "contact_request") return <span className="mt-1.5 inline-block rounded-full border border-line bg-panel px-2.5 py-0.5 text-[12px] font-semibold text-brand">📞 Compartilhar o número</span>;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">{asButtons(c.options) ? "botões" : "lista"}</span>
      {c.options.map((o) => <span key={o.id} className="rounded-full border border-line bg-panel px-2 py-0.5 text-[12px]">{o.title}</span>)}
    </div>
  );
}

interface Props {
  messages: ThreadMessage[];
  /** Leads com pedido nesta conversa; requests: só os pedidos desta conversa (sem eles, o interesse). */
  leads?: Array<{ name: string | null; phone: string | null; email: string | null; notes: string | null; requests?: Array<{ text: string | null }> }> | null;
  /** Nome mostrado nas mensagens de atendente (ex.: "Viviane (você)", "Pelo celular", "Cliente · Joana"). */
  agentLabel: (m: ThreadMessage) => string;
  showSources?: boolean;
  /** Troca de contexto (pareamento, P2): separador antes da primeira mensagem do trecho novo. */
  contextChange?: { at: string; label: string } | null;
  /** O canal da conversa: o motivo de "Não entregue" depende dele. */
  channel?: string | null;
  /** Responder citando e reagir (Conversa mais natural, parte 2); sem isto, só leitura. */
  actions?: ThreadActions | null;
  /** O nome do contato (as iniciais e o nome em cima das mensagens dele). */
  contactName?: string | null;
  /** O chatbot (redesenho): o rosto e o nome nas respostas da IA. */
  bot?: { name: string; color?: string | null } | null;
  /** "O que a IA fez" em cima de cada resposta (painel da agência; precisa do tool_results). */
  showTrace?: boolean;
}

const TZ = "America/Sao_Paulo";
const hourOf = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) : "");
const dayOf = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ }) : "");

/** "HOJE", "ONTEM" ou a data, no separador de dia. */
function dayLabel(iso: string, now = new Date()): string {
  const d = dayOf(iso);
  if (d === dayOf(now.toISOString())) return "Hoje";
  if (d === dayOf(new Date(now.getTime() - 86_400_000).toISOString())) return "Ontem";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" });
}

/** O trecho que vai para o campo de resposta ao citar (sem o anúncio do começo). Pura. */
const snippetOf = (m: ThreadMessage) => quoteSnippet(m.content.slice(Math.max(0, m.announce_chars ?? 0)));

/** O trecho da mensagem citada, em cima da resposta (Conversa mais natural). */
function QuoteView({ quote }: { quote: { snippet: string; fromContact: boolean } }) {
  return (
    <div className="mb-1.5 rounded-md border-l-2 border-brand/50 bg-ink/5 px-2 py-1 text-[12px]">
      <span className="font-semibold">{quote.fromContact ? "Contato" : "Empresa"}</span>
      <span className="block truncate opacity-80">{quote.snippet}</span>
    </div>
  );
}

/** A reação do contato e a da equipe, embaixo da mensagem. */
function ReactionsView({ contact, agent }: { contact: string | null; agent: string | null }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5 text-[12px]">
      {contact && <span className="rounded-full bg-panel px-1.5 py-0.5 text-ink shadow-sm" title="Reação do contato">{contact} <span className="text-[10px] text-muted">contato</span></span>}
      {agent && <span className="rounded-full bg-panel px-1.5 py-0.5 text-ink shadow-sm" title="Reação da equipe">{agent} <span className="text-[10px] text-muted">equipe</span></span>}
    </div>
  );
}

/** O check que se desenha (o passo feito) ou o traço (a ferramenta recusou). */
function StepMark({ ok, delay }: { ok: boolean; delay: number }) {
  return (
    <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${ok ? "bg-brand-soft text-brand" : "bg-raised text-muted"}`}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {ok ? <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray="24" style={{ animation: `bv-draw 360ms var(--ease-out) ${delay + 120}ms both` }} /> : <path d="M7 12h10" />}
      </svg>
    </span>
  );
}

/**
 * "O que a IA fez" (redesenho, etapa 2): os passos desta resposta, do que já fica gravado (a base,
 * as ferramentas e a mensagem do contato antes). A mais recente vem aberta; os passos entram um a um.
 */
function TraceView({ m, before, botName, open }: { m: ThreadMessage; before: ThreadMessage | null; botName: string; open: boolean }) {
  const t = aiTrace({ message: m, before: before ? { content: before.content, created_at: before.created_at, hasPhoto: Boolean(before.photo_reading_enc) || Boolean(before.attachments?.some((a) => a.doc_type === "image")) } : null });
  const n = t.steps.length;
  return (
    <details open={open} className="group/trace w-full max-w-[440px] self-end overflow-hidden rounded-[14px] bg-panel text-left shadow-[inset_0_0_0_1px_var(--color-line),inset_0_1px_0_var(--highlight)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12.5px] [&::-webkit-details-marker]:hidden">
        <Sparkles size={14} className="shrink-0 text-brand" aria-hidden />
        <span className="font-medium text-ink">O que {botName} fez</span>
        <span className="font-mono text-[10.5px] text-muted">
          {n} {n === 1 ? "passo" : "passos"}{t.seconds !== null ? ` · ${durationLabel(t.seconds)}` : ""}
        </span>
        <ChevronDown size={14} className="ml-auto shrink-0 text-muted transition-transform duration-[220ms] group-open/trace:rotate-180" aria-hidden />
      </summary>
      <ol className="flex flex-col gap-2 border-t border-line-2 px-3 py-2.5">
        {t.steps.map((s, k) => (
          <li key={k} className="flex gap-2.5" style={{ animation: `rise-in var(--dur-base) var(--ease-out) ${k * 160}ms both` }}>
            <StepMark ok={s.ok} delay={k * 160} />
            <span className="flex min-w-0 flex-col">
              <span className={`text-[13px] leading-snug ${s.ok ? "text-ink" : "text-muted"}`}>{s.title}</span>
              {s.detail && <span className="break-words text-[12px] leading-snug text-muted">{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** A IA chamou a equipe nesta resposta: o marco no meio da conversa. */
function handoffEvent(m: ThreadMessage): string | null {
  const call = Array.isArray(m.tool_results) ? (m.tool_results as Array<{ name?: string; input?: { setor?: string }; output?: { ok?: boolean } }>).find((t) => t.name === "chamar_atendente" && t.output?.ok !== false) : undefined;
  if (!call) return null;
  return call.input?.setor ? `A IA chamou a equipe · setor ${call.input.setor}` : "A IA chamou a equipe";
}

function Avatar({ m, contactName, bot }: { m: ThreadMessage; contactName: string; bot: Props["bot"] }) {
  if (m.role === "assistant") return <BotFace color={bot?.color} size={30} className="mt-5" />;
  const label = m.role === "agent" ? (m.author_display_name ?? "Equipe") : contactName;
  return (
    <span className={`mt-5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${m.role === "agent" ? "bg-info-soft text-info" : "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"}`}>
      {initials(label) || "?"}
    </span>
  );
}

/** Conversa (visitante, assistente e atendentes) — painel, portal e área do cliente. */
export function ConversationThread({ messages, leads, agentLabel, showSources = false, contextChange = null, channel = null, actions = null, contactName = null, bot = null, showTrace = false }: Props) {
  const changeAt = contextChange ? Date.parse(contextChange.at) : NaN;
  const firstAfter = Number.isNaN(changeAt) ? -1 : messages.findIndex((m) => m.created_at && Date.parse(m.created_at) >= changeAt);
  const who = contactName?.trim() || (channel === "widget" ? "Visitante" : "Contato");
  const lastAi = messages.findLastIndex((m) => m.role === "assistant" && !m.deleted_at);
  return (
    <>
      {leads && leads.length > 0 && (
        <div className="rounded-[14px] bg-brand-soft p-4 text-sm">
          <div className="font-medium text-brand">Contato capturado</div>
          {leads.map((l, i) => {
            const asked = l.requests ? l.requests.map((r) => r.text).filter(Boolean).join("; ") : l.notes;
            return <div key={i}>{l.name} · {l.phone ?? l.email}{asked ? ` · ${asked}` : ""}</div>;
          })}
        </div>
      )}
      <div className="flex flex-col gap-3">
        {messages.map((m, i) => {
          const mine = m.role !== "user";
          const newDay = m.created_at && dayOf(m.created_at) !== dayOf(messages[i - 1]?.created_at);
          const name = m.role === "assistant" ? (bot?.name ?? "Assistente") : m.role === "agent" ? agentLabel(m) : who;
          const before = m.role === "assistant" ? ([...messages.slice(0, i)].reverse().find((x) => x.role === "user") ?? null) : null;
          const event = showTrace && m.role === "assistant" ? handoffEvent(m) : null;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="my-1 self-center font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">{dayLabel(m.created_at!)}</div>
              )}
              {i === firstAfter && i > 0 && (
                <div className="my-1 flex items-center gap-2 text-[11px] font-medium text-muted">
                  <span className="h-px flex-1 bg-line" />
                  {contextChange!.label}
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
              {isNote(m) ? (
                <NoteView m={m} />
              ) : (
                <div className={`flex max-w-[86%] gap-2.5 sm:max-w-[76%] ${mine ? "flex-row-reverse self-end" : "self-start"}`}>
                  <Avatar m={m} contactName={who} bot={bot} />
                  <div className={`flex min-w-0 flex-col gap-1 ${mine ? "items-end" : "items-start"} ${actions && m.linkable && !m.deleted_at ? "group" : ""}`}>
                    <span className="px-1 text-[12px] text-muted">
                      <span className="font-medium text-ink">{name}</span>
                      {m.role === "assistant" && " · IA"}
                      {m.created_at && ` · ${hourOf(m.created_at)}`}
                    </span>
                    {showTrace && m.role === "assistant" && !m.deleted_at && <TraceView m={m} before={before} botName={bot?.name ?? "a IA"} open={i === lastAi} />}
                    <div
                      className={
                        m.role === "user"
                          ? "max-w-full rounded-[4px_16px_16px_16px] bg-field px-3.5 py-2.5 text-sm leading-relaxed text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
                          : m.role === "agent"
                            ? "max-w-full rounded-[16px_4px_16px_16px] bg-info-soft px-3.5 py-2.5 text-sm leading-relaxed text-ink shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-info)_25%,transparent)]"
                            : "max-w-full rounded-[16px_4px_16px_16px] bg-brand-soft px-3.5 py-2.5 text-sm leading-relaxed text-ink shadow-[inset_0_0_0_1px_var(--color-brand-line)]"
                      }
                    >
                      {m.quote && !m.deleted_at && <QuoteView quote={m.quote} />}
                      <MessageText m={m} />
                      <ShownComponent json={m.components_enc} />
                      {m.edited_at && !m.deleted_at && <div className="mt-1 text-[11px] opacity-70">editada pelo contato</div>}
                      {!m.deleted_at && m.attachments?.map((a) => <AttachmentView key={a.id} a={a} fromContact={m.role === "user"} />)}
                      {!m.deleted_at && m.role === "user" && <PhotoReadingView json={m.photo_reading_enc} />}
                      {/* resposta privada a um comentário (E1, parte 4): o comentário que começou a conversa */}
                      {!m.deleted_at && m.channel_ref?.kind === "comment" && <div className="mt-1 text-[11px] opacity-80">Resposta ao comentário{m.channel_ref.title ? ` “${m.channel_ref.title}”` : ""}</div>}
                      {!m.deleted_at && m.channel_ref?.permalink && /^https:\/\//i.test(m.channel_ref.permalink) ? (
                        <a href={m.channel_ref.permalink} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[11px] underline opacity-80">
                          Abrir {m.channel_ref.kind === "reel" ? "o reel" : "o post"} no Instagram
                        </a>
                      ) : !m.deleted_at && m.channel_ref?.url && /^https:\/\//i.test(m.channel_ref.url) ? (
                        // post de outra conta: a Meta só manda a imagem (a capa, no carrossel)
                        <a href={m.channel_ref.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[11px] underline opacity-80">
                          Ver a imagem {m.channel_ref.kind === "reel" ? "do reel (capa)" : m.channel_ref.kind === "story" ? "do story" : "do post (capa)"}
                        </a>
                      ) : null}
                      {m.blocked_reason && <div className="mt-1.5 text-[11px] font-semibold text-amber-ink">Não enviada: {m.blocked_reason}. O contato não recebeu esta mensagem.</div>}
                      {m.failed_at && <div className="mt-1.5 text-[11px] font-semibold text-danger">Não entregue{m.error_code ? ` (erro ${m.error_code})` : ""}: {failureReason(m.error_code, channel ?? "whatsapp")}.</div>}
                      {showSources && !showTrace && Array.isArray(m.sources) && m.sources.length > 0 && (
                        <div className="mt-1.5 text-[11px] text-muted">Fontes: {(m.sources as Array<{ title?: string; url?: string }>).map((s) => s.title ?? s.url).join(" · ")}</div>
                      )}
                      {(m.contact_reaction || m.agent_reaction) && !m.deleted_at && <ReactionsView contact={m.contact_reaction ?? null} agent={m.agent_reaction ?? null} />}
                    </div>
                    {actions && m.linkable && !m.deleted_at && (
                      <MessageActions id={m.id} snippet={snippetOf(m)} reactions={m.role === "user" ? actions.reactions : []} current={m.agent_reaction ?? null} onReact={m.role === "user" ? actions.onReact : null} align={m.role === "user" ? "start" : "end"} />
                    )}
                  </div>
                </div>
              )}
              {event && (
                <div className="self-center inline-flex items-center gap-2 rounded-full bg-panel px-3 py-1.5 text-[12.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden />
                  {event}
                </div>
              )}
            </Fragment>
          );
        })}
        {messages.length === 0 && <p className="text-sm text-muted">Sem mensagens.</p>}
      </div>
    </>
  );
}
