import type { SupabaseClient } from "@supabase/supabase-js";
import { spDay, spMidnight } from "./report-daily";
import { notifyPlatform } from "./notify";

/*
 * Verificação contínua por cliente (leva B1', parte 4b; spec Peça 10 "verificação contínua por
 * sinais"): todo dia, com números agregados e sem abrir conversa (termos de Tech Provider), compara
 * a última semana de cada cliente com as 4 anteriores. Salto de volume, muitos pedidos fora do
 * assunto, itens proibidos em alta e mensagens que a Meta cobrou como IA de uso geral viram pendência
 * interna no backoffice (compliance_checks), sem selo nem aviso ao cliente, sem segurar nada. Os
 * limites são provisórios: revisar com os números dos pilotos. O sinal de repasse fica para depois
 * do MVP.
 */

/** Categoria da cobrança da Meta para IA de uso geral (webhook de status, pricing.category). */
export const META_AI_CATEGORIES = ["general_purpose_ai"];

export const WEEKS = 8;
/** Semanas anteriores que formam a base de comparação. */
const BASE_WEEKS = 4;

export type SignalKind = "volume" | "off_topic" | "prohibited" | "meta_signal";
export const SIGNAL_KINDS: readonly SignalKind[] = ["volume", "off_topic", "prohibited", "meta_signal"];

export const SIGNAL_LABEL: Record<SignalKind, string> = {
  volume: "Salto de volume",
  off_topic: "Muitos pedidos fora do assunto",
  prohibited: "Itens proibidos em alta",
  meta_signal: "Meta: IA de uso geral",
};

export interface Thresholds {
  /** Atendimentos mínimos na semana para contar como salto. */
  volumeFloor: number;
  /** Quantas vezes a média das 4 semanas anteriores. */
  volumeRatio: number;
  offTopicFloor: number;
  /** Pedidos fora do assunto por atendimento na semana. */
  offTopicShare: number;
  prohibitedFloor: number;
  prohibitedRatio: number;
}

export const THRESHOLDS: Thresholds = { volumeFloor: 300, volumeRatio: 3, offTopicFloor: 20, offTopicShare: 0.25, prohibitedFloor: 10, prohibitedRatio: 2 };
/** Limites baixos para testar no staging (só fora da produção, pelo botão do backoffice). */
export const TEST_THRESHOLDS: Thresholds = { volumeFloor: 3, volumeRatio: 3, offTopicFloor: 2, offTopicShare: 0.25, prohibitedFloor: 1, prohibitedRatio: 2 };

/** Uma linha da função continuous_check_weeks: séries semanais, índice 0 = os 7 dias mais recentes. */
export interface ClientWeeks {
  client_id: string;
  agency_id: string;
  top_bot_id: string;
  atendimentos: number[];
  refusals: number[];
  prohibited: number[];
  meta_ai: number[];
}

export interface Signal {
  kind: SignalKind;
  /** O que aconteceu, para quem revisa. */
  motivo: string;
  semana: number;
  base: number;
  score: number | null;
}

/** Média das 4 semanas antes da última (arredondada a 1 casa). Pura. */
export function baseline(series: number[]): number {
  const prev = series.slice(1, 1 + BASE_WEEKS);
  return prev.length ? Math.round((prev.reduce((t, v) => t + v, 0) / prev.length) * 10) / 10 : 0;
}

export type Trend = "subindo" | "caindo" | "estavel";

/** Tendência da última semana contra a base: dobro ou mais sobe, metade ou menos cai (com diferença de pelo menos 2). Pura. */
export function trendOf(series: number[]): Trend {
  const last = series[0] ?? 0;
  const base = baseline(series);
  if (last - base >= 2 && last >= base * 2) return "subindo";
  if (base - last >= 2 && last <= base / 2) return "caindo";
  return "estavel";
}

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v);

