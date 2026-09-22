import Link from "next/link";
import { requireMember } from "@/lib/member";
import { getPendingHandoffs } from "@/lib/panel";
import { relativeTime } from "@/lib/utils";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata = { title: { absolute: "Conversas" }, robots: { index: false, follow: false } };

/** Conversas do cliente; quem pode atender vê primeiro quem está esperando. */
export default async function MemberConversationsPage({ params }: PageProps<"/cliente/[id]/conversas">) {
  const { id } = await params;
  const { member, admin, botIds } = await requireMember(id);
  const ids = botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"];
  const [pending, { data: conversations }, { data: bots }] = await Promise.all([
    member.allowHandoff ? getPendingHandoffs(admin, botIds) : Promise.resolve([]),
    admin.from("conversations").select("id, bot_id, started_at, last_message_at, message_count, handoff_requested_at, handled_at").in("bot_id", ids).order("last_message_at", { ascending: false }).limit(50),
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
      {pending.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-[#efd9a9] bg-amber-soft px-4 py-3">
          <div className="text-sm font-semibold text-amber-ink">{pending.length === 1 ? "1 visitante quer falar com alguém" : `${pending.length} visitantes querem falar com alguém`}</div>
          {pending.map((h) => (
            <Link key={h.id} href={`/cliente/${id}/conversas/${h.id}`} className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-sm hover:bg-white/60">
              <span className="font-medium">{h.bots?.name}</span>
              <span className="text-xs text-muted">pediu {relativeTime(h.handoff_requested_at)}</span>
              <span className="ml-auto text-xs font-semibold text-amber-ink">{h.takeover_at ? "em atendimento" : "responder →"}</span>
            </Link>
          ))}
        </div>
      )}
      <div className="card overflow-hidden">
        {(conversations ?? []).length === 0 && <p className="p-5 text-sm text-muted">Nenhuma conversa ainda.</p>}
        {(conversations ?? []).map((c) => (
          <Link key={c.id} href={`/cliente/${id}/conversas/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-4 py-3 text-sm last:border-0 hover:bg-ground">
            <span className="text-muted">{relativeTime(c.last_message_at)}</span>
            {(bots ?? []).length > 1 && <span className="font-medium">{botName.get(c.bot_id)}</span>}
            <span>{c.message_count} mensagens</span>
            {c.handoff_requested_at && !c.handled_at && <span className="ml-auto rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber-ink">esperando atendente</span>}
          </Link>
        ))}
      </div>
    </>
  );
}
