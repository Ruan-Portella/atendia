import type { SupabaseClient } from "@supabase/supabase-js";
import { monthSummary, periodRange, shiftPeriod, type Summary } from "./report";
import { currentPeriodBR } from "./utils";

/*
 * Evolução por chatbot (Lançamento, parte 4b, 19/10/2026): mês a mês, quanto a IA resolveu
 * sozinha, quanto foi para a equipe, o tempo até alguém da equipe assumir e a satisfação, para a
 * agência mostrar resultado ao cliente (no painel e no relatório da área do cliente). As contagens
 * vêm dos totais diários (ficam depois da limpeza das conversas); o tempo, de handoff_waits
 * (gravado ao assumir, migração 0118); a satisfação, das respostas da pesquisa.
 */

export interface EvolutionMonth {
  /** "2026-10" */
  period: string;
  conversations: number;
  /** resolvidas sem a equipe */
  resolvedByAi: number;
  /** pediram atendente (ou deixaram pedido) */
  toTeam: number;
  resolvedPct: number | null;
  leads: number;
  /** mediana, em minutos, do pedido de atendente até alguém assumir (null sem atendimento) */
  teamMinutes: number | null;
  /** % de Ótimo entre as pesquisas respondidas (null sem resposta) */
  goodPct: number | null;
  answered: number;
}

/** Mais do que isso do pedido até assumir não entra na mediana (pedido esquecido). */
const MAX_WAIT_MINUTES = 7 * 24 * 60;

/** O mês (São Paulo, UTC−3) de um instante. Pura. */
export const periodOf = (iso: string) => new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 7);

/** Mediana. Pura. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Os `months` meses até `until` ("2026-10"), do mais antigo ao último. Pura. */
export function lastPeriods(months: number, until: string): string[] {
  return Array.from({ length: months }, (_, i) => shiftPeriod(until, i - months + 1));
}

/** "12 min", "2 h 5 min", "1 dia e 3 h". Pura. */
export function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const days = `${d} dia${d > 1 ? "s" : ""}`;
  return h % 24 ? `${days} e ${h % 24} h` : days;
}

export interface EvolutionOptions {
  months?: number;
  /** o último mês da tabela (padrão: o mês atual) */
  until?: string;
  /** os totais do mês (os testes trocam: o banco em memória não tem o rpc) */
  summarize?: (db: SupabaseClient, botIds: string[], period: string) => Promise<Summary>;
}

/** A Evolução dos chatbots (somados), mês a mês, do mais antigo ao atual. `db`: service role. */
export async function botEvolution(db: SupabaseClient, botIds: string[], opts: EvolutionOptions = {}): Promise<EvolutionMonth[]> {
  const { months = 6, until = currentPeriodBR(), summarize = monthSummary } = opts;
  if (!botIds.length) return [];
  const periods = lastPeriods(months, until);
  const { from: since } = periodRange(periods[0]);
  const { to: end } = periodRange(until);
  const [summaries, { data: waits }, { data: surveys }] = await Promise.all([
    Promise.all(periods.map((p) => summarize(db, botIds, p))),
    db.from("handoff_waits").select("requested_at, assumed_at").in("bot_id", botIds).gte("requested_at", since).lt("requested_at", end).limit(20_000),
    db.from("satisfaction_surveys").select("sent_at, score").in("bot_id", botIds).gte("sent_at", since).lt("sent_at", end).not("score", "is", null).limit(20_000),
  ]);
  // o tempo conta no mês do pedido
  const minutes = new Map<string, number[]>();
  for (const w of (waits ?? []) as Array<{ requested_at: string; assumed_at: string }>) {
    const m = (Date.parse(w.assumed_at) - Date.parse(w.requested_at)) / 60_000;
    if (!(m >= 0 && m <= MAX_WAIT_MINUTES)) continue;
    const p = periodOf(w.requested_at);
    minutes.set(p, [...(minutes.get(p) ?? []), m]);
  }
  const notes = new Map<string, { answered: number; good: number }>();
  for (const s of (surveys ?? []) as Array<{ sent_at: string; score: number | null }>) {
    if (!s.score) continue;
    const p = periodOf(s.sent_at);
    const n = notes.get(p) ?? { answered: 0, good: 0 };
    notes.set(p, { answered: n.answered + 1, good: n.good + (s.score === 3 ? 1 : 0) });
  }
  return periods.map((period, i) => {
    const s = summaries[i];
    const n = notes.get(period);
    const wait = median(minutes.get(period) ?? []);
    const toTeam = Math.min(s.needsHuman, s.conversations);
    return {
      period,
      conversations: s.conversations,
      resolvedByAi: s.conversations - toTeam,
      toTeam,
      resolvedPct: s.conversations ? Math.round(((s.conversations - toTeam) / s.conversations) * 100) : null,
      leads: s.leads,
      teamMinutes: wait === null ? null : Math.round(wait),
      goodPct: n?.answered ? Math.round((n.good / n.answered) * 100) : null,
      answered: n?.answered ?? 0,
    };
  });
}
