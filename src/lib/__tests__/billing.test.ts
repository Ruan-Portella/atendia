import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appliedBotRow, firstMonthQuota, monthBoundsBR, parseTarget, remainingFraction, sizeMonthlyCents, targetMonthlyCents, targetQuantities, type BillingTarget } from "../billing";
import { checkoutTiming, subscriptionItems } from "../stripe";
import { applyCheckout, billingStatusOf } from "../billing-webhook";
import { botQuota } from "../quota";

const at = (iso: string) => new Date(iso);

describe("mês da cobrança (São Paulo, fatura no dia 1º)", () => {
  it("início, fim e o dia 1º", () => {
    const m = monthBoundsBR(at("2026-10-16T12:00:00Z"));
    expect(m.period).toBe("2026-10");
    expect(m.start.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(m.end.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(m.firstDay).toBe("2026-10-01");
    expect(monthBoundsBR(at("2026-12-20T12:00:00Z")).end.toISOString()).toBe("2027-01-01T03:00:00.000Z");
    // 23h do dia 31 em São Paulo ainda é outubro
    expect(monthBoundsBR(at("2026-11-01T02:00:00Z")).period).toBe("2026-10");
  });

  it("quanto falta do mês, por segundo", () => {
    expect(remainingFraction(at("2026-10-01T03:00:00Z"))).toBe(1);
    expect(remainingFraction(at("2026-10-16T03:00:00Z"))).toBeCloseTo(16 / 31, 6);
    expect(remainingFraction(at("2026-11-01T02:59:59Z"))).toBeGreaterThan(0);
  });

  it("cota do primeiro mês: proporcional, para cima", () => {
    const now = at("2026-10-16T03:00:00Z");
    expect(firstMonthQuota({ size: "P", volumePacks: null }, now)).toBe(83); // 160 × 16/31 = 82,6
    expect(firstMonthQuota({ size: "volume", volumePacks: 2 }, now)).toBe(1033); // 2.000 × 16/31
    expect(firstMonthQuota({ size: null, volumePacks: null }, now)).toBe(0);
  });

  it("a cota proporcional vale só no mês dela", () => {
    const bot = { size: "P", prorated_month: "2026-10-01", prorated_quota: 83 };
    expect(botQuota(bot, "2026-10")).toBe(83);
    expect(botQuota(bot, "2026-11")).toBe(160);
    expect(botQuota({ ...bot, quota_override: 900 }, "2026-10")).toBe(900);
    // sem tamanho (a troca para "sem tamanho" valeu), a proporcional do tamanho antigo não conta
    expect(botQuota({ ...bot, size: null }, "2026-10")).toBe(0);
  });
});

describe("o que a conta assina", () => {
  const target: BillingTarget = {
    bots: [
      { id: "a", size: "P", volumePacks: null },
      { id: "b", size: "P", volumePacks: null },
      { id: "c", size: "M", volumePacks: null },
      { id: "d", size: "volume", volumePacks: 3 },
      { id: "e", size: null, volumePacks: null },
    ],
    packs: ["integracoes"],
  };

  it("preço do mês e quantidade de cada preço na Stripe", () => {
    expect(sizeMonthlyCents({ size: "G", volumePacks: null })).toBe(19_900);
    expect(sizeMonthlyCents({ size: "volume", volumePacks: 3 })).toBe(89_700);
    expect(targetMonthlyCents(target)).toBe(4900 * 2 + 9900 + 89_700 + 4900);
    expect(targetQuantities(target)).toEqual({ boavoz_bot_p: 2, boavoz_bot_m: 1, boavoz_bot_volume: 3, boavoz_integracoes: 1 });
  });

  it("itens da assinatura: com quantidade (o excedente sai do crédito, fora da assinatura)", () => {
    const ids = Object.fromEntries(["boavoz_bot_p", "boavoz_bot_m", "boavoz_bot_g", "boavoz_bot_volume", "boavoz_dominio", "boavoz_integracoes", "boavoz_plataforma"].map((k) => [k, `price_${k}`]));
    expect(subscriptionItems(target, ids as never)).toEqual([
      { price: "price_boavoz_bot_p", quantity: 2 },
      { price: "price_boavoz_bot_m", quantity: 1 },
      { price: "price_boavoz_bot_volume", quantity: 3 },
      { price: "price_boavoz_integracoes", quantity: 1 },
    ]);
  });

  it("formulário: tamanho por chatbot, pacotes do Volume e pacotes da conta", () => {
    const fd = new FormData();
    fd.set("size:a", "P");
    fd.set("size:b", "");
    fd.set("size:c", "volume");
    fd.set("packs:c", "2");
    fd.set("size:intruso", "G");
    fd.append("pack", "integracoes");
    fd.append("pack", "plataforma");
    expect(parseTarget(fd, ["a", "b", "c"])).toEqual({
      bots: [
        { id: "a", size: "P", volumePacks: null },
        { id: "b", size: null, volumePacks: null },
        { id: "c", size: "volume", volumePacks: 2 },
      ],
      packs: ["integracoes", "plataforma"],
    });
  });

  it("formulário: recusa Plataforma sem Integrações, Volume sem pacote e tamanho inválido", () => {
    const plat = new FormData();
    plat.append("pack", "plataforma");
    expect(parseTarget(plat, [])).toEqual({ error: "O pacote Plataforma precisa do Integrações." });
    const vol = new FormData();
    vol.set("size:a", "volume");
    vol.set("packs:a", "0");
    expect("error" in parseTarget(vol, ["a"])).toBe(true);
    const bad = new FormData();
    bad.set("size:a", "XL");
    expect("error" in parseTarget(bad, ["a"])).toBe(true);
  });
});

describe("Checkout: âncora no dia 1º", () => {
  const s = (iso: string) => Date.parse(iso) / 1000;
  it("meio do mês: âncora no dia 1º seguinte e o prazo de 24 horas", () => {
    const now = at("2026-10-16T12:00:00Z");
    expect(checkoutTiming(now)).toEqual({ anchor: s("2026-11-01T03:00:00Z"), expiresAt: s("2026-10-17T12:00:00Z") });
  });
  it("4 horas antes da virada: o prazo termina antes da âncora", () => {
    expect(checkoutTiming(at("2026-10-31T23:00:00Z"))).toEqual({ anchor: s("2026-11-01T03:00:00Z"), expiresAt: s("2026-11-01T02:50:00Z") });
  });
  it("nas últimas 2 horas do mês: âncora no dia 1º depois", () => {
    expect(checkoutTiming(at("2026-11-01T02:00:00Z")).anchor).toBe(s("2026-12-01T03:00:00Z"));
  });
});

describe("webhook da Stripe", () => {
  it("situação da conta pela da assinatura", () => {
    expect(billingStatusOf("active")).toBe("active");
    expect(billingStatusOf("trialing")).toBe("active");
    expect(billingStatusOf("past_due")).toBe("past_due");
    expect(billingStatusOf("unpaid")).toBe("past_due");
    expect(billingStatusOf("incomplete")).toBeNull();
    expect(billingStatusOf("canceled")).toBe("none");
    expect(billingStatusOf("incomplete_expired")).toBe("none");
  });

  function fakeDb(status: string) {
    const rpc: Array<[string, Record<string, unknown>]> = [];
    const inserts: Array<[string, unknown]> = [];
    const updates: Array<[string, unknown]> = [];
    const change = { id: "chg", agency_id: "ag", status, target: { bots: [{ id: "a", size: "P", volumePacks: null }, { id: "b", size: null, volumePacks: null }], packs: ["dominio"] } };
    const db = {
      from: (t: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: change, error: null }) }), in: async () => ({ data: [], error: null }) }),
        insert: async (row: unknown) => (inserts.push([t, row]), { error: null }),
        update: (row: unknown) => ({ eq: async () => (updates.push([t, row]), { error: null }) }),
      }),
      rpc: async (fn: string, args: Record<string, unknown>) => (rpc.push([fn, args]), { data: true, error: null }),
    } as unknown as SupabaseClient;
    return { db, rpc, inserts, updates };
  }

  it("compra paga: aplica tamanhos, cota proporcional, pacotes e a assinatura, e audita", async () => {
    const { db, rpc, inserts, updates } = fakeDb("pending");
    const now = at("2026-10-16T03:00:00Z");
    expect(await applyCheckout(db, "chg", "sub_1", now)).toBe(true);
    // o pagamento que abre a assinatura abre os 7 dias da desistência
    expect(updates).toEqual([["agencies", { first_paid_at: now.toISOString(), withdrawn_at: null }]]);
    expect(rpc[0][0]).toBe("apply_billing_change");
    expect(rpc[0][1]).toEqual({
      p_change_id: "chg",
      p_bots: [
        { id: "a", size: "P", volume_packs: null, prorated_month: "2026-10-01", prorated_quota: 83 },
        { id: "b", size: null, volume_packs: null, prorated_month: null, prorated_quota: null },
      ],
      p_packs: ["dominio"],
      p_replace_packs: true,
      p_subscription_id: "sub_1",
    });
    expect(appliedBotRow({ id: "a", size: "P", volumePacks: null }, now)).toEqual(rpc[0][1].p_bots && (rpc[0][1].p_bots as unknown[])[0]);
    expect(inserts.map(([t, row]) => [t, (row as { action: string }).action])).toEqual([["audit_log", "assinatura.ativar"]]);
  });

  it("compra já aplicada (evento repetido): não aplica de novo", async () => {
    const { db, rpc } = fakeDb("applied");
    expect(await applyCheckout(db, "chg", "sub_1")).toBe(false);
    expect(rpc).toEqual([]);
  });
});