/** Os sinais de um cliente na última semana. Pura. */
export function clientSignals(w: ClientWeeks, t: Thresholds = THRESHOLDS): Signal[] {
  const out: Signal[] = [];
  const a = w.atendimentos[0] ?? 0;
  const aBase = baseline(w.atendimentos);
  if (a >= t.volumeFloor && a >= t.volumeRatio * aBase) {
    out.push({ kind: "volume", motivo: `${fmt(a)} atendimentos na última semana (média de ${fmt(aBase)} nas 4 anteriores)`, semana: a, base: aBase, score: aBase ? Math.round((a / aBase) * 10) / 10 : null });
  }
  const rf = w.refusals[0] ?? 0;
  if (rf >= t.offTopicFloor && rf >= t.offTopicShare * Math.max(a, 1)) {
    const pct = a ? `${Math.round((rf / a) * 100)}% de ${fmt(a)} atendimentos` : "sem atendimentos contados";
    out.push({ kind: "off_topic", motivo: `${fmt(rf)} pedidos fora do assunto na última semana (${pct}): a IA pode estar sendo usada como assistente de uso geral`, semana: rf, base: baseline(w.refusals), score: a ? Math.round((rf / a) * 100) / 100 : null });
  }
  const pr = w.prohibited[0] ?? 0;
  const prBase = baseline(w.prohibited);
  if (pr >= t.prohibitedFloor && pr >= t.prohibitedRatio * prBase) {
    out.push({ kind: "prohibited", motivo: `${fmt(pr)} detecções de item proibido no portão na última semana (média de ${fmt(prBase)} nas 4 anteriores)`, semana: pr, base: prBase, score: prBase ? Math.round((pr / prBase) * 10) / 10 : null });
  }
  const m = w.meta_ai[0] ?? 0;
  if (m >= 1) out.push({ kind: "meta_signal", motivo: `${fmt(m)} mensagens cobradas pela Meta como IA de uso geral na última semana`, semana: m, base: baseline(w.meta_ai), score: null });
  return out;
}

/** Meia-noite de hoje em São Paulo: as semanas terminam aqui (o dia de hoje ainda não fechou). */
export const weeksUntil = (now = new Date()) => spMidnight(spDay(now));

/** Séries de todos os clientes (ou de uma agência), em páginas de 1.000. */
export async function clientWeeks(db: SupabaseClient, o: { agencyId?: string | null; now?: Date } = {}): Promise<ClientWeeks[]> {
  const out: ClientWeeks[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .rpc("continuous_check_weeks", { p_until: weeksUntil(o.now).toISOString(), p_weeks: WEEKS, p_agency: o.agencyId ?? null, p_ai_categories: META_AI_CATEGORIES })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as ClientWeeks[]));
    if (!data || data.length < PAGE) return out;
  }
}

/**
 * Roda a verificação: abre uma pendência por cliente e tipo de sinal, sem repetir o que já está
 * pendente ou foi aberto nos últimos 7 dias (o mesmo salto não volta toda manhã). Avisa a equipe
 * do BoaVoz quando abre alguma.
 */
export async function runContinuousChecks(db: SupabaseClient, o: { now?: Date; thresholds?: Thresholds } = {}): Promise<{ clients: number; opened: Array<{ clientId: string; kind: SignalKind; motivo: string }> }> {
  const now = o.now ?? new Date();
  const rows = await clientWeeks(db, { now });
  const found = rows.flatMap((w) => clientSignals(w, o.thresholds).map((s) => ({ w, s })));
  if (!found.length) return { clients: rows.length, opened: [] };

  const recent = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const { data: existing, error } = await db
    .from("compliance_checks")
    .select("client_id, kind")
    .in("kind", SIGNAL_KINDS as string[])
    .in("client_id", [...new Set(found.map((f) => f.w.client_id))])
    .or(`review_state.eq.pending,created_at.gte.${recent}`);
  if (error) throw error;
  const seen = new Set((existing ?? []).map((e) => `${e.client_id}:${e.kind}`));
  const fresh = found.filter((f) => !seen.has(`${f.w.client_id}:${f.s.kind}`));
  if (!fresh.length) return { clients: rows.length, opened: [] };

  const { error: insertError } = await db.from("compliance_checks").insert(
    fresh.map(({ w, s }) => ({
      agency_id: w.agency_id,
      client_id: w.client_id,
      bot_id: w.top_bot_id,
      kind: s.kind,
      labels: { motivo: s.motivo, semana: s.semana, base: s.base, atendimentos: w.atendimentos, pedidos_fora: w.refusals, proibidos: w.prohibited, meta_ia: w.meta_ai },
      score: s.score,
      rules_version: "continua-1",
      review_state: "pending",
      holds_client: false,
    })),
  );
  if (insertError) throw insertError;

  const { data: clients } = await db.from("clients").select("id, name").in("id", [...new Set(fresh.map((f) => f.w.client_id))]);
  const name = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
  await notifyPlatform(`Verificação contínua: ${fresh.length} sinal(is) novo(s)`, [
    ...fresh.map(({ w, s }) => `• ${name.get(w.client_id) ?? w.client_id}: ${SIGNAL_LABEL[s.kind]}: ${s.motivo}`),
    "Revise em Backoffice > Conformidade > Verificação contínua. O cliente não vê nada e nada fica bloqueado.",
  ]).catch(() => false);
  return { clients: rows.length, opened: fresh.map(({ w, s }) => ({ clientId: w.client_id, kind: s.kind, motivo: s.motivo })) };
}

