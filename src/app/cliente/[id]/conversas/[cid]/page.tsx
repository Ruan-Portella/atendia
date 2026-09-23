import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/member";
import { ConversationThread, type ThreadMessage } from "@/components/conversation-thread";
import { HandoffReply, HandoffStatus } from "@/components/handoff-controls";
import { ConversationStateBadge } from "@/components/conversation-state";
import { ConversationLive } from "@/components/conversation-live";
import { MessageScroller } from "@/components/message-scroller";
import { conversationState } from "@/lib/presence";
import { lastContactMessageAt } from "@/lib/whatsapp-inbound";
import { memberRelease, memberSend, memberTakeOver } from "../../../actions";

export const metadata = { title: { absolute: "Conversa" }, robots: { index: false, follow: false } };

export default async function MemberConversationPage({ params }: PageProps<"/cliente/[id]/conversas/[cid]">) {
  const { id, cid } = await params;
  const { email, member, admin, botIds } = await requireMember(id);
  const { data: conv } = await admin
    .from("conversations")
    .select("id, bot_id, started_at, last_message_at, visitor_seen_at, channel, wa_id, handoff_requested_at, takeover_at, handled_at")
    .eq("id", cid)
    .in("bot_id", botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"])
    .maybeSingle();
  if (!conv) notFound();
  const [{ data: messages }, { data: leads }] = await Promise.all([
    admin.from("messages").select("id, role, content, author, created_at").eq("conversation_id", cid).order("id"),
    admin.from("leads").select("name, phone, email, notes").eq("conversation_id", cid),
  ]);
  const agencyName = member.agency.name;
  const takeOver = memberTakeOver.bind(null, id, cid);
  const allMessages = (messages ?? []) as ThreadMessage[];
  const visitorMsgs = (messages ?? []).filter((m) => m.role === "user");
  const handoffOpen = member.allowHandoff && !conv.handled_at && Boolean(conv.takeover_at || conv.handoff_requested_at);
  // no WhatsApp a janela de 24 h conta da última mensagem do contato, em qualquer conversa com ele
  const handoffConv = conv.channel === "whatsapp" && conv.wa_id ? { ...conv, last_user_at: await lastContactMessageAt(admin, conv.bot_id, conv.wa_id) } : conv;

  // Tela de chat: preenche o espaço abaixo das abas (a casca do portal rola só o conteúdo);
  // cabeçalho e resposta fixos, e só as mensagens rolam.
  return (
    <div className="-my-6 flex min-h-0 flex-1 flex-col sm:-my-8">
      <header className="border-b border-line py-3">
        <Link href={`/cliente/${id}/conversas`} className="text-xs font-semibold text-muted">← Conversas</Link>
        <h1 className="flex flex-wrap items-center gap-2.5 text-lg font-bold sm:text-xl">Conversa <ConversationStateBadge conv={conv} withTime /></h1>
        <p className="text-xs text-muted">{new Date(conv.started_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" })}{conv.channel === "whatsapp" ? " · WhatsApp" : ""}</p>
      </header>

      <ConversationLive live={conversationState(conv) !== "closed"} handoffOpen={handoffOpen} visitorMessages={visitorMsgs.length} lastVisitorText={visitorMsgs.at(-1)?.content ?? ""} />

      <MessageScroller count={allMessages.length} className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-4 py-5">
          {member.allowHandoff && <HandoffStatus conv={handoffConv} onTakeOver={takeOver} />}
          <ConversationThread
            messages={allMessages}
            leads={leads}
            agentLabel={(author) => (author === email ? "Você" : !author || author === "agência" ? agencyName : author)}
          />
        </div>
      </MessageScroller>

      {member.allowHandoff && (
        <footer className="border-t border-line py-3">
          <HandoffReply conv={handoffConv} onTakeOver={takeOver} onSend={memberSend.bind(null, id, cid)} onRelease={memberRelease.bind(null, id, cid)} docked />
        </footer>
      )}
    </div>
  );
}
