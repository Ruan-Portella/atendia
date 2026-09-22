import { describe, expect, it } from "vitest";
import { change, currentPeriodBR, isPeriod, periodLabel, periodRange, renderReportEmail, shiftPeriod, type ClientReport } from "../report";

describe("períodos", () => {
  it("usa o fuso de São Paulo na virada do mês", () => {
    // 1º de setembro, 01:00 UTC = 31 de agosto, 22:00 em SP
    expect(currentPeriodBR(new Date("2026-09-01T01:00:00Z"))).toBe("2026-08");
    expect(currentPeriodBR(new Date("2026-09-01T04:00:00Z"))).toBe("2026-09");
  });
  it("anda meses atravessando o ano", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
  });
  it("intervalo do mês em horário de SP", () => {
    expect(periodRange("2026-08")).toEqual({ from: "2026-08-01T03:00:00.000Z", to: "2026-09-01T03:00:00.000Z" });
  });
  it("valida o formato", () => {
    expect(isPeriod("2026-08")).toBe(true);
    expect(isPeriod("2026-13")).toBe(false);
    expect(isPeriod("x")).toBe(false);
  });
  it("nome do mês em português", () => {
    expect(periodLabel("2026-08")).toBe("agosto de 2026");
  });
  it("variação percentual", () => {
    expect(change(150, 100)).toBe(50);
    expect(change(50, 100)).toBe(-50);
    expect(change(10, 0)).toBeNull();
  });
});

describe("renderReportEmail", () => {
  const report: ClientReport = {
    period: "2026-08",
    client: { id: "c", name: "Clínica <Sorriso>", site: null },
    agency: { name: "Agência X", logo_url: null, brand_color: "#123456", support_whatsapp: null, custom_domain: null, custom_domain_verified_at: null },
    bots: [{ id: "b", name: "Sofia" }],
    current: { conversations: 340, needsHuman: 30, leads: 28, visitorMessages: 900 },
    previous: { conversations: 200, needsHuman: 10, leads: 20, visitorMessages: 500 },
    daily: [],
    resolvedPct: 91,
  };
  it("traz os números, a comparação e o link", () => {
    const { subject, html, text } = renderReportEmail(report, "https://x/c/tok?mes=2026-08");
    expect(subject).toContain("agosto de 2026");
    expect(text).toContain("atendeu 340 pessoas e capturou 28 contatos");
    expect(text).toContain("+70% vs. mês anterior");
    expect(html).toContain("https://x/c/tok?mes=2026-08");
    expect(html).toContain("#123456");
  });
  it("escapa HTML dos nomes", () => {
    const { html } = renderReportEmail(report, "https://x");
    expect(html).toContain("Clínica &lt;Sorriso&gt;");
    expect(html).not.toContain("<Sorriso>");
  });
});
