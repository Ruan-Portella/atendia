import type { SupabaseClient } from "@supabase/supabase-js";
import type { SectorMemberType } from "./sectors";

/*
 * Disponibilidade de quem atende (Caixa de entrada, parte 2): a pessoa escolhe Disponível ou
 * Ausente, e o painel (ou a área do cliente) aberto renova o last_seen_at a cada poucos minutos.
 * "Online" = disponível e visto há pouco. O rodízio dos setores só escolhe quem está online.
 */

/** Visto há até isso conta como com o painel aberto (o painel renova a cada 2 minutos). */
export const ONLINE_WINDOW_MS = 10 * 60_000;
/** O painel grava a visita no máximo uma vez por isso (cada página e o ping do painel aberto). */
export const SEEN_THROTTLE_MS = 60_000;

const tableOf = (t: SectorMemberType) => (t === "agency_member" ? "agency_members" : "client_members");

/** Está disponível e com o painel aberto agora? Pura. */
export function isOnline(m: { available?: boolean | null; last_seen_at?: string | null }, now = Date.now()): boolean {
  return m.available !== false && Boolean(m.last_seen_at) && now - Date.parse(m.last_seen_at!) <= ONLINE_WINDOW_MS;
}

/** O painel aberto: renova a visita (no máximo uma gravação por minuto). */
export async function markSeen(db: SupabaseClient, m: { type: SectorMemberType; id: string }, now = new Date()): Promise<void> {
  const before = new Date(now.getTime() - SEEN_THROTTLE_MS).toISOString();
  await db.from(tableOf(m.type)).update({ last_seen_at: now.toISOString() }).eq("id", m.id).or(`last_seen_at.is.null,last_seen_at.lt.${before}`);
}

export async function setAvailable(db: SupabaseClient, m: { type: SectorMemberType; id: string }, available: boolean): Promise<boolean> {
  const { error } = await db.from(tableOf(m.type)).update({ available, ...(available ? { last_seen_at: new Date().toISOString() } : {}) }).eq("id", m.id);
  return !error;
}

export interface Assignee {
  type: SectorMemberType;
  id: string;
  name: string;
}

const nameOf = (r: { display_name?: string | null; email?: string | null }) => r.display_name?.trim() || (r.email ?? "").split("@")[0] || "Equipe";

/**
 * O rodízio do setor: a pessoa online que recebeu conversa há mais tempo (quem nunca recebeu vem
 * primeiro). Marca a vez dela. Ninguém online: null (a conversa fica na fila do setor).
 */
export async function nextInRotation(db: SupabaseClient, sectorId: string, now = new Date()): Promise<Assignee | null> {
  const { data: rows } = await db.from("sector_members").select("member_type, member_id, last_assigned_at").eq("sector_id", sectorId);
  const members = (rows ?? []) as Array<{ member_type: SectorMemberType; member_id: string; last_assigned_at: string | null }>;
  if (!members.length) return null;
  const load = async (type: SectorMemberType) => {
    const ids = members.filter((m) => m.member_type === type).map((m) => m.member_id);
    if (!ids.length) return [] as Array<{ id: string; available: boolean | null; last_seen_at: string | null; display_name: string | null; email: string | null }>;
    const base = db.from(tableOf(type)).select("id, available, last_seen_at, display_name, email").in("id", ids);
    const { data } = await (type === "agency_member" ? base.is("removed_at", null) : base);
    return (data ?? []) as Array<{ id: string; available: boolean | null; last_seen_at: string | null; display_name: string | null; email: string | null }>;
  };
  const [agency, client] = await Promise.all([load("agency_member"), load("client_member")]);
  const people = new Map([...agency.map((p) => [`agency_member:${p.id}`, p] as const), ...client.map((p) => [`client_member:${p.id}`, p] as const)]);
  const online = members
    .filter((m) => {
      const p = people.get(`${m.member_type}:${m.member_id}`);
      return p && isOnline(p, now.getTime());
    })
    .sort((a, b) => (a.last_assigned_at ?? "").localeCompare(b.last_assigned_at ?? ""));
  const pick = online[0];
  if (!pick) return null;
  await db.from("sector_members").update({ last_assigned_at: now.toISOString() }).eq("sector_id", sectorId).eq("member_type", pick.member_type).eq("member_id", pick.member_id);
  return { type: pick.member_type, id: pick.member_id, name: nameOf(people.get(`${pick.member_type}:${pick.member_id}`)!) };
}
