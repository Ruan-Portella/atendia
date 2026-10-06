import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMessages } from "@/lib/messages";
import { attachmentsOfMessages } from "@/lib/attachments";
import { activeGrant, logSupportRead } from "@/lib/support-access";
import { requestMeta } from "@/lib/audit";
import { authorLabel } from "@/lib/authors";
import { ConversationThread, type ThreadMessage } from "@/components/conversation-thread";

export const metadata = { title: "Conversa (suporte)" };

/**
 * Conversa lida pelo suporte do BoaVoz: só com a liberação da agência que vale agora; cada abertura
 * vai para a auditoria dela ("Conversa lida pelo suporte BoaVoz").
 */
export default async function SupportConversation({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const s = await requireAdmin(`/admin/clientes/${id}/conversas/${cid}`);
  const db = createAdminClient();
  const { data: conv } = await db.from("conversations").select("id, bot_id, channel, started_at, bots!inner(agency_id, name, client_name)").eq("id", cid).maybeSingle();
  const bot = (Array.isArray(conv?.bots) ? conv.bots[0] : conv?.bots) as { agency_id: string; name: string; client_name: string } | undefined;
  if (!conv || !bot || bot.agency_id !== id) notFound();
  const grant = await activeGrant(db, id);
  if (!grant) {
    return (
      <div className="card flex max-w-[640px] flex-col gap-2 p-6">
        <h1 className="text-lg font-bold">Sem liberação do suporte</h1>
        <p className="text-sm text-muted">A agência não liberou o acesso (ou a liberação acabou). Ela libera em Segurança → Acesso do suporte, por 24 horas e com motivo.</p>
        <Link href={`/admin/clientes/${id}`} className="text-sm font-semibold underline">← Voltar para a agência</Link>
      </div>
    );
  }
  await logSupportRead(db, { agencyId: id, adminEmail: s.email, conversationId: cid, grantId: grant.id, meta: await requestMeta() });
  const raw = await loadMessages(db, { conversationId: cid }, ["id", "role", "content", "author", "author_type", "author_id", "author_display_name", "announce_chars", "components_enc", "created_at", "blocked_reason", "failed_at", "error_code", "edited_at", "deleted_at", "channel_ref"] as const);
  // arquivos: abrir cada um também vai para a auditoria da agência (rota /api/files)
  const files = await attachmentsOfMessages(db, raw.map((m) => m.id));
  const messages = raw.map((m) => ({ ...m, attachments: files.get(m.id) })) as ThreadMessage[];

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <div>
        <Link href={`/admin/clientes/${id}`} className="text-xs font-semibold text-muted">← Agência</Link>
        <h1 className="text-xl font-bold">{bot.name} · {bot.client_name}</h1>
        <p className="text-xs text-muted">{conv.channel ?? "site"} · começou em {new Date(conv.started_at as string).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
        <p className="mt-2 rounded-lg bg-amber-soft px-3 py-2 text-xs text-amber-ink">Leitura registrada na auditoria da agência. Liberação até {new Date(grant.expires_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}: {grant.reason}</p>
      </div>
      <div className="card flex flex-col gap-4 p-5">
        <ConversationThread messages={messages} agentLabel={(m) => authorLabel(m, { view: "agency" })} />
      </div>
    </div>
  );
}
