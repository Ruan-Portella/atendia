import { describe, expect, it } from "vitest";
import { addDays, chunks, planRefresh, spDay, spMidnight } from "../report-daily";

describe("totais diários: quais dias recalcular", () => {
  it("rotina normal: os 2 últimos dias fechados", () => {
    expect(planRefresh({ through: "2026-10-03", yesterday: "2026-10-04", firstDataDay: null })).toEqual({ from: "2026-10-03", to: "2026-10-04" });
    // rodou duas vezes no mesmo dia: recalcula os mesmos 2 dias
    expect(planRefresh({ through: "2026-10-04", yesterday: "2026-10-04", firstDataDay: null })).toEqual({ from: "2026-10-03", to: "2026-10-04" });
  });

  it("rotina parada por dias: cobre o buraco desde o último agregado", () => {
    expect(planRefresh({ through: "2026-09-20", yesterday: "2026-10-04", firstDataDay: null })).toEqual({ from: "2026-09-21", to: "2026-10-04" });
  });

  it("primeira vez: do primeiro dia com dados; sem dados, nada", () => {
    expect(planRefresh({ through: null, yesterday: "2026-10-04", firstDataDay: "2025-03-10" })).toEqual({ from: "2025-03-10", to: "2026-10-04" });
    expect(planRefresh({ through: null, yesterday: "2026-10-04", firstDataDay: null })).toBeNull();
    // dado só de hoje: ainda não há dia fechado
    expect(planRefresh({ through: null, yesterday: "2026-10-04", firstDataDay: "2026-10-05" })).toBeNull();
  });

  it("histórico em blocos de 31 dias, sem buraco nem sobreposição", () => {
    const c = chunks("2026-01-01", "2026-03-15");
    expect(c[0]).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(c.at(-1)!.to).toBe("2026-03-15");
    for (let i = 1; i < c.length; i++) expect(c[i].from).toBe(addDays(c[i - 1].to, 1));
    expect(chunks("2026-10-03", "2026-10-04")).toEqual([{ from: "2026-10-03", to: "2026-10-04" }]);
  });

  it("dia e meia-noite no fuso de São Paulo", () => {
    // 01:30 UTC de 5/10 ainda é 4/10 em São Paulo
    expect(spDay(new Date("2026-10-05T01:30:00Z"))).toBe("2026-10-04");
    expect(spMidnight("2026-10-05").toISOString()).toBe("2026-10-05T03:00:00.000Z");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