/* ------------------------------------------------------------------ backoffice */

export interface SignalRow {
  id: number;
  kind: SignalKind;
  motivo: string;
  clientId: string | null;
  clientName: string;
  agencyId: string;
  agencyName: string | null;
  reviewState: "pending" | "resolved" | "none";
  resolution: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

export interface TrendRow {
  clientId: string;
  clientName: string;
  agencyId: string;
  agencyName: string | null;
  weeks: ClientWeeks;
  /** Sinais que a semana atual dispara hoje (com os limites de produção). */
  signals: SignalKind[];
}

const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;

function signalRow(r: Record<string, unknown>): SignalRow {
  return {
    id: r.id as number,
    kind: r.kind as SignalKind,
    motivo: String((r.labels as { motivo?: string } | null)?.motivo ?? ""),
    clientId: (r.client_id as string | null) ?? null,
    clientName: one(r.clients as { name: string } | null)?.name ?? "cliente apagado",
    agencyId: r.agency_id as string,
    agencyName: one(r.agencies as { name: string } | null)?.name ?? null,
    reviewState: r.review_state as SignalRow["reviewState"],
    resolution: (r.resolution as string | null) ?? null,
    resolvedBy: (r.resolved_by as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

/**
 * Backoffice: pendências da verificação contínua, as últimas resolvidas e a tendência por cliente
 * (com sinal primeiro, depois os de mais atendimentos na semana). Com agencyId, só a agência e
 * todos os clientes dela.
 */
export async function continuousView(db: SupabaseClient, o: { agencyId?: string | null; limit?: number } = {}): Promise<{ pending: SignalRow[]; recent: SignalRow[]; trends: TrendRow[]; until: Date }> {
  const cols = "id, kind, labels, client_id, agency_id, review_state, resolution, resolved_by, created_at, clients(name), agencies(name)";
  const base = () => {
    const q = db.from("compliance_checks").select(cols).in("kind", SIGNAL_KINDS as string[]);
    return o.agencyId ? q.eq("agency_id", o.agencyId) : q;
  };
  const [{ data: pending }, { data: recent }, weeks] = await Promise.all([
    base().eq("review_state", "pending").order("created_at").limit(50),
    base().eq("review_state", "resolved").order("resolved_at", { ascending: false }).limit(10),
    clientWeeks(db, { agencyId: o.agencyId }),
  ]);
  const pendingRows = (pending ?? []).map((r) => signalRow(r as Record<string, unknown>));
  const flagged = new Set(pendingRows.map((r) => r.clientId));
  const sorted = [...weeks].sort((a, b) => Number(flagged.has(b.client_id)) - Number(flagged.has(a.client_id)) || (b.atendimentos[0] ?? 0) - (a.atendimentos[0] ?? 0));
  const shown = o.agencyId ? sorted : sorted.slice(0, o.limit ?? 20);
  const clientIds = shown.map((w) => w.client_id);
  const agencyIds = [...new Set(shown.map((w) => w.agency_id))];
  const [{ data: clients }, { data: agencies }] = await Promise.all([
    clientIds.length ? db.from("clients").select("id, name").in("id", clientIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    agencyIds.length ? db.from("agencies").select("id, name").in("id", agencyIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);
  const clientName = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
  const agencyName = new Map((agencies ?? []).map((a) => [a.id as string, a.name as string]));
  return {
    pending: pendingRows,
    recent: (recent ?? []).map((r) => signalRow(r as Record<string, unknown>)),
    trends: shown.map((w) => ({ clientId: w.client_id, clientName: clientName.get(w.client_id) ?? "cliente apagado", agencyId: w.agency_id, agencyName: agencyName.get(w.agency_id) ?? null, weeks: w, signals: clientSignals(w).map((s) => s.kind) })),
    until: weeksUntil(),
  };
}
