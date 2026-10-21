import type { SupabaseClient } from "@supabase/supabase-js";
import { listSectors, sectorById, type Sector } from "./sectors";
import { nextInRotation, type Assignee } from "./availability";
import { queueConversationAssigned } from "./message-events";

/*
 * Para onde vai o pedido de atendente (Caixa de entrada, parte 2): a IA diz o setor (pelo nome,
 * entre os setores do cliente) ou a conversa já tem um; sem setor, a fila geral do cliente. No
 * setor com rodízio, a conversa vai para a próxima pessoa disponível; os avisos (e-mail e WhatsApp
 * da equipe) vão só para quem é do setor, ou só para quem recebeu a conversa. Pedido urgente
 * (risco à vida) avisa a agência inteira, como sempre.
 */

/** O setor pelo nome que a IA escreveu (sem diferença de maiúsculas e acentos), ou null. Pura. */
export function matchSector(sectors: Array<Pick<Sector, "id" | "name">>, name: string | null | undefined): Pick<Sector, "id" | "name"> | null {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  const n = name ? fold(name) : "";
  return n ? (sectors.find((s) => fold(s.name) === n) ?? null) : null;
}

/** Os nomes dos setores do cliente do chatbot (a IA recebe no prompt). */
export async function sectorNamesOf(db: SupabaseClient, clientId: string | null | undefined): Promise<Sector[]> {
  return clientId ? listSectors(db, [clientId]).catch(() => []) : [];
}

/** O setor do pedido: o que a IA escolheu (se existe no cliente), senão o que a conversa já tem. */
export async function sectorForHandoff(db: SupabaseClient, o: { clientId: string | null | undefined; conversationId: string; sectorName?: string | null; sectors?: Sector[] }): Promise<Sector | null> {
  if (o.sectorName && o.clientId) {
    const all = o.sectors ?? (await listSectors(db, [o.clientId]));
    const hit = matchSector(all, o.sectorName);
    if (hit) return all.find((s) => s.id === hit.id) ?? null;
  }
  const { data } = await db.from("conversations").select("sector_id").eq("id", o.conversationId).maybeSingle();
  return data?.sector_id ? sectorById(db, data.sector_id as string) : null;
}

/**
 * Rodízio: entrega a conversa à próxima pessoa disponível do setor (sem assumir: ela vê em
 * "Minhas" e assume ao responder). Só se ninguém estiver com a conversa.
 */
export async function assignByRotation(db: SupabaseClient, conversationId: string, sector: Sector, now = new Date()): Promise<Assignee | null> {
  if (sector.distribution !== "rodizio") return null;
  const next = await nextInRotation(db, sector.id, now);
  if (!next) return null;
  const { data } = await db
    .from("conversations")
    .update({ assigned_to_type: next.type, assigned_to_id: next.id, assigned_to_name: next.name, assigned_at: now.toISOString() })
    .eq("id", conversationId)
    .is("takeover_at", null)
    .is("assigned_to_id", null)
    .select("id");
  if (!data?.length) return null;
  // webhooks: conversation.assigned pelo rodízio
  await queueConversationAssigned(db, conversationId, { agent: next, by: "rotation", at: now.toISOString() });
  return next;
}

/** Quem é avisado do pedido: quem recebeu a conversa, senão as pessoas do setor; sem setor (ou sem ninguém nele), todos, como antes. */
export interface HandoffAudience {
  emails: string[];
  agencyMemberIds: string[];
}

export async function handoffAudience(db: SupabaseClient, sector: Sector | null, assignee: Assignee | null): Promise<HandoffAudience | null> {
  const people = assignee ? [{ type: assignee.type, id: assignee.id }] : (sector?.members ?? []);
  if (!people.length) return null;
  const agencyIds = people.filter((p) => p.type === "agency_member").map((p) => p.id);
  const clientIds = people.filter((p) => p.type === "client_member").map((p) => p.id);
  const [{ data: a }, { data: c }] = await Promise.all([
    agencyIds.length ? db.from("agency_members").select("email").in("id", agencyIds) : Promise.resolve({ data: [] as Array<{ email: string }> }),
    clientIds.length ? db.from("client_members").select("email").in("id", clientIds) : Promise.resolve({ data: [] as Array<{ email: string }> }),
  ]);
  return { emails: [...(a ?? []), ...(c ?? [])].map((r) => String(r.email).toLowerCase()), agencyMemberIds: agencyIds };
}
