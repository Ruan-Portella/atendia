import { describe, expect, it } from "vitest";
import { creditEventData, overageValueBrl, sizeChangedData, usageData, type UsageSnapshot } from "../billing-events";
import { monthClosedData } from "../month-close";
import { monthProjection, monthsAverage, usageJson } from "../bot-usage";
import { parseBotPatch, sizeChangeJson } from "../api-billing";
import { snapshotOf, type BotQuotaStatus } from "../atendimentos";
import { API_PERMISSIONS, PERMISSION_LABEL } from "../api-keys";
import { ApiError } from "../api-v1";
import { ACCOUNT_EVENTS, WEBHOOK_EVENTS } from "../webhooks";

const usage = (o: Partial<UsageSnapshot> = {}): UsageSnapshot => ({ month: "2026-10", used: 340, quota: 340, overage: { enabled: true, used: 12, capBrl: 100, max: 285 }, ...o });

describe("webhooks de cota, excedente e crédito (parte 7)", () => {
  it("os 9 eventos novos; os da conta são só os de crédito", () => {
    for (const e of ["bot.quota_warning", "bot.overage_started", "bot.overage_cap_warning", "bot.quota_reached", "bot.size_changed", "bot.overage_changed", "bot.month_closed", "account.credit_low", "account.credit_depleted"] as const) {
      expect(WEBHOOK_EVENTS).toContain(e);
    }
    expect(ACCOUNT_EVENTS).toEqual(["account.credit_low", "account.credit_depleted"]);
  });

  it("uso do mês: atendimentos dentro da cota, a mais e o valor deles (R$ 0,35 cada)", () => {
    expect(usageData(usage())).toEqual({ month: "2026-10", used: 340, quota: 340, overage: { enabled: true, used: 12, cap_brl: 100, max: 285, value_brl: 4.2 } });
    expect(overageValueBrl(3)).toBe(1.05);
    expect(overageValueBrl(0)).toBe(0);
  });

  it("o uso a partir da abertura do atendimento", () => {
    expect(snapshotOf({ used: 272, quota: 340, overage_on: false, overage_used: 0, overage_max: null }, null, "2026-10")).toEqual({ month: "2026-10", used: 272, quota: 340, overage: { enabled: false, used: 0, capBrl: null, max: null } });
    expect(snapshotOf({ used: null, quota: null, overage_on: null, overage_used: null, overage_max: null }, 50, "2026-10").overage).toEqual({ enabled: false, used: 0, capBrl: 50, max: null });
  });

  it("troca de tamanho: agora, agendada ou cancelada, com o tamanho de antes", () => {
    expect(sizeChangedData({ status: "scheduled", size: "P", volumePacks: null, previous: { size: "M", volumePacks: null }, effectiveAt: "2026-11-01T03:00:00.000Z" })).toEqual({
      status: "scheduled",
      size: "P",
      volume_packs: null,
      previous: { size: "M", volume_packs: null },
      effective_at: "2026-11-01T03:00:00.000Z",
    });
  });

  it("crédito: saldo, última compra e o limite do aviso (20% dela)", () => {
    expect(creditEventData(1500, 10000, true)).toEqual({ balance_brl: 15, last_purchase_brl: 100, low_threshold_brl: 20, auto_recharge: true });
  });
});

describe("bot.month_closed", () => {
  const state = { size: "M", volume_packs: null, quota_override: null, prorated_month: null, prorated_quota: null };

  it("o tamanho que valeu no mês, a cota, os atendimentos e o excedente; e o tamanho que vale agora", () => {
    expect(monthClosedData({ period: "2026-10", state, total: 352, overage: 12, next: { size: "P", volume_packs: null } })).toEqual({
      month: "2026-10",
      size: "M",
      volume_packs: null,
      quota: 340,
      atendimentos: 352,
      overage_atendimentos: 12,
      overage_value_brl: 4.2,
      next: { size: "P", volume_packs: null },
    });
  });

  it("cota proporcional do mês em que ganhou o tamanho; Volume por pacote; cota sob medida", () => {
    expect(monthClosedData({ period: "2026-10", state: { ...state, prorated_month: "2026-10-01", prorated_quota: 170 }, total: 0, overage: 0, next: { size: "M", volume_packs: null } }).quota).toBe(170);
    expect(monthClosedData({ period: "2026-11", state: { ...state, prorated_month: "2026-10-01", prorated_quota: 170 }, total: 0, overage: 0, next: { size: "M", volume_packs: null } }).quota).toBe(340);
    const vol = monthClosedData({ period: "2026-10", state: { ...state, size: "volume", volume_packs: 3 }, total: 10, overage: 0, next: { size: null, volume_packs: null } });
    expect([vol.size, vol.volume_packs, vol.quota, vol.next]).toEqual(["volume", 3, 3000, { size: null, volume_packs: null }]);
    expect(monthClosedData({ period: "2026-10", state: { ...state, size: null, quota_override: 5000 }, total: 10, overage: 0, next: { size: null, volume_packs: null } }).quota).toBe(5000);
  });
});

