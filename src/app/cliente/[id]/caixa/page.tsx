import { notFound } from "next/navigation";
import { requireMember, requireMemberMfa, memberCan } from "@/lib/member";
import { isQueue, loadInbox, type InboxBot, type Queue } from "@/lib/inbox";
import { clientHolidays, listSectors, sectorsOfMember } from "@/lib/sectors";
import { InboxView } from "@/components/inbox-view";
import { ClientConversation } from "@/components/client-conversation";
import { InboxContact } from "@/components/inbox-contact";
import { loadInboxContact } from "@/lib/inbox-contact";
import { memberSetAvailability } from "@/app/cliente/actions";

export const metadata = { title: { absolute: "Caixa de entrada" }, robots: { index: false, follow: false } };

/**
 * Caixa de entrada da área do cliente (Caixa de entrada, parte 3): o atendimento aberto dos
 * chatbots do cliente, em filas. O gestor vê todos os setores; o atendente, os dele (e o que não tem setor).
 */
export default async function MemberInboxPage({ params, searchParams }: PageProps<"/cliente/[id]/caixa">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { member, admin, botIds } = await requireMember(id);
  if (!member.allowHandoff) notFound();
  const { data: botRows } = botIds.length ? await admin.from("bots").select("id, name, client_name, client_id, human_handoff, sensitive_mode").in("id", botIds) : { data: [] };
  const bots = (botRows ?? []) as InboxBot[];
  const [sectors, mySectorIds, holidays] = await Promise.all([listSectors(admin, [id]), sectorsOfMember(admin, { type: "client_member", id: member.memberId }), clientHolidays(admin, id)]);
  const allSectors = memberCan(member, "manager");
  const items = await loadInbox(admin, { bots, sectors, holidays: new Map([[id, holidays]]), meId: member.memberId, mySectorIds, allSectors });
  const queues = sectors.filter((s) => allSectors || mySectorIds.includes(s.id)).map((s) => ({ key: `setor:${s.id}` as Queue, label: s.name, group: "Setores" }));
  const queue: Queue = isQueue(sp.fila) && (!sp.fila.startsWith("setor:") || queues.some((q) => q.key === sp.fila)) ? sp.fila : "minhas";
  const selected = typeof sp.c === "string" ? items.find((i) => i.id === sp.c) ?? null : null;
  const hrefFor = (o: { queue: Queue; conversationId?: string }) => `/cliente/${id}/caixa?fila=${encodeURIComponent(o.queue)}${o.conversationId ? `&c=${o.conversationId}` : ""}`;
  const back = selected ? hrefFor({ queue, conversationId: selected.id }) : undefined;
  // modo sensível: o segundo fator vem antes da conversa e do painel do contato
  if (selected && bots.find((b) => b.id === selected.botId)?.sensitive_mode) await requireMemberMfa(id, back!);
  const contact = selected?.contactId ? await loadInboxContact(admin, { contactId: selected.contactId, botIds: bots.map((b) => b.id), conversationId: selected.id }) : null;
  const botName = (botId: string) => bots.find((b) => b.id === botId)?.name;

  return (
    <div className="-mx-4 -my-6 flex min-h-0 flex-1 flex-col sm:-mx-6 sm:-my-8">
      <InboxView compact items={items} queue={queue} queues={queues} meId={member.memberId} selectedId={selected?.id ?? null} hrefFor={hrefFor} showClient={false} available={member.available} onAvailability={memberSetAvailability.bind(null, id)}
        contact={selected && <InboxContact data={contact} botName={botName} conversationHref={(_b, c) => `/cliente/${id}/conversas/${c}`} />}>
        {selected && <ClientConversation clientId={id} convId={selected.id} embedded back={back} />}
      </InboxView>
    </div>
  );
}
