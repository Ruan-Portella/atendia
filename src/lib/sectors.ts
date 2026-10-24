import type { SupabaseClient } from "@supabase/supabase-js";
import { hasHours, parseHoursForm, type BusinessHours } from "./handoff-hours";
import { memberName, scopesOf, type AgencyMember } from "./team";

/*
 * Setores do cliente (Caixa de entrada, parte 1; spec, Peça 11): Vendas, Suporte, Financeiro…,
 * que valem para todos os chatbots do cliente. Cada setor tem horário próprio (vazio = o horário
 * de atendimento do chatbot), a distribuição das conversas (manual, ou rodízio entre quem está
 * disponível) e as pessoas: da agência, com o cliente no escopo, e da área do cliente. Os feriados
 * ficam no cliente e valem no horário do chatbot e no dos setores. Só este arquivo toca as tabelas.
 */

export const SECTOR_MAX = 12;
export const SECTOR_NAME_MAX = 40;
export const HOLIDAYS_MAX = 40;

export type Distribution = "manual" | "rodizio";
export const DISTRIBUTION_LABEL: Record<Distribution, string> = {
  manual: "Manual: quem estiver livre pega a conversa",
  rodizio: "Rodízio: a conversa vai para a próxima pessoa disponível do setor",
};

export type SectorMemberType = "agency_member" | "client_member";

export interface SectorMember {
  type: SectorMemberType;
  id: string;
  name: string;
  email: string;
}

export interface Sector {
  id: string;
  clientId: string;
  name: string;
  hours: BusinessHours | null;
  distribution: Distribution;
  position: number;
  members: Array<{ type: SectorMemberType; id: string }>;
}

/** Nome do setor: 1 a 40 caracteres, sem repetir no cliente (sem diferença de maiúsculas). Pura. */
export function sectorNameProblem(name: string, others: string[]): string | null {
  const n = name.trim();
  if (!n) return "Dê um nome ao setor (ex.: Vendas, Suporte, Financeiro).";
  if (n.length > SECTOR_NAME_MAX) return `O nome do setor vai até ${SECTOR_NAME_MAX} caracteres.`;
  if (others.some((o) => o.trim().toLowerCase() === n.toLowerCase())) return `Já existe um setor chamado ${n} neste cliente.`;
  return null;
}

/**
 * Feriados escritos um por linha: "25/12" vale todo ano; "20/11/2026" vale só nesse dia. Guarda
 * "MM-DD" e "AAAA-MM-DD". Pura.
 */
export function parseHolidays(raw: string): { holidays: string[] } | { error: string } {
  const out = new Set<string>();
  for (const line of raw.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean)) {
    const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(line);
    if (!m) return { error: `"${line}" não é uma data: use dia/mês (25/12, todo ano) ou dia/mês/ano (20/11/2026).` };
    const [d, mo, y] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null];
    const probe = new Date(Date.UTC(y ?? 2024, mo - 1, d));
    if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return { error: `"${line}" não existe no calendário.` };
    const md = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    out.add(y ? `${y}-${md}` : md);
  }
  if (out.size > HOLIDAYS_MAX) return { error: `Até ${HOLIDAYS_MAX} feriados por cliente.` };
  return { holidays: [...out].sort() };
}

/** Os feriados como o formulário mostra: "25/12" e "20/11/2026", um por linha. Pura. */
export function holidaysText(holidays: string[] | null | undefined): string {
  return (holidays ?? [])
    .map((h) => {
      const p = h.split("-");
      return p.length === 2 ? `${p[1]}/${p[0]}` : `${p[2]}/${p[1]}/${p[0]}`;
    })
    .join("\n");
}

/** O cliente e os feriados dele (para o horário do chatbot e dos setores). */
export async function clientHolidays(db: SupabaseClient, clientId: string | null | undefined): Promise<string[]> {
  if (!clientId) return [];
  const { data } = await db.from("clients").select("holidays").eq("id", clientId).maybeSingle();
  return ((data?.holidays as string[] | null) ?? []).filter(Boolean);
}

export async function saveHolidays(db: SupabaseClient, clientId: string, holidays: string[]): Promise<boolean> {
  const { error } = await db.from("clients").update({ holidays }).eq("id", clientId);
  return !error;
}

const SECTOR_COLS = "id, client_id, name, hours, distribution, position";

