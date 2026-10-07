import { describe, expect, it } from "vitest";
import { TEST_THRESHOLDS, baseline, clientSignals, trendOf, weeksUntil, type ClientWeeks } from "../continuous-check";

const weeks = (o: Partial<ClientWeeks> = {}): ClientWeeks => ({
  client_id: "c",
  agency_id: "a",
  top_bot_id: "b",
  atendimentos: [0, 0, 0, 0, 0, 0, 0, 0],
  refusals: [0, 0, 0, 0, 0, 0, 0, 0],
  prohibited: [0, 0, 0, 0, 0, 0, 0, 0],
  meta_ai: [0, 0, 0, 0, 0, 0, 0, 0],
  ...o,
});
const kinds = (w: ClientWeeks, t?: Parameters<typeof clientSignals>[1]) => clientSignals(w, t).map((s) => s.kind);

describe("verificação contínua", () => {
  it("base: média das 4 semanas antes da última", () => {
    expect(baseline([999, 10, 20, 30, 40, 500, 500, 500])).toBe(25);
    expect(baseline([5])).toBe(0);
  });

  it("tendência: dobro sobe, metade cai, perto fica estável", () => {
    expect(trendOf([40, 10, 10, 10, 10])).toBe("subindo");
    expect(trendOf([2, 10, 10, 10, 10])).toBe("caindo");
    expect(trendOf([12, 10, 10, 10, 10])).toBe("estavel");
    // números pequenos não viram tendência
    expect(trendOf([1, 0, 0, 0, 0])).toBe("estavel");
  });

  it("salto de volume: piso e 3 vezes a média", () => {
    expect(kinds(weeks({ atendimentos: [900, 200, 250, 300, 250, 0, 0, 0] }))).toEqual(["volume"]);
    // cresceu, mas menos de 3 vezes
    expect(kinds(weeks({ atendimentos: [600, 200, 250, 300, 250, 0, 0, 0] }))).toEqual([]);
    // cliente pequeno: abaixo do piso não é sinal
    expect(kinds(weeks({ atendimentos: [90, 10, 10, 10, 10, 0, 0, 0] }))).toEqual([]);
    // cliente novo já grande
    const s = clientSignals(weeks({ atendimentos: [500, 0, 0, 0, 0, 0, 0, 0] }))[0];
    expect(s).toMatchObject({ kind: "volume", semana: 500, base: 0, score: null });
    expect(s.motivo).toContain("500 atendimentos");
  });

  it("fora do assunto: piso e um quarto dos atendimentos", () => {
    expect(kinds(weeks({ atendimentos: [80, 80, 80, 80, 80, 0, 0, 0], refusals: [30, 2, 2, 2, 2, 0, 0, 0] }))).toEqual(["off_topic"]);
    expect(kinds(weeks({ atendimentos: [400, 400, 400, 400, 400, 0, 0, 0], refusals: [30, 2, 2, 2, 2, 0, 0, 0] }))).toEqual([]);
    expect(clientSignals(weeks({ atendimentos: [80, 80, 80, 80, 80, 0, 0, 0], refusals: [30, 0, 0, 0, 0, 0, 0, 0] }))[0].motivo).toContain("38% de 80 atendimentos");
  });

  it("proibidos em alta e o sinal da Meta", () => {
    expect(kinds(weeks({ prohibited: [25, 5, 5, 5, 5, 0, 0, 0] }))).toEqual(["prohibited"]);
    expect(kinds(weeks({ prohibited: [12, 10, 10, 10, 10, 0, 0, 0] }))).toEqual([]);
    expect(kinds(weeks({ meta_ai: [1, 0, 0, 0, 0, 0, 0, 0] }))).toEqual(["meta_signal"]);
    // só a semana atual conta
    expect(kinds(weeks({ meta_ai: [0, 3, 0, 0, 0, 0, 0, 0] }))).toEqual([]);
  });

  it("limites de teste disparam com números de staging", () => {
    const w = weeks({ atendimentos: [4, 0, 0, 0, 0, 0, 0, 0], refusals: [2, 0, 0, 0, 0, 0, 0, 0], prohibited: [1, 0, 0, 0, 0, 0, 0, 0] });
    expect(kinds(w)).toEqual([]);
    expect(kinds(w, TEST_THRESHOLDS)).toEqual(["volume", "off_topic", "prohibited"]);
  });

  it("as semanas terminam na meia-noite de hoje em São Paulo", () => {
    expect(weeksUntil(new Date("2026-10-06T15:00:00Z")).toISOString()).toBe("2026-10-06T03:00:00.000Z");
    // 01h UTC ainda é o dia anterior em São Paulo
    expect(weeksUntil(new Date("2026-10-07T01:00:00Z")).toISOString()).toBe("2026-10-06T03:00:00.000Z");
  });
});
