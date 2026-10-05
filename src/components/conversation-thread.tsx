import { Fragment } from "react";

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
  channel_ref?: { kind?: string; url?: string | null; permalink?: string | null } | null;
  created_at?: string;
  /** Arquivos que o contato mandou (guardados cifrados; abertos pela rota /api/files). */
  attachments?: Array<{ id: string; mime: string; size: number; doc_type: string; filename: string | null }>;
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

interface Props {
  messages: ThreadMessage[];
  leads?: Array<{ name: string | null; phone: string | null; email: string | null; notes: string | null }> | null;
  /** Nome mostrado nas mensagens de atendente (ex.: "Viviane (você)", "Pelo celular", "Cliente · Joana"). */
  agentLabel: (m: ThreadMessage) => string;
  showSources?: boolean;
  /** Troca de contexto (pareamento, P2): separador antes da primeira mensagem do trecho novo. */
  contextChange?: { at: string; label: string } | null;
}

/** Conversa (visitante, assistente e atendentes) — painel, portal e área do cliente. */
export function ConversationThread({ messages, leads, agentLabel, showSources = false, contextChange = null }: Props) {
  const changeAt = contextChange ? Date.parse(contextChange.at) : NaN;
  const firstAfter = Number.isNaN(changeAt) ? -1 : messages.findIndex((m) => m.created_at && Date.parse(m.created_at) >= changeAt);
  return (
    <>
      {leads && leads.length > 0 && (
        <div className="rounded-xl bg-brand-soft p-4 text-sm">
          <div className="font-semibold text-brand">Contato capturado</div>
          {leads.map((l, i) => <div key={i}>{l.name} · {l.phone ?? l.email}{l.notes ? ` · ${l.notes}` : ""}</div>)}
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
          <div
            className={
              m.role === "user"
                ? "max-w-[80%] self-end rounded-[14px_14px_4px_14px] bg-ink px-3.5 py-2.5 text-sm text-ground"
                : m.role === "agent"
                  ? "max-w-[86%] self-start rounded-[14px_14px_14px_4px] border border-[#cfe3d8] bg-brand-soft px-3.5 py-2.5 text-sm"
                  : "max-w-[86%] self-start rounded-[14px_14px_14px_4px] border border-line bg-panel px-3.5 py-2.5 text-sm"
            }
          >
            {m.role === "agent" && <div className="mb-0.5 text-[11px] font-semibold text-brand">{agentLabel(m)}</div>}
            <MessageText m={m} />
            {m.edited_at && !m.deleted_at && <div className="mt-1 text-[11px] opacity-70">editada pelo contato</div>}
            {!m.deleted_at && m.attachments?.map((a) => <AttachmentView key={a.id} a={a} />)}
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
            {m.failed_at && <div className="mt-1.5 text-[11px] font-semibold text-danger">Não entregue{m.error_code ? ` (erro ${m.error_code})` : ""}: o canal recusou e o contato não recebeu.</div>}
            {showSources && Array.isArray(m.sources) && m.sources.length > 0 && (
              <div className="mt-1.5 text-[11px] text-muted">Fontes: {(m.sources as Array<{ title?: string; url?: string }>).map((s) => s.title ?? s.url).join(" · ")}</div>
            )}
          </div>
          </Fragment>
        ))}
        {messages.length === 0 && <p className="text-sm text-muted">Sem mensagens.</p>}
      </div>
    </>
  );
}
