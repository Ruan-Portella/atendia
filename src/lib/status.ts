import type { SupabaseClient } from "@supabase/supabase-js";
import { inboundErrorStats } from "./inbound-queue";
import { sendFailureStatsByChannel } from "./messages";

/*
 * Página de status (antes do lançamento; post do X de 18/10, trazido em 21/10/2026). Cada
 * componente do BoaVoz com o estado de agora, o histórico de 90 dias e os incidentes. O estado
 * automático sai dos sinais que o BoaVoz já mede, a cada 5 minutos no tique das campanhas:
 * - o banco não aceita escrita: tudo fora;
 * - WhatsApp e Instagram: a fila da Meta parada (o evento mais antigo esperando há 10 minutos:
 *   instável; 30: fora) e as respostas recusadas pelo canal nos últimos 30 minutos;
 * - IA: as mensagens que precisaram de outra tentativa ou falharam nos últimos 30 minutos.
 * Sempre com um mínimo de casos, para pouco volume não acender nada; e o estado só muda depois
 * de duas leituras iguais. Os incidentes escritos pelo suporte valem por cima do automático.
 */

export type StatusComponent = "painel" | "chat" | "whatsapp" | "instagram" | "ia" | "api";
export type StatusState = "operando" | "instavel" | "fora";
export type IncidentLevel = "instabilidade" | "fora" | "manutencao";
/** O que a página mostra (a manutenção vem só dos incidentes). */
export type ShownState = StatusState | "manutencao";

export const STATUS_COMPONENTS: Array<{ id: StatusComponent; label: string; description: string }> = [
  { id: "painel", label: "Painel e área do cliente", description: "Entrar, configurar e atender pelo navegador" },
  { id: "chat", label: "Chat do site", description: "O chat nos sites dos clientes e as demos" },
  { id: "whatsapp", label: "WhatsApp", description: "Receber e responder pelo WhatsApp" },
  { id: "instagram", label: "Instagram", description: "Direct e comentários" },
  { id: "ia", label: "Respostas da IA", description: "O assistente respondendo nos canais" },
  { id: "api", label: "API e webhooks", description: "A API pública e o envio dos webhooks" },
];
export const isStatusComponent = (v: unknown): v is StatusComponent => STATUS_COMPONENTS.some((c) => c.id === v);

export const STATE_LABEL: Record<ShownState, string> = { operando: "Operando normalmente", instavel: "Instável", fora: "Fora do ar", manutencao: "Em manutenção" };
export const LEVEL_LABEL: Record<IncidentLevel, string> = { instabilidade: "Instabilidade", fora: "Fora do ar", manutencao: "Manutenção" };
export const isIncidentLevel = (v: unknown): v is IncidentLevel => v === "instabilidade" || v === "fora" || v === "manutencao";

export const STATUS_THRESHOLDS = {
  windowMinutes: 30,
  queueUnstableSeconds: 600,
  queueDownSeconds: 1800,
  minInbound: 10,
  iaUnstable: 0.25,
  iaDown: 0.6,
  minFailedSends: 10,
  sendsUnstable: 0.25,
  sendsDown: 0.6,
  checkEveryMinutes: 5,
} as const;

export interface StatusSignals {
  dbWrite: boolean;
  oldestPendingSeconds: Record<"whatsapp" | "instagram", number | null>;
  inbound: { total: number; retried: number };
  sends: Record<"whatsapp" | "instagram", { sent: number; failed: number }>;
}

const RANK: Record<StatusState, number> = { operando: 0, instavel: 1, fora: 2 };
const worst = (a: { state: StatusState; reason: string | null }, b: { state: StatusState; reason: string | null }) => (RANK[b.state] > RANK[a.state] ? b : a);
const pct = (n: number, d: number) => `${Math.round((n / Math.max(d, 1)) * 100)}%`;

