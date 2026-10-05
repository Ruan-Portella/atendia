import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember, requireMemberMfa } from "@/lib/member";
import { ConversationThread, type ThreadMessage } from "@/components/conversation-thread";
import { HandoffReply, HandoffStatus } from "@/components/handoff-controls";
import { ConversationStateBadge } from "@/components/conversation-state";
import { ConversationLive } from "@/components/conversation-live";
import { MessageScroller } from "@/components/message-scroller";
import { conversationState } from "@/lib/presence";
import { loadMessages } from "@/lib/messages";
import { leadsOfConversation } from "@/lib/leads";
import { attachmentsOfMessages } from "@/lib/attachments";
import { regulatedConversation } from "@/lib/gate/payment";
import { RegulatedNotice } from "@/components/regulated-notice";
import { lastContactMessageAt } from "@/lib/whatsapp-inbound";
import { authorLabel } from "@/lib/authors";
import { memberForceTakeOver, memberRelease, memberSend, memberTakeOver } from "../../../actions";

export const metadata = { title: { absolute: "Conversa" }, robots: { index: false, follow: false } };

export default async function MemberConversationPage({ params }: PageProps<"/cliente/[id]/conversas/[cid]">) {
  const { id, cid } = await params;
  const { email, member, admin, botIds } = await requireMember(id);
  const { data: conv } = await admin
    .from("conversations")
    .select("id, bot_id, started_at, last_message_at, visitor_seen_at, channel, wa_id, ig_id, contact_id, handoff_requested_at, takeover_at, handled_at, assigned_to_id, assigned_to_name, regulated_at, bots(sensitive_mode)")
    .eq("id", cid)
    .in("bot_id", botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"])
    .maybeSingle();
  if (!conv) notFound();
  // chatbot em modo dados sensíveis: a conversa pede o segundo fator, como no painel (leva B1')
  const sensitive = Boolean((Array.isArray(conv.bots) ? conv.bots[0] : conv.bots)?.sensitive_mode);
  if (sensitive) await requireMemberMfa(id, `/cliente/${id}/conversas/${cid}`);
  const [messages, leads] = await Promise.all([
    loadMessages(admin, { conversationId: cid }, ["id", "role", "content", "author", "author_type", "author_id", "author_display_name", "announce_chars", "created_at", "blocked_reason", "failed_at", "error_code", "edited_at", "deleted_at", "channel_ref"] as const),
    leadsOfConversation(admin, cid),
  ]);
  const agencyName = member.agency.name;
  const takeOver = memberTakeOver.bind(null, id, cid);
  // arquivos que o contato mandou (abertos pela rota /api/files)
  const files = await attachmentsOfMessages(admin, (messages ?? []).map((m) => m.id));
  const allMessages = (messages ?? []).map((m) => ({ ...m, attachments: files.get(m.id) })) as ThreadMessage[];
  const visitorMsgs = (messages ?? []).filter((m) => m.role === "user");
  const handoffOpen = member.allowHandoff && !conv.handled_at && Boolean(conv.takeover_at || conv.handoff_requested_at);
  // no WhatsApp a janela de 24 h conta da última mensagem do contato, em qualquer conversa com ele
  const contact = conv.channel === "whatsapp" && conv.wa_id ? { waId: conv.wa_id } : conv.channel === "instagram" && conv.ig_id ? { igsid: conv.ig_id } : null;
  const handoffConv = contact ? { ...conv, last_user_at: await lastContactMessageAt(admin, conv.bot_id, contact, conv.contact_id) } : conv;
  // conversa com bebida ou remédio (portão): faixa de aviso e pergunta antes de instrução de pagamento
  const regulated = Boolean(contact) && regulatedConversation(conv.regulated_at as string | null);
  const coexistence = regulated && conv.channel === "whatsapp" ? Boolean((await admin.from("whatsapp_channels").select("coexistence").eq("bot_id", conv.bot_id).maybeSingle()).data?.coexistence) : false;

  // Tela de chat: preenche o espaço abaixo das abas (a casca do portal rola só o conteúdo);
  // cabeçalho e resposta fixos, e só as mensagens rolam.
  return (
    <div className="-my-6 flex min-h-0 flex-1 flex-col sm:-my-8">
      <header className="border-b border-line py-3">
        <Link href={`/cliente/${id}/conversas`} className="text-xs font-semibold text-muted">← Conversas</Link>
        <h1 className="flex flex-wrap items-center gap-2.5 text-lg font-bold sm:text-xl">Conversa <ConversationStateBadge conv={conv} withTime /></h1>
        <p className="text-xs text-muted">{new Date(conv.started_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" })}{conv.channel === "whatsapp" ? " · WhatsApp" : conv.channel === "instagram" ? " · Instagram" : ""}</p>
      </header>

      <ConversationLive live={conversationState(conv) !== "closed"} handoffOpen={handoffOpen} visitorMessages={visitorMsgs.length} lastVisitorText={visitorMsgs.at(-1)?.content ?? ""} />

      <MessageScroller count={allMessages.length} className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-4 py-5">
          <ConversationThread
            messages={allMessages}
            leads={leads}
            agentLabel={(m) => authorLabel(m, { view: "client", meId: member.memberId, meLegacy: email, agencyName })}
          />
        </div>
      </MessageScroller>

      {member.allowHandoff && (
        <footer className="flex flex-col gap-2 border-t border-line py-3">
          {regulated && <RegulatedNotice channel={conv.channel as string} coexistence={coexistence} />}
          <HandoffStatus conv={handoffConv} onTakeOver={takeOver} meId={member.memberId} />
          <HandoffReply conv={handoffConv} meId={member.memberId} onTakeOver={takeOver} onForceTakeOver={memberForceTakeOver.bind(null, id, cid)} onSend={memberSend.bind(null, id, cid)} onRelease={memberRelease.bind(null, id, cid)} docked paymentCheck={regulated} />
        </footer>
      )}
    </div>
  );
}
