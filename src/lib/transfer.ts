import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type ActionResult } from "./action-result";
import type { Attendant } from "./authors";
import { nextInRotation, type Assignee } from "./availability";
import { eligibleSectorMembers, listSectors, type Sector, type SectorMemberType } from "./sectors";
import { handoffAudience } from "./handoff-routing";
import { heldByOther, holdsConversation, type Holder } from "./handoff";
import { saveNote } from "./conversation-notes";
import { noteBody } from "./note-text";
import type { BotRow } from "./chat";
import { queueConversationAssigned, queueConversationTransferred } from "./message-events";

/*
 * Transferir (Caixa de entrada, parte 4; spec, Peça 11): passa a conversa para outra pessoa ou
 * para um setor, com nota interna opcional. No atendimento em andamento, o assistente continua
 * pausado e a primeira mensagem de quem recebe sai com o anúncio de transferência ("Viviane passou
 * seu atendimento para Carlos, do setor Financeiro"). No setor com rodízio, a conversa vai para a
 * próxima pessoa disponível; sem rodízio (ou sem ninguém disponível), fica na fila do setor, e quem
 * responder primeiro assume. Quem recebe é avisado por e-mail.
 */

export type TransferTarget = { kind: "pessoa"; type: SectorMemberType; id: string } | { kind: "setor"; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O destino do formulário: "setor:<id>", "agency_member:<id>" ou "client_member:<id>". Pura. */
export function parseTarget(v: unknown): TransferTarget | null {
  const [kind, id] = typeof v === "string" ? v.split(":") : [];
  if (!id || !UUID.test(id)) return null;
  if (kind === "setor") return { kind: "setor", id };
  if (kind === "agency_member" || kind === "client_member") return { kind: "pessoa", type: kind, id };
  return null;
}

export interface TransferOptions {
  sectors: Array<{ id: string; name: string }>;
  people: Array<{ type: SectorMemberType; id: string; name: string }>;
}

/** Para onde dá para transferir: os setores do cliente e as pessoas que atendem nele (menos você). */
export async function transferOptions(db: SupabaseClient, o: { agencyId: string; clientId: string | null; meId: string }): Promise<TransferOptions> {
  if (!o.clientId) return { sectors: [], people: [] };
  const [sectors, members, { data: client }] = await Promise.all([
    listSectors(db, [o.clientId]),
    eligibleSectorMembers(db, { agencyId: o.agencyId, clientId: o.clientId }),
    db.from("clients").select("allow_handoff").eq("id", o.clientId).maybeSingle(),
  ]);
  // as pessoas da área do cliente só atendem se a agência liberou
  const people = members.filter((m) => m.id !== o.meId && (m.type === "agency_member" || client?.allow_handoff));
  return { sectors: sectors.map((s) => ({ id: s.id, name: s.name })), people: people.map((m) => ({ type: m.type, id: m.id, name: m.name })) };
}

type ConvRow = Holder & { bot_id: string; sector_id: string | null; handoff_requested_at: string | null; transfer_from_name: string | null; bots: BotRow | BotRow[] | null };

export type TransferResult = ActionResult & { toLabel?: string; assignee?: Assignee | null; sectorId?: string | null };

export async function transferConversation(db: SupabaseClient, conversationId: string, who: Attendant, target: TransferTarget, rawNote: unknown, now = new Date()): Promise<TransferResult> {
  const note = noteBody(rawNote);
  if (note && typeof note === "object") return fail(note.error);
  const { data } = await db
    .from("conversations")
    .select("takeover_at, handled_at, assigned_to_type, assigned_to_id, assigned_to_name, handoff_requested_at, transfer_from_name, bot_id, sector_id, bots(id, name, client_name, client_id, agency_id, lead_capture, human_handoff)")
    .eq("id", conversationId)
    .maybeSingle();
  const conv = data as ConvRow | null;
  if (!conv) return fail("Conversa não encontrada.");
  const bot = (Array.isArray(conv.bots) ? conv.bots[0] : conv.bots) as BotRow | null;
  if (!bot) return fail("Conversa não encontrada.");
  const active = Boolean(conv.takeover_at) && !conv.handled_at;
  if (!active && (conv.handled_at || !conv.handoff_requested_at)) return fail("Só dá para transferir um atendimento aberto. Assuma a conversa antes.");
  if (heldByOther(conv, who.id)) return fail(`${conv.assigned_to_name?.trim() || "Outra pessoa da equipe"} está atendendo esta conversa. Para transferir, use “Assumir no lugar” antes.`);
  const options = await transferOptions(db, { agencyId: bot.agency_id, clientId: bot.client_id ?? null, meId: who.id });
  const at = now.toISOString();
  // quem falava com o contato (o anúncio diz quem passou): você, se estava atendendo
  const from = holdsConversation(conv, who.id) ? { transfer_from_name: who.name } : {};
  const announce = active ? { announce_pending: true, ...from } : {};

  let patch: Record<string, unknown>;
  let toLabel: string;
  let assignee: Assignee | null = null;
  let sector: Sector | null = null;
  if (target.kind === "pessoa") {
    const person = options.people.find((p) => p.type === target.type && p.id === target.id);
    if (!person) return fail(target.id === who.id ? "A conversa já é sua: escolha outra pessoa." : "Essa pessoa não atende este cliente.");
    assignee = { type: person.type, id: person.id, name: person.name };
    patch = { assigned_to_type: person.type, assigned_to_id: person.id, assigned_to_name: person.name, assigned_at: at, ...announce };
    toLabel = person.name;
  } else {
    sector = (await listSectors(db, [bot.client_id!]).catch(() => [])).find((s) => s.id === target.id) ?? null;
    if (!sector || !options.sectors.some((s) => s.id === target.id)) return fail("Setor não encontrado neste cliente.");
    if (sector.distribution === "rodizio") {
      assignee = await nextInRotation(db, sector.id, now);
      // quem transfere para o setor não recebe de volta pelo rodízio
      if (assignee?.id === who.id) assignee = await nextInRotation(db, sector.id, now);
      if (assignee?.id === who.id) assignee = null;
    }
    patch = { sector_id: sector.id, assigned_to_type: assignee?.type ?? null, assigned_to_id: assignee?.id ?? null, assigned_to_name: assignee?.name ?? null, assigned_at: assignee ? at : null, ...announce };
    toLabel = assignee ? `${sector.name} · com ${assignee.name}` : sector.name;
  }
  // transferir tira do adiamento; só vale se a conversa não mudou de mãos no meio
  let q = db.from("conversations").update({ ...patch, snoozed_until: null, snoozed_at: null }).eq("id", conversationId).is("handled_at", null);
  q = conv.assigned_to_id ? q.eq("assigned_to_id", conv.assigned_to_id) : q.is("assigned_to_id", null);
  const { data: updated, error } = await q.select("id");
  if (error) return fail("Não foi possível transferir. Tente de novo.");
  if (!updated?.length) return fail("A conversa mudou enquanto você transferia. Abra de novo e confira.");
  await saveNote(db, { conversationId, botId: bot.id, kind: "transferencia", who, body: note, targetLabel: toLabel }).catch((e) => console.error("registro da transferência", (e as Error).message));
  // webhooks: conversation.transferred e, se chegou a alguém, conversation.assigned
  await queueConversationTransferred(db, conversationId, { from: who, toAgent: assignee, toSector: target.kind === "setor", at });
  const previous = conv.assigned_to_id ? { type: (conv as { assigned_to_type?: string | null }).assigned_to_type ?? "agency_member", id: conv.assigned_to_id, name: conv.assigned_to_name?.trim() || "Outra pessoa da equipe" } : null;
  if (assignee) await queueConversationAssigned(db, conversationId, { agent: assignee, by: "transfer", previous, at });
  // e-mail para quem recebe: a pessoa, ou as pessoas do setor (sem ninguém no setor, toda a equipe)
  const audience = await handoffAudience(db, sector, assignee).catch(() => null);
  const { notifyTransfer } = await import("./notify");
  notifyTransfer({ db, bot, conversationId, from: who.name, to: toLabel, audience }).catch(() => {});
  return { ...ok(`Transferida para ${toLabel}.${active ? " A primeira mensagem de quem recebe sai com o anúncio de transferência." : ""}`), toLabel, assignee, sectorId: sector?.id ?? conv.sector_id };
}