/** O estado de cada componente pelos sinais (sem a leitura dupla). Pura. */
export function statesFromSignals(s: StatusSignals): Record<StatusComponent, { state: StatusState; reason: string | null }> {
  const T = STATUS_THRESHOLDS;
  const ok = { state: "operando" as StatusState, reason: null as string | null };
  if (!s.dbWrite) {
    const down = { state: "fora" as StatusState, reason: "o banco de dados não está aceitando gravações" };
    return { painel: down, chat: down, whatsapp: down, instagram: down, ia: down, api: down };
  }
  const channel = (c: "whatsapp" | "instagram") => {
    let r = ok;
    const age = s.oldestPendingSeconds[c];
    if (age !== null && age >= T.queueDownSeconds) r = worst(r, { state: "fora", reason: `as mensagens recebidas estão paradas há ${Math.round(age / 60)} minutos` });
    else if (age !== null && age >= T.queueUnstableSeconds) r = worst(r, { state: "instavel", reason: `as mensagens recebidas estão atrasadas (${Math.round(age / 60)} minutos)` });
    const { sent, failed } = s.sends[c];
    if (failed >= T.minFailedSends) {
      const ratio = failed / Math.max(sent, 1);
      if (ratio >= T.sendsDown) r = worst(r, { state: "fora", reason: `${pct(failed, sent)} das respostas recusadas pelo canal` });
      else if (ratio >= T.sendsUnstable) r = worst(r, { state: "instavel", reason: `${pct(failed, sent)} das respostas recusadas pelo canal` });
    }
    return r;
  };
  let ia = ok;
  if (s.inbound.retried >= T.minInbound) {
    const ratio = s.inbound.retried / Math.max(s.inbound.total, 1);
    if (ratio >= T.iaDown) ia = { state: "fora", reason: `${pct(s.inbound.retried, s.inbound.total)} das mensagens precisaram de outra tentativa` };
    else if (ratio >= T.iaUnstable) ia = { state: "instavel", reason: `${pct(s.inbound.retried, s.inbound.total)} das mensagens precisaram de outra tentativa` };
  }
  return { painel: ok, chat: ok, whatsapp: channel("whatsapp"), instagram: channel("instagram"), ia, api: ok };
}

export interface CurrentRow {
  state: StatusState;
  pending_state: StatusState | null;
  pending_count: number;
}

/** A leitura dupla: o estado só muda quando duas leituras seguidas concordam. Pura. */
export function nextState(cur: CurrentRow, computed: StatusState): CurrentRow & { changed: boolean } {
  if (computed === cur.state) return { state: cur.state, pending_state: null, pending_count: 0, changed: false };
  const count = cur.pending_state === computed ? cur.pending_count + 1 : 1;
  if (count >= 2) return { state: computed, pending_state: null, pending_count: 0, changed: true };
  return { state: cur.state, pending_state: computed, pending_count: count, changed: false };
}

/** Os sinais de agora (o banco, a fila da Meta e as taxas dos últimos 30 minutos). */
export async function collectSignals(db: SupabaseClient, now = new Date()): Promise<StatusSignals> {
  const since = new Date(now.getTime() - STATUS_THRESHOLDS.windowMinutes * 60_000).toISOString();
  const write = await db.from("health_checks").upsert({ id: 1, checked_at: now.toISOString() });
  const oldest = async (source: "whatsapp" | "instagram") => {
    const { data } = await db.from("inbound_events").select("created_at").eq("source", source).in("status", ["received", "processing"]).order("created_at").limit(1).maybeSingle();
    return data?.created_at ? Math.max(0, Math.round((now.getTime() - Date.parse(data.created_at as string)) / 1000)) : null;
  };
  const [wa, ig, inbound, sends] = await Promise.all([oldest("whatsapp"), oldest("instagram"), inboundErrorStats(db, since), sendFailureStatsByChannel(db, since)]);
  return { dbWrite: !write.error, oldestPendingSeconds: { whatsapp: wa, instagram: ig }, inbound, sends };
}

/**
 * A conferência (no tique das campanhas, a cada 5 minutos): o estado de cada componente com a
 * leitura dupla e os minutos com problema do dia. Antes dos 5 minutos, não faz nada.
 */
