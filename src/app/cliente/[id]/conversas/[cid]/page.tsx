import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/member";
import { ConversationThread, type ThreadMessage } from "@/components/conversation-thread";
import { HandoffReply, HandoffStatus } from "@/components/handoff-controls";
import { ConversationStateBadge } from "@/components/conversation-state";
import { ConversationLive } from "@/components/conversation-live";
import { conversationState } from "@/lib/presence";
import { memberRelease, memberSend, memberTakeOver } from "../../../actions";

export const metadata = { title: { absolute: "Conversa" }, robots: { index: false, follow: false } };

export default async function MemberConversationPage({ params }: PageProps<"/cliente/[id]/conversas/[cid]">) {
  const { id, cid } = await params;
  const { email, member, admin, botIds } = await requireMember(id);
  const { data: conv } = await admin
    .from("conversations")
    .select("id, bot_id, started_at, last_message_at, visitor_seen_at, handoff_requested_at, takeover_at, handled_at")
    .eq("id", cid)
    .in("bot_id", botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"])
    .maybeSingle();
  if (!conv) notFound();
  const [{ data: messages }, { data: leads }] = await Promise.all([
    admin.from("messages").select("id, role, content, author").eq("conversation_id", cid).order("id"),
    admin.from("leads").select("name, phone, email, notes").eq("conversation_id", cid),
  ]);
  const agencyName = member.agency.name;
  const takeOver = memberTakeOver.bind(null, id, cid);
  const visitorMsgs = (messages ?? []).filter((m) => m.role === "user");
  const handoffOpen = member.allowHandoff && !conv.handled_at && Boolean(conv.takeover_at || conv.handoff_requested_at);

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <Link href={`/cliente/${id}/conversas`} className="text-sm font-semibold text-muted">← Conversas</Link>
      <div>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">Conversa <ConversationStateBadge conv={conv} withTime /></h1>
        <p className="text-sm text-muted">{new Date(conv.started_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" })}</p>
      </div>
      <ConversationLive live={conversationState(conv) !== "closed"} handoffOpen={handoffOpen} visitorMessages={visitorMsgs.length} lastVisitorText={visitorMsgs.at(-1)?.content ?? ""} />
      {member.allowHandoff && <HandoffStatus conv={conv} onTakeOver={takeOver} />}
      <ConversationThread
        messages={(messages ?? []) as ThreadMessage[]}
        leads={leads}
        agentLabel={(author) => (author === email ? "Você" : !author || author === "agência" ? agencyName : author)}
      />
      {member.allowHandoff && <HandoffReply conv={conv} onTakeOver={takeOver} onSend={memberSend.bind(null, id, cid)} onRelease={memberRelease.bind(null, id, cid)} />}
    </div>
  );
}
