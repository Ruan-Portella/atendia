export interface ThreadMessage {
  id: number;
  role: string;
  content: string;
  author?: string | null;
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
}

interface Props {
  messages: ThreadMessage[];
  leads?: Array<{ name: string | null; phone: string | null; email: string | null; notes: string | null }> | null;
  /** Nome mostrado nas mensagens de atendente (ex.: "Você", "Agência", "joana@clinica.com"). */
  agentLabel: (author: string | null) => string;
  showSources?: boolean;
}

/** Conversa (visitante, assistente e atendentes) — painel, portal e área do cliente. */
export function ConversationThread({ messages, leads, agentLabel, showSources = false }: Props) {
  return (
    <>
      {leads && leads.length > 0 && (
        <div className="rounded-xl bg-brand-soft p-4 text-sm">
          <div className="font-semibold text-brand">Contato capturado</div>
          {leads.map((l, i) => <div key={i}>{l.name} · {l.phone ?? l.email}{l.notes ? ` · ${l.notes}` : ""}</div>)}
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "max-w-[80%] self-end rounded-[14px_14px_4px_14px] bg-ink px-3.5 py-2.5 text-sm text-ground"
                : m.role === "agent"
                  ? "max-w-[86%] self-start rounded-[14px_14px_14px_4px] border border-[#cfe3d8] bg-brand-soft px-3.5 py-2.5 text-sm"
                  : "max-w-[86%] self-start rounded-[14px_14px_14px_4px] border border-line bg-panel px-3.5 py-2.5 text-sm"
            }
          >
            {m.role === "agent" && <div className="mb-0.5 text-[11px] font-semibold text-brand">{agentLabel(m.author ?? null)}</div>}
            <div className={m.deleted_at ? "whitespace-pre-wrap italic opacity-70" : "whitespace-pre-wrap"}>{m.content}</div>
            {m.edited_at && !m.deleted_at && <div className="mt-1 text-[11px] opacity-70">editada pelo contato</div>}
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
        ))}
        {messages.length === 0 && <p className="text-sm text-muted">Sem mensagens.</p>}
      </div>
    </>
  );
}
