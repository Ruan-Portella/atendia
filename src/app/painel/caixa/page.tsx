import { requireAgency } from "@/lib/agency";
import { can } from "@/lib/team";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isQueue, loadInbox, type InboxBot, type Queue } from "@/lib/inbox";
import { listSectors, sectorsOfMember } from "@/lib/sectors";
import { InboxView } from "@/components/inbox-view";
import { AgencyConversation } from "@/components/agency-conversation";
import { InboxContact } from "@/components/inbox-contact";
import { loadInboxContact } from "@/lib/inbox-contact";
import { requireAgencyMfa } from "@/lib/agency-mfa";
import { setMyAvailability } from "../perfil/actions";

export const metadata = { title: "Caixa de entrada" };

/**
 * Caixa de entrada da agência (Caixa de entrada, parte 3): o atendimento humano aberto de todos os
 * clientes do escopo, em filas, com a conversa ao lado. A RLS limita os chatbots ao escopo da pessoa.
 */
export default async function InboxPage({ searchParams }: PageProps<"/painel/caixa">) {
  const [sp, { member, role }] = await Promise.all([searchParams, requireAgency()]);
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: botRows } = await supabase.from("bots").select("id, name, client_name, client_id, human_handoff, sensitive_mode").eq("is_demo", false).eq("is_template", false);
  const bots = (botRows ?? []) as InboxBot[];
  const clientIds = [...new Set(bots.map((b) => b.client_id).filter((c): c is string => Boolean(c)))];
  const [sectors, mySectorIds, { data: clients }] = await Promise.all([
    listSectors(admin, clientIds),
    sectorsOfMember(admin, { type: "agency_member", id: member.id }),
    clientIds.length ? supabase.from("clients").select("id, name, holidays").in("id", clientIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string; holidays: string[] | null }> }),
  ]);
  // dono, administrador e editor veem todos os setores; o atendente, os dele (e o que não tem setor)
  const allSectors = can(role, "config");
  const holidays = new Map((clients ?? []).map((c) => [c.id as string, (c.holidays as string[] | null) ?? []]));
  const clientName = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
  const items = await loadInbox(admin, { bots, sectors, holidays, meId: member.id, mySectorIds, allSectors });
  const visibleSectors = sectors.filter((s) => allSectors || mySectorIds.includes(s.id));
  const queues = visibleSectors.map((s) => ({ key: `setor:${s.id}` as Queue, label: s.name, group: clientIds.length > 1 ? (clientName.get(s.clientId) ?? "Setores") : "Setores" }));
  const queue: Queue = isQueue(sp.fila) && (!sp.fila.startsWith("setor:") || queues.some((q) => q.key === sp.fila)) ? sp.fila : "minhas";
  const selected = typeof sp.c === "string" ? items.find((i) => i.id === sp.c) ?? null : null;
  const hrefFor = (o: { queue: Queue; conversationId?: string }) => `/painel/caixa?fila=${encodeURIComponent(o.queue)}${o.conversationId ? `&c=${o.conversationId}` : ""}`;
  const back = selected ? hrefFor({ queue, conversationId: selected.id }) : undefined;
  // modo sensível: o segundo fator vem antes da conversa e do painel do contato
  const selectedBot = selected ? bots.find((b) => b.id === selected.botId) : undefined;
  if (selectedBot?.sensitive_mode) await requireAgencyMfa(back!);
  const contact = selected?.contactId ? await loadInboxContact(admin, { contactId: selected.contactId, botIds: bots.map((b) => b.id), conversationId: selected.id }) : null;
  const botName = (botId: string) => bots.find((b) => b.id === botId)?.name;

  return (
    <div className="-mx-4 -my-5 h-[calc(100dvh-60px-var(--panel-notices-h,0px))] min-h-0 sm:-mx-6 sm:-my-7 lg:-mx-9 lg:h-[calc(100dvh-var(--panel-notices-h,0px))]">
      <InboxView items={items} queue={queue} queues={queues} meId={member.id} selectedId={selected?.id ?? null} hrefFor={hrefFor} showClient={clientIds.length > 1} available={member.available !== false} onAvailability={setMyAvailability}
        contact={selected && <InboxContact data={contact} botName={botName} conversationHref={(b, c) => `/painel/bots/${b}/conversas/${c}`} contactHref={contact && allSectors && selectedBot?.client_id ? `/painel/clientes/${selectedBot.client_id}/contatos/${contact.contact.id}` : null} />}>
        {selected && <AgencyConversation botId={selected.botId} convId={selected.id} embedded back={back} />}
      </InboxView>
    </div>
  );
}
