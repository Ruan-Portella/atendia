import { describe, expect, it } from "vitest";
import { change, currentPeriodBR, isPeriod, periodLabel, periodRange, renderReportEmail, shiftPeriod, widgetFunnel, type ClientReport } from "../report";

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
    whatsapp: null,
    channels: [],
    widgetOpens: 0,
  };
  it("traz os números, a comparação e o link", () => {
    const { subject, html, text } = renderReportEmail(report, "https://x/c/tok?mes=2026-08");
    expect(subject).toContain("agosto de 2026");
    expect(text).toContain("atendeu 340 pessoas e capturou 28 contatos");
    expect(text).toContain("+70% vs. mês anterior");
    expect(html).toContain("https://x/c/tok?mes=2026-08");
    expect(html).toContain("#123456");
  });
  it("conversas por canal, o funil do chat do site e as perguntas sem resposta", () => {
    const channels = [
      { channel: "widget", conversations: 120, handoffs: 6, leads: 18, unanswered: 4 },
      { channel: "whatsapp", conversations: 220, handoffs: 24, leads: 10, unanswered: 2 },
    ];
    const { text } = renderReportEmail({ ...report, channels, widgetOpens: 400 }, "https://x");
    expect(text).toContain("Conversas por canal: Chat do site: 120 · WhatsApp: 220");
    expect(text).toContain("Chat do site: Abriram o chat 400 → Conversaram 120 → Deixaram contato 18 → Pediram atendente 6");
    expect(text).toContain("Perguntas sem resposta: 6");
    expect(renderReportEmail(report, "https://x").text).not.toContain("Conversas por canal");
  });
  it("funil: porcentagem de cada passo sobre o anterior; sem movimento no site, nada", () => {
    expect(widgetFunnel(0, undefined)).toBeNull();
    expect(widgetFunnel(200, { channel: "widget", conversations: 50, handoffs: 5, leads: 10, unanswered: 0 })?.map((f) => f.pct)).toEqual([null, 25, 20, 50]);
    // aberturas contadas desde a migração: nunca menos que as conversas
    expect(widgetFunnel(3, { channel: "widget", conversations: 10, handoffs: 0, leads: 0, unanswered: 0 })?.[0].value).toBe(10);
  });
  it("sem WhatsApp no mês, o e-mail não fala de WhatsApp", () => {
    expect(renderReportEmail(report, "https://x").text).not.toContain("WhatsApp:");
  });
  it("com WhatsApp, mostra enviadas, cobradas e a estimativa", () => {
    const { text, html } = renderReportEmail({ ...report, whatsapp: { sent: 1250, billed: 250, estimate: 8.75, partial: false } }, "https://x");
    // o formato de moeda usa espaço não separável depois do "R$"
    expect(text).toMatch(/WhatsApp: 1\.250 mensagens enviadas pelo WhatsApp\. A Meta cobrou 250 delas, cerca de R\$\s8,75/);
    expect(html).toContain("WhatsApp:");
    const none = renderReportEmail({ ...report, whatsapp: { sent: 1, billed: 0, estimate: 0, partial: false } }, "https://x").text;
    expect(none).toContain("1 mensagem enviada pelo WhatsApp. Nenhuma foi cobrada pela Meta.");
  });
  it("escapa HTML dos nomes", () => {
    const { html } = renderReportEmail(report, "https://x");
    expect(html).toContain("Clínica &lt;Sorriso&gt;");
    expect(html).not.toContain("<Sorriso>");
  });
});
