import Link from "next/link";
import { Fragment } from "react";
import { History } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMessages } from "@/lib/messages";
import { attachmentsOfMessages } from "@/lib/attachments";
import { quotesOf } from "@/lib/message-links";
import { listNotes } from "@/lib/conversation-notes";
import { relativeTime } from "@/lib/utils";
import { ConversationThread, withNotes, type ThreadMessage } from "@/components/conversation-thread";

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site", painel: "Teste", demo: "Demo" };
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

const COLUMNS = ["id", "role", "content", "sources", "tool_results", "author", "author_type", "author_id", "author_display_name", "announce_chars", "components_enc", "photo_reading_enc", "created_at", "blocked_reason", "failed_at", "error_code", "edited_at", "deleted_at", "channel_ref", "reply_to_id", "contact_reaction", "agent_reaction"] as const;

/** A linha que separa uma conversa da outra no histórico da pessoa. */
function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-2 flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">
      <span className="h-px flex-1 bg-line" />
      <span className="text-center">{children}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/**
 * As conversas anteriores da mesma pessoa em cima da conversa aberta (redesenho, etapa 2): o
 * histórico vira uma conversa só, como no WhatsApp. Carrega só quando pedem ("Ver a conversa
 * anterior", uma por vez, pelo `?ant=`), para a Caixa, que se atualiza sozinha, não pesar.
 * Só leitura: citar, reagir e responder ficam na conversa aberta.
 */
export async function EarlierConversations({
  db,
  admin,
  contactId,
  botIds,
  current,
  show,
  moreHref,
  agentLabel,
  contactName,
  bot,
  showTrace = false,
  withNotes: notesToo = true,
}: {
  /** quem lê as conversas e mensagens (o cliente da pessoa no painel; a service role na área do cliente) */
  db: SupabaseClient;
  /** arquivos e notas (tabelas internas) */
  admin: SupabaseClient;
  contactId: string | null;
  /** os chatbots que a pessoa pode ver (a área do cliente filtra por eles) */
  botIds?: string[];
  current: { id: string; startedAt: string };
  /** quantas anteriores mostrar (0: só o botão) */
  show: number;
  moreHref: (n: number) => string;
  agentLabel: (m: ThreadMessage) => string;
  contactName: string | null;
  bot: { name: string; color?: string | null } | null;
  showTrace?: boolean;
  withNotes?: boolean;
}) {
  if (!contactId) return null;
  let q = db.from("conversations").select("id, channel, started_at, message_count").eq("contact_id", contactId).neq("id", current.id).lt("started_at", current.startedAt);
  if (botIds) q = q.in("bot_id", botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q.order("started_at", { ascending: false }).limit(50);
  const earlier = (data ?? []) as Array<{ id: string; channel: string | null; started_at: string; message_count: number | null }>;
  if (!earlier.length) return null;
  const n = Math.min(Math.max(0, show), earlier.length);
  const shown = earlier.slice(0, n).reverse();
  const next = earlier[n];
  const threads = await Promise.all(
    shown.map(async (c) => {
      const messages = await loadMessages(db, { conversationId: c.id }, COLUMNS);
      const [files, quotes, notes] = await Promise.all([
        attachmentsOfMessages(admin, messages.map((m) => m.id)),
        quotesOf(db, messages.map((m) => m.reply_to_id)),
        notesToo ? listNotes(admin, c.id).catch(() => []) : Promise.resolve([]),
      ]);
      return withNotes(messages.map((m) => ({ ...m, attachments: files.get(m.id), quote: m.reply_to_id ? (quotes.get(m.reply_to_id) ?? null) : null })) as ThreadMessage[], notes);
    }),
  );
  return (
    <div className="flex flex-col gap-3">
      {next && (
        <Link href={moreHref(n + 1)} scroll={false} className="inline-flex items-center gap-2 self-center rounded-full bg-panel px-3.5 py-1.5 text-[12.5px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors duration-[120ms] hover:bg-raised hover:text-ink">
          <History size={14} className="text-brand" />
          Ver a conversa anterior
          <span className="font-mono text-[11px] text-muted">{when(next.started_at)} · {next.message_count ?? 0} msgs{earlier.length - n > 1 ? ` · +${earlier.length - n - 1}` : ""}</span>
        </Link>
      )}
      {shown.map((c, k) => (
        <Fragment key={c.id}>
          <Divider>Conversa de {when(c.started_at)} · {CHANNEL[c.channel ?? "widget"] ?? c.channel}</Divider>
          <ConversationThread messages={threads[k]} agentLabel={agentLabel} channel={c.channel} contactName={contactName} bot={bot} showTrace={showTrace} openTrace={false} firstDay={false} />
        </Fragment>
      ))}
      {n > 0 && <Divider>Esta conversa · começou {relativeTime(current.startedAt)}</Divider>}
    </div>
  );
}