function sectorRow(r: Record<string, unknown>, members: Array<{ type: SectorMemberType; id: string }>): Sector {
  return {
    id: r.id as string,
    clientId: r.client_id as string,
    name: r.name as string,
    hours: hasHours(r.hours as BusinessHours | null) ? (r.hours as BusinessHours) : null,
    distribution: (r.distribution as Distribution) ?? "manual",
    position: Number(r.position ?? 0),
    members,
  };
}

/** Os setores destes clientes, na ordem do cadastro, com as pessoas de cada um. */
export async function listSectors(db: SupabaseClient, clientIds: string[]): Promise<Sector[]> {
  if (!clientIds.length) return [];
  const { data, error } = await db.from("sectors").select(SECTOR_COLS).in("client_id", clientIds).order("position").order("created_at");
  if (error) throw new Error(`setores: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const ids = rows.map((r) => r.id as string);
  const { data: members } = ids.length ? await db.from("sector_members").select("sector_id, member_type, member_id").in("sector_id", ids) : { data: [] };
  const by = new Map<string, Array<{ type: SectorMemberType; id: string }>>();
  for (const m of (members ?? []) as Array<{ sector_id: string; member_type: SectorMemberType; member_id: string }>) {
    by.set(m.sector_id, [...(by.get(m.sector_id) ?? []), { type: m.member_type, id: m.member_id }]);
  }
  return rows.map((r) => sectorRow(r, by.get(r.id as string) ?? []));
}

export async function sectorById(db: SupabaseClient, id: string): Promise<Sector | null> {
  const { data } = await db.from("sectors").select(SECTOR_COLS).eq("id", id).maybeSingle();
  if (!data) return null;
  const { data: members } = await db.from("sector_members").select("member_type, member_id").eq("sector_id", id);
  return sectorRow(data as Record<string, unknown>, ((members ?? []) as Array<{ member_type: SectorMemberType; member_id: string }>).map((m) => ({ type: m.member_type, id: m.member_id })));
}

/**
 * Quem pode entrar nos setores do cliente: a equipe da agência com o cliente no escopo (todos os
 * clientes, o cliente ou um chatbot dele) e as pessoas da área do cliente.
 */
export async function eligibleSectorMembers(db: SupabaseClient, o: { agencyId: string; clientId: string }): Promise<SectorMember[]> {
  const [{ data: agencyRows }, { data: bots }, { data: clientRows }] = await Promise.all([
    db.from("agency_members").select("id, email, display_name, scope, role, accepted_at, removed_at").eq("agency_id", o.agencyId).is("removed_at", null).not("accepted_at", "is", null),
    db.from("bots").select("id").eq("client_id", o.clientId),
    db.from("client_members").select("id, email, display_name").eq("client_id", o.clientId),
  ]);
  const members = (agencyRows ?? []) as Array<Pick<AgencyMember, "id" | "email" | "display_name" | "scope" | "role">>;
  const scoped = members.filter((m) => m.scope === "selected" && m.role !== "owner");
  const scopes = await scopesOf(db, scoped.map((m) => m.id));
  const botIds = new Set((bots ?? []).map((b) => b.id as string));
  const covers = (m: (typeof members)[number]) => {
    if (m.role === "owner" || m.scope !== "selected") return true;
    const s = scopes.get(m.id);
    return Boolean(s && (s.clientIds.includes(o.clientId) || s.botIds.some((b) => botIds.has(b))));
  };
  return [
    ...members.filter(covers).map((m) => ({ type: "agency_member" as const, id: m.id, name: memberName(m), email: m.email })),
    ...((clientRows ?? []) as Array<{ id: string; email: string; display_name: string | null }>).map((m) => ({ type: "client_member" as const, id: m.id, name: m.display_name?.trim() || m.email.split("@")[0], email: m.email })),
  ];
}

/** Quem configura vê todos os setores na Caixa de entrada (a opção da aba Setores). */
export async function setManagersSeeAllSectors(db: SupabaseClient, clientId: string, on: boolean): Promise<boolean> {
  const { error } = await db.from("clients").update({ managers_see_all_sectors: on }).eq("id", clientId);
  return !error;
}

export interface SectorInput {
  name: string;
  hours: BusinessHours | null;
  distribution: Distribution;
  members: Array<{ type: SectorMemberType; id: string }>;
}

/** Lê o formulário do setor (nome, horário, distribuição e pessoas marcadas). Pura. */
export function sectorFromForm(fd: FormData): SectorInput | { error: string } {
  const name = String(fd.get("name") ?? "").trim();
  const hoursForm: Record<string, string> = {};
  for (let d = 0; d < 7; d++) {
    hoursForm[`hours_open_${d}`] = String(fd.get(`hours_open_${d}`) ?? "");
    hoursForm[`hours_close_${d}`] = String(fd.get(`hours_close_${d}`) ?? "");
  }
  const own = fd.get("own_hours") === "on";
  const parsed = own ? parseHoursForm(hoursForm) : { hours: null };
  if ("error" in parsed) return { error: parsed.error };
  if (own && !parsed.hours) return { error: "Marque pelo menos um dia no horário do setor (ou use o horário do chatbot)." };
  const distribution: Distribution = fd.get("distribution") === "rodizio" ? "rodizio" : "manual";
  const members = fd.getAll("member").flatMap((v) => {
    const [type, id] = String(v).split(":");
    return (type === "agency_member" || type === "client_member") && id ? [{ type: type as SectorMemberType, id }] : [];
  });
  return { name, hours: parsed.hours, distribution, members };
}

/**
 * Cria ou altera um setor do cliente, com as pessoas (só as que podem entrar). Devolve o id ou o
 * motivo da recusa.
 */
export async function saveSector(db: SupabaseClient, o: { agencyId: string; clientId: string; id: string | null; input: SectorInput }): Promise<{ id: string } | { error: string }> {
  const current = await listSectors(db, [o.clientId]);
  // só setor deste cliente: com o id de outro, as pessoas entravam no setor alheio (relatório de segurança de 23/10/2026, M13)
  if (o.id && !current.some((s) => s.id === o.id)) return { error: "Setor não encontrado." };
  if (!o.id && current.length >= SECTOR_MAX) return { error: `Até ${SECTOR_MAX} setores por cliente.` };
  const problem = sectorNameProblem(o.input.name, current.filter((s) => s.id !== o.id).map((s) => s.name));
  if (problem) return { error: problem };
  const eligible = await eligibleSectorMembers(db, { agencyId: o.agencyId, clientId: o.clientId });
  const ok = new Set(eligible.map((m) => `${m.type}:${m.id}`));
  const members = o.input.members.filter((m) => ok.has(`${m.type}:${m.id}`));
  const row = { name: o.input.name.trim(), hours: o.input.hours, distribution: o.input.distribution, updated_at: new Date().toISOString() };
  let id = o.id;
  if (id) {
    const { error } = await db.from("sectors").update(row).eq("id", id).eq("client_id", o.clientId);
    if (error) return { error: "Não foi possível salvar o setor. Tente de novo." };
  } else {
    const { data, error } = await db.from("sectors").insert({ ...row, agency_id: o.agencyId, client_id: o.clientId, position: current.length }).select("id").single();
    if (error || !data) return { error: /duplicate|unique/i.test(error?.message ?? "") ? `Já existe um setor chamado ${row.name} neste cliente.` : "Não foi possível criar o setor. Tente de novo." };
    id = data.id as string;
  }
  // as pessoas: quem saiu sai; quem entrou entra (o rodízio guarda a última vez de cada um)
  const before = new Set((current.find((s) => s.id === id)?.members ?? []).map((m) => `${m.type}:${m.id}`));
  const after = new Set(members.map((m) => `${m.type}:${m.id}`));
  const gone = [...before].filter((k) => !after.has(k));
  for (const k of gone) {
    const [type, mid] = k.split(":");
    await db.from("sector_members").delete().eq("sector_id", id).eq("member_type", type).eq("member_id", mid);
  }
  const added = members.filter((m) => !before.has(`${m.type}:${m.id}`));
  if (added.length) await db.from("sector_members").insert(added.map((m) => ({ sector_id: id, member_type: m.type, member_id: m.id })));
  return { id: id! };
}

/** Apaga o setor: as conversas dele ficam sem setor (voltam para a fila geral do cliente). */
export async function deleteSector(db: SupabaseClient, o: { clientId: string; id: string }): Promise<boolean> {
  const { data, error } = await db.from("sectors").delete().eq("id", o.id).eq("client_id", o.clientId).select("id");
  return !error && Boolean(data?.length);
}

/** Os setores de que uma pessoa faz parte (a fila "do meu setor" e o rodízio). */
export async function sectorsOfMember(db: SupabaseClient, m: { type: SectorMemberType; id: string }): Promise<string[]> {
  const { data } = await db.from("sector_members").select("sector_id").eq("member_type", m.type).eq("member_id", m.id);
  return (data ?? []).map((r) => r.sector_id as string);
}