export async function runStatusCheck(db: SupabaseClient, now = new Date(), o: { force?: boolean } = {}): Promise<{ ran: boolean; changed: StatusComponent[] }> {
  const { data: rows } = await db.from("status_current").select("component, state, pending_state, pending_count, checked_at");
  const current = (rows ?? []) as Array<CurrentRow & { component: StatusComponent; checked_at: string | null }>;
  const last = current.reduce((m, r) => Math.max(m, r.checked_at ? Date.parse(r.checked_at) : 0), 0);
  if (!o.force && last && now.getTime() - last < (STATUS_THRESHOLDS.checkEveryMinutes - 0.5) * 60_000) return { ran: false, changed: [] };
  const computed = statesFromSignals(await collectSignals(db, now));
  const changed: StatusComponent[] = [];
  for (const c of STATUS_COMPONENTS) {
    const row = current.find((r) => r.component === c.id) ?? { state: "operando" as StatusState, pending_state: null, pending_count: 0 };
    const next = nextState(row, computed[c.id].state);
    if (next.changed) changed.push(c.id);
    await db
      .from("status_current")
      .upsert({ component: c.id, state: next.state, pending_state: next.pending_state, pending_count: next.pending_count, checked_at: now.toISOString(), ...(next.changed ? { since: now.toISOString(), reason: computed[c.id].reason } : next.state === "operando" ? { reason: null } : {}) }, { onConflict: "component" });
    if (next.state !== "operando") await db.rpc("add_status_minutes", { p_component: c.id, p_state: next.state, p_minutes: STATUS_THRESHOLDS.checkEveryMinutes });
  }
  return { ran: true, changed };
}

/* ------------------------------------------------------------------ a página */

export interface StatusIncident {
  id: string;
  title: string;
  level: IncidentLevel;
  components: StatusComponent[];
  startedAt: string;
  resolvedAt: string | null;
  updates: Array<{ body: string; at: string }>;
}

export type DayLevel = "ok" | "instavel" | "fora" | "sem_registro";

export interface StatusPage {
  overall: ShownState;
  components: Array<{ id: StatusComponent; label: string; description: string; state: ShownState; since: string | null; days: Array<{ day: string; level: DayLevel }>; uptime: number | null }>;
  open: StatusIncident[];
  past: StatusIncident[];
  checkedAt: string | null;
}

const LEVEL_TO_STATE: Record<IncidentLevel, ShownState> = { instabilidade: "instavel", fora: "fora", manutencao: "manutencao" };
const SHOWN_RANK: Record<ShownState, number> = { operando: 0, manutencao: 1, instavel: 2, fora: 3 };

/** Os 90 dias de um componente, do mais antigo ao de hoje (São Paulo). Pura. */
export function dayLevels(rows: Array<{ day: string; degraded_minutes: number; down_minutes: number }>, incidents: StatusIncident[], component: StatusComponent, firstDay: string, today: string, days = 90): Array<{ day: string; level: DayLevel }> {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: Array<{ day: string; level: DayLevel }> = [];
  const end = Date.parse(`${today}T12:00:00Z`);
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    if (day < firstDay) {
      out.push({ day, level: "sem_registro" });
      continue;
    }
    const r = byDay.get(day);
    const hit = incidents.filter((x) => x.level !== "manutencao" && x.components.includes(component) && x.startedAt.slice(0, 10) <= day && (x.resolvedAt ?? "9999").slice(0, 10) >= day);
    const level: DayLevel = (r?.down_minutes ?? 0) >= 15 || hit.some((x) => x.level === "fora") ? "fora" : (r?.down_minutes ?? 0) > 0 || (r?.degraded_minutes ?? 0) >= 15 || hit.length ? "instavel" : "ok";
    out.push({ day, level });
  }
  return out;
}

