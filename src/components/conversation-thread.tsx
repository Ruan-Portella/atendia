export interface ThreadMessage {
  id: number;
  role: string;
  content: string;
  author?: string | null;
  sources?: unknown;
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
            <div className="whitespace-pre-wrap">{m.content}</div>
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
