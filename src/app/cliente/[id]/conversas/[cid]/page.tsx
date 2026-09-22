import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/member";
import { ConversationThread, type ThreadMessage } from "@/components/conversation-thread";
import { HandoffReply, HandoffStatus } from "@/components/handoff-controls";
import { memberRelease, memberSend, memberTakeOver } from "../../../actions";

export const metadata = { title: { absolute: "Conversa" }, robots: { index: false, follow: false } };

export default async function MemberConversationPage({ params }: PageProps<"/cliente/[id]/conversas/[cid]">) {
  const { id, cid } = await params;
  const { email, member, admin, botIds } = await requireMember(id);
  const { data: conv } = await admin
    .from("conversations")
    .select("id, bot_id, started_at, last_message_at, handoff_requested_at, takeover_at, handled_at")
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

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <Link href={`/cliente/${id}/conversas`} className="text-sm font-semibold text-muted">← Conversas</Link>
      <div>
        <h1 className="text-2xl font-bold">Conversa</h1>
        <p className="text-sm text-muted">{new Date(conv.started_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" })}</p>
      </div>
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
