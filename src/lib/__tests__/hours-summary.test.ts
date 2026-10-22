import { describe, expect, it } from "vitest";
import { hoursSummary } from "@/lib/handoff-hours";

describe("o horário numa linha", () => {
  it("dias seguidos com o mesmo horário se juntam", () => {
    expect(hoursSummary({ "1": ["09:00", "18:00"], "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "13:00"] })).toBe("seg a sex, 9h às 18h · sáb, 9h às 13h");
  });

  it("dois dias, um dia e minutos", () => {
    expect(hoursSummary({ "6": ["10:30", "14:00"], "0": ["10:30", "14:00"] })).toBe("sáb e dom, 10h30 às 14h");
    expect(hoursSummary({ "3": ["08:00", "12:00"] })).toBe("qua, 8h às 12h");
  });

  it("um dia fechado no meio quebra a sequência", () => {
    expect(hoursSummary({ "1": ["09:00", "18:00"], "2": ["09:00", "18:00"], "4": ["09:00", "18:00"] })).toBe("seg e ter, 9h às 18h · qui, 9h às 18h");
  });

  it("sem horário", () => {
    expect(hoursSummary(null)).toBeNull();
    expect(hoursSummary({})).toBeNull();
  });
});
