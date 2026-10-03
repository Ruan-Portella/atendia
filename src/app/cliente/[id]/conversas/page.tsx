import Link from "next/link";
import { requireMember } from "@/lib/member";
import { getPendingHandoffs } from "@/lib/panel";
import { relativeTime } from "@/lib/utils";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConversationStateBadge } from "@/components/conversation-state";
import { HandoffBadge } from "@/components/handoff-badge";
import { PendingHandoffs } from "@/components/pending-handoffs";

export const metadata = { title: { absolute: "Conversas" }, robots: { index: false, follow: false } };

/** Conversas do cliente; quem pode atender vê primeiro quem está esperando. */
export default async function MemberConversationsPage({ params }: PageProps<"/cliente/[id]/conversas">) {
  const { id } = await params;
  const { member, admin, botIds } = await requireMember(id);
  const ids = botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"];
  const [pending, { data: conversations }, { data: bots }] = await Promise.all([
    member.allowHandoff ? getPendingHandoffs(admin, botIds) : Promise.resolve([]),
    admin.from("conversations").select("id, bot_id, started_at, last_message_at, visitor_seen_at, message_count, handoff_requested_at, takeover_at, handled_at, handoff_urgent_at, last_contact_at, last_reply_at").in("bot_id", ids).order("last_message_at", { ascending: false }).limit(50),
    admin.from("bots").select("id, name").in("id", ids),
  ]);
  const botName = new Map((bots ?? []).map((b) => [b.id, b.name]));
  return (
    <>
      {member.allowHandoff && <AutoRefresh ms={15000} />}
      <div>
        <h1 className="text-2xl font-bold">{member.allowHandoff ? "Atendimento" : "Conversas"}</h1>
        <p className="text-sm text-muted">
          {member.allowHandoff
            ? "Quando um visitante pede para falar com alguém, ele aparece aqui. Abra a conversa, assuma e responda: o visitante vê no chat do site em segundos."
            : "As últimas conversas do assistente com os visitantes do seu site."}
        </p>
      </div>
      <PendingHandoffs items={pending} showClient={false} hrefFor={(h) => `/cliente/${id}/conversas/${h.id}`} />
      <div className="card overflow-hidden">
        {(conversations ?? []).length === 0 && <p className="p-5 text-sm text-muted">Nenhuma conversa ainda.</p>}
        {(conversations ?? []).map((c) => (
          <Link key={c.id} href={`/cliente/${id}/conversas/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-4 py-3 text-sm last:border-0 hover:bg-ground">
            <span className="text-muted">{relativeTime(c.last_message_at)}</span>
            {(bots ?? []).length > 1 && <span className="font-medium">{botName.get(c.bot_id)}</span>}
            <span>{c.message_count} mensagens</span>
            <ConversationStateBadge conv={c} />
            <HandoffBadge conv={c} className="ml-auto" />
          </Link>
        ))}
      </div>
    </>
  );
}
