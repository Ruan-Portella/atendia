import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Totais diários (report_daily, leva S): uma linha por dia (fuso de São Paulo), chatbot e canal,
 * sem dado do contato. Relatórios, portal e painel somam o agregado com a contagem ao vivo dos
 * dias ainda não agregados (funções do banco, migração 0068), então a retenção pode apagar
 * conversas sem mudar os números. O job diário recalcula os 2 últimos dias fechados antes da
 * retenção; na primeira vez, preenche o histórico. A retenção não apaga nada depois do último dia
 * agregado (reportedUntil).
 */

const TZ = "America/Sao_Paulo";

/** Data (AAAA-MM-DD) no fuso de São Paulo. */
export const spDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Meia-noite (São Paulo, UTC-3 o ano todo desde 2019) do dia. */
export const spMidnight = (day: string) => new Date(`${day}T00:00:00-03:00`);

/**
 * Quais dias recalcular: os 2 últimos dias fechados e o buraco desde o último agregado (job que
 * não rodou). Sem nada agregado ainda, do primeiro dia com dados. null: nada a fazer.
 */
export function planRefresh(o: { through: string | null; yesterday: string; firstDataDay: string | null }): { from: string; to: string } | null {
  const from = o.through ? [addDays(o.through, 1), addDays(o.yesterday, -1)].sort()[0] : o.firstDataDay;
  if (!from || from > o.yesterday) return null;
  return { from, to: o.yesterday };
}

/** Blocos de até 31 dias (o preenchimento do histórico não roda num comando só). */
export function chunks(from: string, to: string, size = 31): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (let start = from; start <= to; ) {
    const end = [addDays(start, size - 1), to].sort()[0];
    out.push({ from: start, to: end });
    start = addDays(end, 1);
  }
  return out;
}

export async function reportedThrough(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from("platform_flags").select("report_daily_through").eq("id", 1).maybeSingle();
  return ((data as { report_daily_through?: string | null } | null)?.report_daily_through ?? null) || null;
}

/** Até quando a retenção pode apagar: o começo do dia seguinte ao último agregado (null: nada agregado, não apaga). */
export async function reportedUntil(db: SupabaseClient): Promise<Date | null> {
  const through = await reportedThrough(db);
  return through ? spMidnight(addDays(through, 1)) : null;
}

/** O dia (São Paulo) do registro mais antigo que entra nos totais. */
async function firstDataDay(db: SupabaseClient): Promise<string | null> {
  const first = async (table: string, column: string) => {
    const { data } = await db.from(table).select(column).order(column).limit(1).maybeSingle();
    const v = (data as Record<string, string> | null)?.[column];
    return v ? spDay(new Date(v)) : null;
  };
  const days = (await Promise.all([first("conversations", "started_at"), first("leads", "created_at"), first("atendimentos", "started_at")])).filter((d): d is string => Boolean(d));
  return days.sort()[0] ?? null;
}

/** Recalcula os dias pendentes, em blocos, avançando o marcador a cada bloco. */
export async function refreshReportDaily(db: SupabaseClient, hasTime: () => boolean = () => true, now = new Date()): Promise<{ from: string; to: string; through: string | null; rows: number } | { nothing: true; through: string | null }> {
  const through = await reportedThrough(db);
  const yesterday = addDays(spDay(now), -1);
  const plan = planRefresh({ through, yesterday, firstDataDay: through ? null : await firstDataDay(db) });
  if (!plan) {
    // sem dados ainda: marca até ontem (o que chegar depois é contado ao vivo e agregado no dia seguinte)
    if (!through) await db.from("platform_flags").update({ report_daily_through: yesterday }).eq("id", 1);
    return { nothing: true, through: through ?? yesterday };
  }
  let rows = 0;
  let mark = through;
  for (const c of chunks(plan.from, plan.to)) {
    if (!hasTime()) break;
    const { data, error } = await db.rpc("report_daily_refresh", { p_from: c.from, p_to: c.to });
    if (error) throw new Error(`totais diários ${c.from}–${c.to}: ${error.message}`);
    rows += Number(data) || 0;
    // o marcador só avança (recalcular os 2 últimos dias não volta o ponto)
    if (!mark || c.to > mark) {
      const { error: e2 } = await db.from("platform_flags").update({ report_daily_through: c.to }).eq("id", 1);
      if (e2) throw new Error(`totais diários: marcador não gravado: ${e2.message}`);
      mark = c.to;
    }
  }
  return { ...plan, through: mark, rows };
}