describe("uso pela API", () => {
  const oct = { start: new Date("2026-10-01T03:00:00Z"), end: new Date("2026-11-01T03:00:00Z") };

  it("projeção: o ritmo até agora levado ao mês inteiro (pelo menos 1 dia corrido)", () => {
    // 100 atendimentos em 10 dias de um mês de 31: 310
    expect(monthProjection(100, new Date("2026-10-11T03:00:00Z"), oct)).toBe(310);
    // primeiras horas do mês: conta 1 dia
    expect(monthProjection(3, new Date("2026-10-01T05:00:00Z"), oct)).toBe(93);
    // depois do mês: o total
    expect(monthProjection(400, new Date("2026-11-05T00:00:00Z"), oct)).toBe(400);
  });

  it("média dos meses com atendimento; sem nenhum, null", () => {
    expect(monthsAverage([300, 0, 100])).toBe(200);
    expect(monthsAverage([0, 0, 0])).toBeNull();
  });

  it("formato da resposta: tamanho, cota, situação, sugestão, troca agendada e excedente", () => {
    const s: BotQuotaStatus = {
      botId: "b1",
      name: "Bar",
      clientId: null,
      clientName: null,
      size: "P",
      volumePacks: null,
      override: null,
      quota: 160,
      used: 160,
      overageEnabled: true,
      overageCapBrl: 50,
      overageUsed: 100,
      overageMax: 142,
      overageCapMax: 142,
      overageSuspended: null,
      creditShort: false,
      pendingSize: "none",
      pendingVolumePacks: null,
    };
    const j = usageJson(s, { period: "2026-10", projection: 300, average: 330, scheduledFrom: "2026-11-01T03:00:00.000Z" });
    expect(j).toMatchObject({ bot_id: "bot_b1", month: "2026-10", size: "P", volume_packs: null, custom_quota: null, quota: 160, used: 160, status: "excedente", projection: 300, average_3_months: 330 });
    // 330 por mês: o M (340) sai mais barato que P + 170 a mais
    expect(j.suggested_size).toMatchObject({ size: "M", volume_packs: null, monthly_brl: 99 });
    expect(j.scheduled).toEqual({ size: null, volume_packs: null, effective_at: "2026-11-01T03:00:00.000Z" });
    expect(j.overage).toEqual({ enabled: true, cap_brl: 50, used: 100, max: 142, value_brl: 35, suspended: null });
  });
});

describe("PATCH /v1/bots/{id}", () => {
  const bad = (body: Record<string, unknown>) => {
    try {
      parseBotPatch(body);
    } catch (e) {
      return e instanceof ApiError ? `${e.status} ${(e.details?.field as string | undefined) ?? ""}` : "outro";
    }
    return "passou";
  };

  it("tamanho, Volume com pacotes, tirar o tamanho e o excedente", () => {
    expect(parseBotPatch({ size: "M" })).toEqual({ size: { size: "M", volumePacks: null } });
    expect(parseBotPatch({ size: "volume", volume_packs: 3 })).toEqual({ size: { size: "volume", volumePacks: 3 } });
    expect(parseBotPatch({ size: null })).toEqual({ size: { size: null, volumePacks: null } });
    expect(parseBotPatch({ overage: { enabled: true, cap_brl: 120.555 } })).toEqual({ overage: { enabled: true, capBrl: 120.56 } });
    expect(parseBotPatch({ overage: { enabled: true, cap_brl: null } })).toEqual({ overage: { enabled: true, capBrl: null } });
    // sem cap_brl: o teto fica como está
    expect(parseBotPatch({ overage: { enabled: false } })).toEqual({ overage: { enabled: false, capBrl: undefined } });
  });

  it("recusa o que não faz sentido, apontando o campo", () => {
    expect(bad({})).toBe("400 ");
    expect(bad({ name: "x" })).toBe("400 name");
    expect(bad({ size: "XL" })).toBe("400 size");
    expect(bad({ size: "volume" })).toBe("400 volume_packs");
    expect(bad({ size: "volume", volume_packs: 0 })).toBe("400 volume_packs");
    expect(bad({ size: "P", volume_packs: 2 })).toBe("400 volume_packs");
    expect(bad({ volume_packs: 2 })).toBe("400 volume_packs");
    expect(bad({ overage: true })).toBe("400 overage");
    expect(bad({ overage: { cap_brl: 50 } })).toBe("400 overage.enabled");
    expect(bad({ overage: { enabled: true, cap_brl: 5 } })).toBe("400 overage.cap_brl");
    expect(bad({ overage: { enabled: true, cap_brl: "50" } })).toBe("400 overage.cap_brl");
  });

  it("a troca na resposta: agora (cobrado ou na fatura do dia 1º), agendada, cancelada ou igual", () => {
    expect(sizeChangeJson({ status: "applied", size: "M", volumePacks: null, amountCents: 2581, deferred: false })).toEqual({ status: "applied", size: "M", volume_packs: null, charged_brl: 25.81, next_invoice_brl: 0 });
    expect(sizeChangeJson({ status: "applied", size: "M", volumePacks: null, amountCents: 60, deferred: true })).toEqual({ status: "applied", size: "M", volume_packs: null, charged_brl: 0, next_invoice_brl: 0.6 });
    expect(sizeChangeJson({ status: "scheduled", size: null, volumePacks: null, from: "2026-11-01T03:00:00.000Z" })).toEqual({ status: "scheduled", size: null, volume_packs: null, effective_at: "2026-11-01T03:00:00.000Z" });
    expect(sizeChangeJson({ status: "cancelled", size: "M", volumePacks: null })).toEqual({ status: "cancelled" });
    expect(sizeChangeJson({ status: "unchanged" })).toEqual({ status: "unchanged" });
  });
});

describe("chave de API", () => {
  it("a permissão de cobrança existe e avisa que pode cobrar", () => {
    expect(API_PERMISSIONS).toContain("billing");
    expect(PERMISSION_LABEL.billing).toContain("cartão da assinatura");
  });
});
