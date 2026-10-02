import { describe, expect, it } from "vitest";
import { fixedMonthlyBrl, summarizeWhatsApp, type FixedCost } from "../backoffice";
import { cronLate, cronsScheduledHere, groupQuality, operationAlerts, type getOperations } from "../backoffice-ops";
import { fixedCostFields } from "../validation";

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

describe("custos fixos", () => {
  it("valida nome, valor (R$ ou US$) e observação", () => {
    expect(fixedCostFields(form({ name: "Vercel Pro", amount: "20", currency: "USD", active: "on" }))).toEqual({ name: "Vercel Pro", amount: 20, currency: "USD", notes: null, active: true });
    expect(fixedCostFields(form({ name: "Domínio", amount: "1.250,90", currency: "BRL", notes: "anual ÷ 12" }))).toEqual({ name: "Domínio", amount: 1250.9, currency: "BRL", notes: "anual ÷ 12", active: false });
    expect(fixedCostFields(form({ name: "X", amount: "10" }))).toEqual({ error: expect.stringContaining("nome") });
    expect(fixedCostFields(form({ name: "Supabase", amount: "" }))).toEqual({ error: "Informe o valor mensal." });
    expect(fixedCostFields(form({ name: "Supabase", amount: "abc" }))).toEqual({ error: expect.stringContaining("valor válido") });
  });

  it("soma só os ativos, dólar convertido", () => {
    const c = (o: Partial<FixedCost>): FixedCost => ({ id: 1, name: "x", amount: 0, currency: "BRL", notes: null, active: true, ...o });
    expect(fixedMonthlyBrl([c({ amount: 100 }), c({ amount: 20, currency: "USD" }), c({ amount: 999, active: false })], 5)).toBe(200);
  });
});

describe("WhatsApp por agência (cobrado pela Meta de cada cliente)", () => {
  it("soma por categoria e por agência; estimativa só do que tem preço", () => {
    const r = summarizeWhatsApp(
      [
        { agency_id: "a1", category: "service", sent: 100, billed: 0 },
        { agency_id: "a1", category: "utility", sent: 20, billed: 20 },
        { agency_id: "a2", category: "marketing", sent: 10, billed: 10 },
      ],
      { service: 0.035, utility: 0.035 },
    );
    expect([r.sent, r.billed]).toEqual([130, 30]);
    expect(r.estimateBrl).toBeCloseTo(0.7);
    expect(r.unpriced).toEqual(["marketing"]);
    expect(r.agencies.map((a) => [a.agency, a.sent])).toEqual([["a1", 120], ["a2", 10]]);
  });
});

describe("qualidade e operação", () => {
  it("agrupa as contas por métrica, maior primeiro", () => {
    expect(groupQuality([{ metric: "recusa_nivel", key: "flexivel", n: 1 }, { metric: "recusa_nivel", key: "fixo", n: 3 }, { metric: "atendente", key: "pedidos", n: 2 }])).toEqual({
      recusa_nivel: [{ key: "fixo", n: 3 }, { key: "flexivel", n: 1 }],
      atendente: [{ key: "pedidos", n: 2 }],
    });
  });

  it("tarefa diária atrasada depois de 26 h sem sucesso (ou se nunca rodou)", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    expect(cronLate("2026-10-01T13:00:00Z", "diario", now)).toBe(false);
    expect(cronLate("2026-10-01T08:00:00Z", "diario", now)).toBe(true);
    expect(cronLate(null, "drain", now)).toBe(true);
    expect(cronLate(null, "desconhecida", now)).toBe(false);
  });

  it("tarefas agendadas só contam como atrasadas em produção (a Vercel não agenda na dev nem local)", () => {
    expect(cronsScheduledHere("production")).toBe(true);
    expect(cronsScheduledHere("preview")).toBe(false);
    expect(cronsScheduledHere(undefined)).toBe(false);
  });

  it("avisos da visão geral só quando algo precisa de atenção", () => {
    type Ops = Awaited<ReturnType<typeof getOperations>>;
    const base: Ops = {
      health: { ok: true, oldestPendingSeconds: 0, queueStuck: false, dbWrite: true, dbWriteMs: 30, diskBytes: 1, diskRatio: 0.1, diskWarning: false },
      queue: { pending: 0, oldestPendingAt: null, failed24h: 0, failed7d: 0, done24h: 10, failed: [] },
      channels: { waDisconnected: [], waPayment: [], igDisconnected: [], igExpiring: [] },
      crons: [{ name: "diario", label: "Rotina diária", lastRunAt: null, lastOkAt: null, late: false }],
      cronsScheduled: true,
      measures: { metaOrders: 0, metaNotices: 0 },
      reviews: { open: 0, holding: 0, overdue: 0 },
      bots: new Map(),
    };
    expect(operationAlerts(base)).toEqual([]);
    const bad: Ops = { ...base, health: { ...base.health, queueStuck: true }, queue: { ...base.queue, failed24h: 2 }, crons: [{ ...base.crons[0], late: true }], measures: { metaOrders: 1, metaNotices: 0 } };
    expect(operationAlerts(bad)).toEqual([
      "A fila de mensagens da Meta está parada (evento pendente há mais de 30 minutos).",
      "2 evento(s) da Meta com erro nas últimas 24 h.",
      "Tarefa agendada atrasada: Rotina diária.",
      "1 ordem(ns) da Meta bloqueando número(s) de WhatsApp (ver Conformidade).",
    ]);
  });
});
