import { requireAgency } from "@/lib/agency";
import { can } from "@/lib/team";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isQueue, loadInbox, seeAllSectorsIn, visibleSectors, type InboxBot, type Queue } from "@/lib/inbox";
import { listSectors, sectorsOfMember } from "@/lib/sectors";
import { InboxView } from "@/components/inbox-view";
import { AgencyConversation } from "@/components/agency-conversation";
import { InboxContact } from "@/components/inbox-contact";
import { loadInboxContact } from "@/lib/inbox-contact";
import { requireAgencyMfa } from "@/lib/agency-mfa";
import { setMyAvailability } from "../perfil/actions";
import { cookies } from "next/headers";
import { CONTACT_COOKIE, QUEUES_COOKIE } from "@/lib/theme";
import { withFrom } from "@/lib/back-link";
import { listNotes } from "@/lib/conversation-notes";
import { addConversationNote } from "@/app/painel/actions";

export const metadata = { title: "Caixa de entrada" };

/**
 * Caixa de entrada da agência (Caixa de entrada, parte 3): o atendimento humano aberto de todos os
 * clientes do escopo, em filas, com a conversa ao lado. A RLS limita os chatbots ao escopo da pessoa.
 */
export default async function InboxPage({ searchParams }: PageProps<"/painel/caixa">) {
  const [sp, { member, role }] = await Promise.all([searchParams, requireAgency()]);
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: botRows } = await supabase.from("bots").select("id, name, client_name, client_id, human_handoff, sensitive_mode, appearance, face").eq("is_demo", false).eq("is_template", false);
  const bots = (botRows ?? []) as InboxBot[];
  const clientIds = [...new Set(bots.map((b) => b.client_id).filter((c): c is string => Boolean(c)))];
  const [sectors, mySectorIds, { data: clients }] = await Promise.all([
    listSectors(admin, clientIds),
    sectorsOfMember(admin, { type: "agency_member", id: member.id }),
    clientIds.length ? supabase.from("clients").select("id, name, holidays, managers_see_all_sectors").in("id", clientIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string; holidays: string[] | null; managers_see_all_sectors: boolean }> }),
  ]);
  // cada um vê os setores dele (e o que não tem setor); dono, administrador e editor veem todos só
  // nos clientes com a opção ligada na aba Setores
  const canConfig = can(role, "config");
  const seeAllSectors = seeAllSectorsIn(canConfig, (clients ?? []) as Array<{ id: string; managers_see_all_sectors: boolean }>);
  const holidays = new Map((clients ?? []).map((c) => [c.id as string, (c.holidays as string[] | null) ?? []]));
  const clientName = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
  const items = await loadInbox(admin, { bots, sectors, holidays, meId: member.id, mySectorIds, seeAllSectors });
  const queues = visibleSectors(sectors, { mySectorIds, seeAllSectors }).map((s) => ({ key: `setor:${s.id}` as Queue, label: s.name, group: clientIds.length > 1 ? (clientName.get(s.clientId) ?? "Setores") : "Setores" }));
  const queue: Queue = isQueue(sp.fila) && (!sp.fila.startsWith("setor:") || queues.some((q) => q.key === sp.fila)) ? sp.fila : "minhas";
  // a conversa aberta: uma da fila, ou outra da mesma pessoa aberta pelo painel do contato (fechada,
  // fora das filas; o chatbot precisa estar no escopo)
  const listed = typeof sp.c === "string" ? items.find((i) => i.id === sp.c) ?? null : null;
  const other = !listed && typeof sp.c === "string" && /^[0-9a-f-]{36}$/i.test(sp.c) && bots.length
    ? (await supabase.from("conversations").select("id, bot_id, contact_id").eq("id", sp.c).in("bot_id", bots.map((b) => b.id)).maybeSingle()).data
    : null;
  const selected: { id: string; botId: string; contactId: string | null } | null = listed ?? (other ? { id: other.id as string, botId: other.bot_id as string, contactId: (other.contact_id as string | null) ?? null } : null);
  const hrefFor = (o: { queue: Queue; conversationId?: string }) => `/painel/caixa?fila=${encodeURIComponent(o.queue)}${o.conversationId ? `&c=${o.conversationId}` : ""}`;
  const back = selected ? hrefFor({ queue, conversationId: selected.id }) : undefined;
  // modo sensível: o segundo fator vem antes da conversa e do painel do contato
  const selectedBot = selected ? bots.find((b) => b.id === selected.botId) : undefined;
  if (selectedBot?.sensitive_mode) await requireAgencyMfa(back!);
  const [contact, notes] = await Promise.all([
    selected?.contactId ? loadInboxContact(admin, { contactId: selected.contactId, botIds: bots.map((b) => b.id), conversationId: selected.id }) : null,
    selected ? listNotes(admin, selected.id).catch(() => []) : [],
  ]);
  const botName = (botId: string) => bots.find((b) => b.id === botId)?.name;

  return (
    <div className="-mx-4 -my-5 h-[calc(100dvh-60px-var(--panel-notices-h,0px))] min-h-0 sm:-mx-6 sm:-my-7 lg:-mx-9 lg:h-[calc(100dvh-var(--panel-notices-h,0px))]">
      <InboxView backInHeader contactOpen={(await cookies()).get(CONTACT_COOKIE)?.value !== "fechado"} queuesOpen={(await cookies()).get(QUEUES_COOKIE)?.value !== "fechado"} items={items} queue={queue} queues={queues} meId={member.id} selectedId={selected?.id ?? null} hrefFor={hrefFor} showClient={clientIds.length > 1} available={member.available !== false} onAvailability={setMyAvailability}
        contact={selected && <InboxContact data={contact} notes={notes} onNote={addConversationNote.bind(null, selected.id)} botName={botName} conversationHref={(_b, c) => hrefFor({ queue, conversationId: c })} contactHref={contact && canConfig && selectedBot?.client_id ? withFrom(`/painel/clientes/${selectedBot.client_id}/contatos/${contact.contact.id}`, back) : null} />}>
        {selected && <AgencyConversation botId={selected.botId} convId={selected.id} embedded back={back} mobileBack={hrefFor({ queue })} contactToggle earlier={Math.min(50, Number(sp.ant) || 0)} earlierHref={(n) => `${hrefFor({ queue, conversationId: selected.id })}&ant=${n}`} />}
      </InboxView>
    </div>
  );
}