/** O que a página pública mostra (lida pelo servidor, a cada minuto). */
export async function loadStatusPage(db: SupabaseClient, now = new Date()): Promise<StatusPage> {
  const today = now.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const from = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: cur }, { data: daily }, { data: incidents }] = await Promise.all([
    db.from("status_current").select("component, state, since, checked_at"),
    db.from("status_daily").select("component, day, degraded_minutes, down_minutes").gte("day", from),
    db.from("status_incidents").select("id, title, level, components, started_at, resolved_at, status_updates(body, created_at)").or(`resolved_at.is.null,started_at.gte.${from}`).order("started_at", { ascending: false }).limit(50),
  ]);
  const list: StatusIncident[] = ((incidents ?? []) as Array<Record<string, unknown>>).map((i) => ({
    id: i.id as string,
    title: i.title as string,
    level: i.level as IncidentLevel,
    components: ((i.components as string[]) ?? []).filter(isStatusComponent),
    startedAt: i.started_at as string,
    resolvedAt: (i.resolved_at as string | null) ?? null,
    updates: ((i.status_updates as Array<{ body: string; created_at: string }> | null) ?? []).map((u) => ({ body: u.body, at: u.created_at })).sort((a, b) => b.at.localeCompare(a.at)),
  }));
  const open = list.filter((i) => !i.resolvedAt);
  const rows = (cur ?? []) as Array<{ component: StatusComponent; state: StatusState; since: string; checked_at: string | null }>;
  const firstDay = rows.reduce((m, r) => (r.since && r.since.slice(0, 10) < m ? r.since.slice(0, 10) : m), today);
  const dailyRows = (daily ?? []) as Array<{ component: string; day: string; degraded_minutes: number; down_minutes: number }>;
  const components = STATUS_COMPONENTS.map((c) => {
    const row = rows.find((r) => r.component === c.id);
    let state: ShownState = row?.state ?? "operando";
    for (const i of open.filter((x) => x.components.includes(c.id))) if (SHOWN_RANK[LEVEL_TO_STATE[i.level]] > SHOWN_RANK[state]) state = LEVEL_TO_STATE[i.level];
    const mine = dailyRows.filter((d) => d.component === c.id);
    const days = dayLevels(mine, list, c.id, firstDay, today);
    const recorded = days.filter((d) => d.level !== "sem_registro").length;
    const downMinutes = mine.reduce((t, d) => t + d.down_minutes, 0);
    return { ...c, state, since: row && row.state !== "operando" ? row.since : null, days, uptime: recorded ? Math.max(0, 1 - downMinutes / (recorded * 1440)) : null };
  });
  const overall = components.reduce<ShownState>((w, c) => (SHOWN_RANK[c.state] > SHOWN_RANK[w] ? c.state : w), "operando");
  return { overall, components, open, past: list.filter((i) => i.resolvedAt).slice(0, 15), checkedAt: rows.reduce<string | null>((m, r) => (r.checked_at && (!m || r.checked_at > m) ? r.checked_at : m), null) };
}

/* ------------------------------------------------------------------ o suporte */

export async function createIncident(db: SupabaseClient, i: { title: string; level: IncidentLevel; components: StatusComponent[]; body: string; by: string }): Promise<string | null> {
  const { data, error } = await db.from("status_incidents").insert({ title: i.title, level: i.level, components: i.components, created_by: i.by }).select("id").single();
  if (error || !data) return null;
  await db.from("status_updates").insert({ incident_id: data.id, body: i.body, created_by: i.by });
  return data.id as string;
}

export async function addIncidentUpdate(db: SupabaseClient, incidentId: string, body: string, by: string): Promise<boolean> {
  const { error } = await db.from("status_updates").insert({ incident_id: incidentId, body, created_by: by });
  return !error;
}

export async function resolveIncident(db: SupabaseClient, incidentId: string, body: string, by: string, now = new Date()): Promise<boolean> {
  const { error } = await db.from("status_incidents").update({ resolved_at: now.toISOString() }).eq("id", incidentId).is("resolved_at", null);
  if (error) return false;
  return addIncidentUpdate(db, incidentId, body, by);
}

/** O status.<domínio do app> (status.boavoz.com) mostra a página de status. Pura. */
export function isStatusHost(host: string | null, appHost: string | null): boolean {
  if (!host || !appHost) return false;
  return host.toLowerCase().split(":")[0] === `status.${appHost.replace(/^www\./, "")}`;
}

/** Os dias de status_daily que passaram dos 120 dias saem (tarefa diária). */
export async function purgeStatusDaily(db: SupabaseClient, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - 120 * 86_400_000).toISOString().slice(0, 10);
  const { count } = await db.from("status_daily").delete({ count: "exact" }).lt("day", before);
  return count ?? 0;
}
