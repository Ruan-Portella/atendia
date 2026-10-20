import { describe, expect, it } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { botEvolution, lastPeriods, median, minutesLabel, periodOf } from "../evolution";
import { takeOver } from "../handoff";
import type { Summary } from "../report";

const BOT = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const plus = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();

const SUMMARIES: Record<string, Summary> = {
  "2026-09": { conversations: 40, needsHuman: 10, leads: 4, visitorMessages: 200 },
  "2026-10": { conversations: 20, needsHuman: 2, leads: 3, visitorMessages: 90 },
};
const summarize = async (_db: unknown, _ids: string[], period: string) => SUMMARIES[period] ?? { conversations: 0, needsHuman: 0, leads: 0, visitorMessages: 0 };

describe("evolução", () => {
  it("o mês é o de São Paulo, e os últimos meses vêm do mais antigo ao atual", () => {
    expect(periodOf("2026-10-01T02:59:00.000Z")).toBe("2026-09");
    expect(periodOf("2026-10-01T03:00:00.000Z")).toBe("2026-10");
    expect(lastPeriods(3, "2026-01")).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("mediana e o tempo por extenso", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect([12, 60, 125, 1440, 1440 + 180, 2 * 1440].map(minutesLabel)).toEqual(["12 min", "1 h", "2 h 5 min", "1 dia", "1 dia e 3 h", "2 dias"]);
  });

  it("soma por mês: resolvidas pela IA, mediana do tempo até assumir (no mês do pedido) e a satisfação", async () => {
    const t: Record<string, MemRow[]> = {
      handoff_waits: [
        { bot_id: BOT, requested_at: "2026-10-05T13:00:00.000Z", assumed_at: "2026-10-05T13:10:00.000Z" },
        { bot_id: BOT, requested_at: "2026-10-06T13:00:00.000Z", assumed_at: "2026-10-06T13:30:00.000Z" },
        { bot_id: BOT, requested_at: "2026-10-07T13:00:00.000Z", assumed_at: "2026-10-07T14:00:00.000Z" },
        // 23h30 de 30/09 em São Paulo: conta em setembro
        { bot_id: BOT, requested_at: "2026-10-01T02:30:00.000Z", assumed_at: "2026-10-01T02:35:00.000Z" },
        // pedido esquecido (mais de 7 dias) e outro chatbot: não contam
        { bot_id: BOT, requested_at: "2026-09-01T13:00:00.000Z", assumed_at: "2026-09-20T13:00:00.000Z" },
        { bot_id: OTHER, requested_at: "2026-10-05T13:00:00.000Z", assumed_at: "2026-10-05T18:00:00.000Z" },
      ],
      satisfaction_surveys: [
        { bot_id: BOT, sent_at: "2026-10-10T15:00:00.000Z", score: 3 },
        { bot_id: BOT, sent_at: "2026-10-11T15:00:00.000Z", score: 1 },
        { bot_id: BOT, sent_at: "2026-10-12T15:00:00.000Z", score: null },
        { bot_id: OTHER, sent_at: "2026-10-12T15:00:00.000Z", score: 1 },
      ],
    };
    const months = await botEvolution(memoryDb(t), [BOT], { months: 3, until: "2026-10", summarize });
    expect(months.map((m) => m.period)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(months[0]).toMatchObject({ conversations: 0, resolvedPct: null, teamMinutes: null, goodPct: null, answered: 0 });
    expect(months[1]).toMatchObject({ conversations: 40, resolvedByAi: 30, toTeam: 10, resolvedPct: 75, leads: 4, teamMinutes: 5, goodPct: null });
    expect(months[2]).toMatchObject({ conversations: 20, resolvedByAi: 18, toTeam: 2, resolvedPct: 90, leads: 3, teamMinutes: 30, goodPct: 50, answered: 2 });
    expect(await botEvolution(memoryDb(t), [], { until: "2026-10", summarize })).toEqual([]);
    // olhando um mês antigo, a tabela acaba nele (outubro fica de fora)
    const before = await botEvolution(memoryDb(t), [BOT], { months: 2, until: "2026-09", summarize });
    expect(before.map((m) => [m.period, m.teamMinutes, m.goodPct])).toEqual([["2026-08", null, null], ["2026-09", 5, null]]);
  });

  it("assumir um pedido de atendente grava o tempo uma vez; o pedido deixado e a troca de quem atende não gravam", async () => {
    const requested = "2026-10-19T14:00:00.000Z";
    const conv = (over: Partial<MemRow> = {}): MemRow => ({ id: "c1", bot_id: BOT, handoff_requested_at: requested, lead_waiting_at: null, takeover_at: null, handled_at: null, assigned_to_id: null, assigned_to_name: null, ...over });
    const ana = { type: "agency_member" as const, id: "m1", name: "Ana", legacy: "ana@agencia.test" };
    const bia = { type: "agency_member" as const, id: "m2", name: "Bia", legacy: "bia@agencia.test" };

    const t: Record<string, MemRow[]> = { conversations: [conv()], handoff_waits: [], routine_runs: [] };
    expect((await takeOver(memoryDb(t), "c1", ana)).ok).toBe(true);
    expect(t.handoff_waits).toHaveLength(1);
    expect(t.handoff_waits[0]).toMatchObject({ bot_id: BOT, requested_at: requested });
    expect(Date.parse(String(t.handoff_waits[0].assumed_at))).toBeGreaterThan(Date.parse(requested));
    // assumir no lugar de quem já atende: o tempo já foi contado
    expect((await takeOver(memoryDb(t), "c1", bia, { force: true })).ok).toBe(true);
    expect(t.handoff_waits).toHaveLength(1);

    const lead: Record<string, MemRow[]> = { conversations: [conv({ lead_waiting_at: requested })], handoff_waits: [], routine_runs: [] };
    expect((await takeOver(memoryDb(lead), "c1", ana)).ok).toBe(true);
    expect(lead.handoff_waits).toHaveLength(0);

    // assumir sem ninguém ter pedido (o pedido antigo já foi atendido)
    const old: Record<string, MemRow[]> = { conversations: [conv({ handled_at: plus(requested, 30) })], handoff_waits: [], routine_runs: [] };
    expect((await takeOver(memoryDb(old), "c1", ana)).ok).toBe(true);
    expect(old.handoff_waits).toHaveLength(0);
  });
});
