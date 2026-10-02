import { afterEach, describe, expect, it, vi } from "vitest";
import { agencyStatus, monthlyCents, rangeFor, summarizeAiCosts, summarizeSubscriptions, sumOpenAiCosts, type AiCostRow, type SubscriptionLike } from "../backoffice";
import { isPlatformAdmin } from "../platform-admin";
import { listCaseFiles } from "../eval-cases";

describe("períodos do backoffice (mês de Brasília)", () => {
  const now = new Date("2026-10-02T15:00:00Z");
  it("este mês começa à meia-noite de Brasília (03:00 UTC)", () => {
    expect(rangeFor("mes", now).since.toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
  it("mês passado, inclusive na virada do ano", () => {
    const r = rangeFor("mes-passado", now);
    expect([r.since.toISOString(), r.until.toISOString()]).toEqual(["2026-09-01T03:00:00.000Z", "2026-10-01T03:00:00.000Z"]);
    expect(rangeFor("mes-passado", new Date("2027-01-10T12:00:00Z")).since.toISOString()).toBe("2026-12-01T03:00:00.000Z");
  });
  it("30 e 7 dias", () => {
    expect(rangeFor("30d", now).since.toISOString()).toBe("2026-09-02T15:00:00.000Z");
    expect(rangeFor("7d", now).since.toISOString()).toBe("2026-09-25T15:00:00.000Z");
  });
});

describe("custo de IA medido", () => {
  const row = (o: Partial<AiCostRow>): AiCostRow => ({ kind: "resposta", model: "gpt-4.1-mini-2025-04-14", channel: "whatsapp", agency_id: "a1", calls: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, audio_seconds: 0, cost_usd: 0, unpriced: 0, ...o });
  it("custo por resposta, % de cache e agrupamentos (modelo sem a data)", () => {
    const s = summarizeAiCosts([
      row({ calls: 10, input_tokens: 40_000, cached_input_tokens: 30_000, output_tokens: 600, cost_usd: 0.007 }),
      row({ channel: "instagram", agency_id: "a2", calls: 10, input_tokens: 40_000, cached_input_tokens: 10_000, output_tokens: 400, cost_usd: 0.009 }),
      row({ kind: "transcricao", model: "gpt-4o-mini-transcribe", calls: 2, audio_seconds: 120, cost_usd: 0.006 }),
      row({ kind: "classificacao", calls: 5, cost_usd: 0.001, unpriced: 1 }),
    ]);
    expect(s.total).toEqual({ cost: 0.023, calls: 27, unpriced: 1 });
    expect(s.answers).toEqual({ calls: 20, cost: 0.016, perAnswer: 0.0008, avgInput: 4000, avgOutput: 50, cachePct: 50 });
    expect(s.audioMinutes).toBe(2);
    expect(s.byKind.map((b) => b.key)).toEqual(["resposta", "transcricao", "classificacao"]);
    expect(s.byModel.find((b) => b.key === "gpt-4.1-mini")?.calls).toBe(25);
    expect(s.byAgency.map((b) => b.key)).toEqual(["a1", "a2"]);
  });
  it("sem nada no período: zeros, sem dividir por zero", () => {
    expect(summarizeAiCosts([]).answers).toEqual({ calls: 0, cost: 0, perAnswer: 0, avgInput: 0, avgOutput: 0, cachePct: 0 });
  });
});

describe("conta da OpenAI (API de custos)", () => {
  it("soma por dia, item e projeto (com nome quando a API lista)", () => {
    const r = sumOpenAiCosts(
      [
        { start_time: 1_790_000_000, results: [{ amount: { value: 0.5 }, line_item: "gpt-4.1-mini, input", project_id: "proj_a" }, { amount: { value: 0.1 }, line_item: "gpt-4.1-mini, output", project_id: "proj_b" }] },
        { start_time: 1_790_086_400, results: [{ amount: { value: 0.25 }, line_item: "gpt-4.1-mini, input", project_id: "proj_a" }] },
      ],
      { proj_a: "BoaVoz prod" },
    );
    expect(r.total).toBeCloseTo(0.85);
    expect(r.byItem[0]).toEqual({ key: "gpt-4.1-mini, input", cost: 0.75 });
    expect(r.byProject.map((p) => p.key)).toEqual(["BoaVoz prod", "proj_b"]);
    expect(r.daily.map((d) => d.cost)).toEqual([0.6, 0.25]);
  });
});

describe("receita (Stripe)", () => {
  it("valor mensal do item: anual ÷ 12, quantidade conta, avulso não", () => {
    expect(monthlyCents({ price: { unit_amount: 9900, recurring: { interval: "month", interval_count: 1 } }, quantity: 1 })).toBe(9900);
    expect(monthlyCents({ price: { unit_amount: 120_000, recurring: { interval: "year", interval_count: 1 } } })).toBe(10_000);
    expect(monthlyCents({ price: { unit_amount: 2000, recurring: { interval: "month", interval_count: 1 } }, quantity: 3 })).toBe(6000);
    expect(monthlyCents({ price: { unit_amount: 5000, recurring: null } })).toBe(0);
  });

  it("MRR só de ativas e atrasadas; cancelamentos dos últimos 30 dias", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    const sub = (status: string, cents: number, canceledDaysAgo?: number): SubscriptionLike => ({
      id: `${status}${cents}`,
      status,
      customer: "cus_1",
      canceled_at: canceledDaysAgo === undefined ? null : Math.floor((now - canceledDaysAgo * 86_400_000) / 1000),
      items: { data: [{ price: { id: "price_x", unit_amount: cents, recurring: { interval: "month", interval_count: 1 } }, quantity: 1 }] },
    });
    const s = summarizeSubscriptions([sub("active", 9900), sub("active", 24_900), sub("past_due", 9900), sub("canceled", 9900, 5), sub("canceled", 9900, 40), sub("incomplete", 9900)], now);
    expect(s.mrrCents).toBe(9900 + 24_900 + 9900);
    expect([s.active, s.pastDue, s.canceled30d]).toEqual([2, 1, 1]);
    expect(s.byPlan).toEqual([{ plan: "outro preço", count: 3, mrrCents: 44_700 }]);
  });
});

describe("situação da agência", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  it("teste, teste vencido, pagante e cancelada", () => {
    expect(agencyStatus({ plan: "trial", trialEndsAt: "2026-10-10T00:00:00Z" }, now)).toBe("teste");
    expect(agencyStatus({ plan: "trial", trialEndsAt: "2026-09-10T00:00:00Z" }, now)).toBe("teste_vencido");
    expect(agencyStatus({ plan: "agencia", trialEndsAt: "2026-09-10T00:00:00Z" }, now)).toBe("pagante");
    expect(agencyStatus({ plan: "cancelado", trialEndsAt: "2026-09-10T00:00:00Z" }, now)).toBe("cancelada");
  });
});

describe("quem entra no backoffice", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("só e-mail da lista (sem diferença de maiúscula); sem lista, ninguém", () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", " Admin@BoaVoz.com , outro@x.com");
    expect(isPlatformAdmin("admin@boavoz.com")).toBe(true);
    expect(isPlatformAdmin("intruso@boavoz.com")).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "");
    expect(isPlatformAdmin("admin@boavoz.com")).toBe(false);
  });
});

describe("arquivos de casos para a tela de avaliação", () => {
  it("geral primeiro (valor 1) e os de bots de teste, com as categorias de cada um", () => {
    const files = listCaseFiles();
    expect(files[0]).toMatchObject({ value: "1", label: "casos.jsonl (geral)" });
    expect(files[0].categories).toContain("escopo_fixo");
    expect(files.find((f) => f.value === "bar")?.categories).toEqual(["portao_bar"]);
  });
});
