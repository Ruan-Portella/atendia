import Link from "next/link";
import { notFound } from "next/navigation";
import { getPortalClient } from "@/lib/portal";
import { belongsToHost } from "@/lib/domain-server";
import { ConversationThread, type ThreadMessage } from "@/components/conversation-thread";

export const metadata = { title: { absolute: "Conversa" }, robots: { index: false, follow: false } };

/** Conversa completa, vista pelo cliente final (somente leitura). */
export default async function PortalConversationPage({ params }: PageProps<"/c/[token]/conversas/[cid]">) {
  const { token, cid } = await params;
  const portal = await getPortalClient(token);
  if (!portal || !(await belongsToHost(portal.client.agency_id))) notFound();
  const { db, client } = portal;

  // a conversa precisa ser de um chatbot deste cliente
  const { data: conv } = await db.from("conversations").select("id, started_at, bot_id, bots!inner(name, client_id)").eq("id", cid).eq("bots.client_id", client.id).maybeSingle();
  if (!conv) notFound();
  const [{ data: messages }, { data: leads }] = await Promise.all([
    db.from("messages").select("id, role, content, created_at").eq("conversation_id", cid).order("id"),
    db.from("leads").select("name, phone, email, notes").eq("conversation_id", cid),
  ]);
  const bot = (Array.isArray(conv.bots) ? conv.bots[0] : conv.bots) as { name: string } | null;

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-4 px-4 py-6 sm:px-6">
      <Link href={`/c/${token}`} className="text-sm font-semibold text-muted">← Relatório</Link>
      <div>
        <h1 className="text-2xl font-bold">Conversa com {bot?.name ?? "o assistente"}</h1>
        <p className="text-sm text-muted">{new Date(conv.started_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" })}</p>
      </div>
      <ConversationThread messages={(messages ?? []) as ThreadMessage[]} leads={leads} agentLabel={() => "Equipe"} />
    </div>
  );
}
