import { Fragment } from "react";
import { asButtons, cardName, parseComponents } from "@/lib/components";
import { parsePhotoReading, photoReadingLines } from "@/lib/photo-note";
import { failureReason } from "@/lib/send-errors";



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
    <div className="max-w-[90%] self-center rounded-lg border border-dashed border-[#e3cf9a] bg-amber-soft px-3 py-2 text-sm text-amber-ink">
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
function AttachmentView({ a }: { a: NonNullable<ThreadMessage["attachments"]>[number] }) {
  const src = `/api/files/${a.id}`;
  if (a.doc_type === "image" || a.doc_type === "sticker") {
    return (
      <a href={src} target="_blank" rel="noopener" className="mt-1.5 block">
        {/* arquivo do contato, pela rota autenticada (sem otimização de imagem) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={a.filename ?? "Imagem enviada pelo contato"} loading="lazy" className={a.doc_type === "sticker" ? "h-24 w-24 object-contain" : "max-h-72 max-w-full rounded-lg"} />
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
            <div key={i} className="flex w-[132px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-white text-[11px]">
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
      <a href={c.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block rounded-full border border-line bg-white px-2.5 py-0.5 text-[12px] font-semibold text-brand">
        {c.label} ↗
      </a>
    );
  }
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">{asButtons(c.options) ? "botões" : "lista"}</span>
      {c.options.map((o) => <span key={o.id} className="rounded-full border border-line bg-white px-2 py-0.5 text-[12px]">{o.title}</span>)}
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
}

/** O trecho da mensagem citada, em cima da resposta (Conversa mais natural). */
function QuoteView({ quote, mine }: { quote: { snippet: string; fromContact: boolean }; mine: boolean }) {
  return (
    <div className={`mb-1.5 rounded-md border-l-2 px-2 py-1 text-[12px] ${mine ? "border-ground/50 bg-ground/10" : "border-brand/50 bg-ink/5"}`}>
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

/** Conversa (visitante, assistente e atendentes) — painel, portal e área do cliente. */
export function ConversationThread({ messages, leads, agentLabel, showSources = false, contextChange = null, channel = null }: Props) {
  const changeAt = contextChange ? Date.parse(contextChange.at) : NaN;
  const firstAfter = Number.isNaN(changeAt) ? -1 : messages.findIndex((m) => m.created_at && Date.parse(m.created_at) >= changeAt);
  return (
    <>
      {leads && leads.length > 0 && (
        <div className="rounded-xl bg-brand-soft p-4 text-sm">
          <div className="font-semibold text-brand">Contato capturado</div>
          {leads.map((l, i) => {
            const asked = l.requests ? l.requests.map((r) => r.text).filter(Boolean).join("; ") : l.notes;
            return <div key={i}>{l.name} · {l.phone ?? l.email}{asked ? ` · ${asked}` : ""}</div>;
          })}
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {messages.map((m, i) => (
          <Fragment key={m.id}>
          {i === firstAfter && i > 0 && (
            <div className="my-1 flex items-center gap-2 text-[11px] font-semibold text-muted">
              <span className="h-px flex-1 bg-line" />
              {contextChange!.label}
              <span className="h-px flex-1 bg-line" />
            </div>
          )}
          {isNote(m) ? <NoteView m={m} /> : <div
            className={
              m.role === "user"
                ? "max-w-[80%] self-end rounded-[14px_14px_4px_14px] bg-ink px-3.5 py-2.5 text-sm text-ground"
                : m.role === "agent"
                  ? "max-w-[86%] self-start rounded-[14px_14px_14px_4px] border border-[#cfe3d8] bg-brand-soft px-3.5 py-2.5 text-sm"
                  : "max-w-[86%] self-start rounded-[14px_14px_14px_4px] border border-line bg-panel px-3.5 py-2.5 text-sm"
            }
          >
            {m.role === "agent" && <div className="mb-0.5 text-[11px] font-semibold text-brand">{agentLabel(m)}</div>}
            {m.quote && !m.deleted_at && <QuoteView quote={m.quote} mine={m.role === "user"} />}
            <MessageText m={m} />
            <ShownComponent json={m.components_enc} />
            {m.edited_at && !m.deleted_at && <div className="mt-1 text-[11px] opacity-70">editada pelo contato</div>}
            {!m.deleted_at && m.attachments?.map((a) => <AttachmentView key={a.id} a={a} />)}
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
            {showSources && Array.isArray(m.sources) && m.sources.length > 0 && (
              <div className="mt-1.5 text-[11px] text-muted">Fontes: {(m.sources as Array<{ title?: string; url?: string }>).map((s) => s.title ?? s.url).join(" · ")}</div>
            )}
            {(m.contact_reaction || m.agent_reaction) && !m.deleted_at && <ReactionsView contact={m.contact_reaction ?? null} agent={m.agent_reaction ?? null} />}
          </div>}
          </Fragment>
        ))}
        {messages.length === 0 && <p className="text-sm text-muted">Sem mensagens.</p>}
      </div>
    </>
  );
}
