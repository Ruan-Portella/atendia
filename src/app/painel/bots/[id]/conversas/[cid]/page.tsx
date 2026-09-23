import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/utils";
import { ConversationThread, type ThreadMessage } from "@/components/conversation-thread";
import { HandoffReply, HandoffStatus } from "@/components/handoff-controls";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ConversationStateBadge } from "@/components/conversation-state";
import { ConversationLive } from "@/components/conversation-live";
import { conversationState } from "@/lib/presence";
import { deleteConversation, releaseConversation, sendAgentMessage, takeOverConversation } from "@/app/painel/actions";

export const metadata = { title: "Conversa" };

export default async function ConversationPage({ params }: PageProps<"/painel/bots/[id]/conversas/[cid]">) {
  const { id, cid } = await params;
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, started_at, last_message_at, visitor_seen_at, channel, needs_human, handoff_requested_at, takeover_at, handled_at, bots(name, client_id, client_name)")
    .eq("id", cid)
    .eq("bot_id", id)
    .maybeSingle();
  if (!conv) notFound();
  const [{ data: messages }, { data: leads }] = await Promise.all([
    supabase.from("messages").select("id, role, content, sources, author, created_at").eq("conversation_id", cid).order("id"),
    supabase.from("leads").select("name, phone, email, notes").eq("conversation_id", cid),
  ]);
  const bot = (Array.isArray(conv.bots) ? conv.bots[0] : conv.bots) as { name: string; client_id: string | null; client_name: string } | null;
  const takeOver = takeOverConversation.bind(null, cid);
  const visitorMsgs = (messages ?? []).filter((m) => m.role === "user");

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <Link href={`/painel/bots/${id}?tab=conversas`} className="text-sm font-semibold text-muted">← Conversas{bot ? ` de ${bot.name}` : ""}</Link>
      <div>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">Conversa {relativeTime(conv.started_at)} <ConversationStateBadge conv={conv} withTime /></h1>
        <p className="text-sm text-muted">canal: {conv.channel}{conv.needs_human ? " · pediu atendente" : ""}{bot?.client_id ? <> · <Link href={`/painel/clientes/${bot.client_id}`} className="hover:underline">{bot.client_name}</Link></> : null}</p>
      </div>
      <ConversationLive live={conversationState(conv) !== "closed"} handoffOpen={!conv.handled_at && Boolean(conv.takeover_at || conv.handoff_requested_at)} visitorMessages={visitorMsgs.length} lastVisitorText={visitorMsgs.at(-1)?.content ?? ""} />
      <HandoffStatus conv={conv} onTakeOver={takeOver} />
      <ConversationThread
        messages={(messages ?? []) as ThreadMessage[]}
        leads={leads}
        showSources
        agentLabel={(author) => (!author || author === "agência" ? "Você (agência)" : `Cliente · ${author}`)}
      />
      <HandoffReply conv={conv} onTakeOver={takeOver} onSend={sendAgentMessage.bind(null, cid)} onRelease={releaseConversation.bind(null, cid)} />
      <div className="border-t border-line-2 pt-3">
        <ConfirmAction
          action={deleteConversation.bind(null, cid)}
          title="Excluir esta conversa?"
          description="As mensagens e os contatos capturados nela são apagados de vez (ex.: a pessoa pediu para apagar os dados dela). Não tem desfazer."
          confirmLabel="Excluir conversa"
          className="text-xs font-medium text-danger hover:underline"
        >
          Excluir conversa (LGPD)
        </ConfirmAction>
      </div>
    </div>
  );
}
