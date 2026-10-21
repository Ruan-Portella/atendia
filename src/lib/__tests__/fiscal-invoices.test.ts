import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";
import { setCipherIdentityForTests } from "../field-cipher";

const alerts = vi.hoisted(() => [] as string[]);
vi.mock("../notify", async (orig) => ({
  ...(await orig<typeof import("../notify")>()),
  notifyPlatform: async (subject: string) => {
    alerts.push(subject);
    return true;
  },
}));

import { addressLine, formatTaxId, invoiceRecord, listFiscalInvoices, markFiscalEmitted, paidByAgency, pixRecord, recordFiscalInvoice } from "../fiscal-invoices";
import { AI_COST_ALARM, checkAiCostAlarm, netRevenueBrl, overAlarm } from "../ai-cost-alarm";

beforeEach(() => {
  setCipherIdentityForTests(true);
  alerts.length = 0;
});

const invoice = (o: Partial<Stripe.Invoice> = {}) =>
  ({
    id: "in_1",
    amount_paid: 9900,
    currency: "brl",
    customer: "cus_1",
    customer_name: "Agência Teste Ltda",
    customer_tax_ids: [{ type: "br_cnpj", value: "12345678000195" }],
    customer_address: { line1: "Rua das Flores, 10", line2: "sala 2", city: "Rio de Janeiro", state: "RJ", postal_code: "20000-000", country: "BR" },
    status_transitions: { paid_at: 1_792_540_000 },
    lines: { data: [{ description: "1 × Chatbot M (R$ 99,00 / mês)" }] },
    ...o,
  }) as unknown as Stripe.Invoice;

describe("nota a emitir", () => {
  it("da fatura paga: tomador, CNPJ, endereço, valor e descrição; sem valor, nada", () => {
    const r = invoiceRecord(invoice())!;
    expect(r).toMatchObject({ source: "fatura", stripeRef: "in_1", customerId: "cus_1", amountCents: 9900, takerName: "Agência Teste Ltda", takerTaxType: "br_cnpj", takerTaxId: "12345678000195", description: "1 × Chatbot M (R$ 99,00 / mês)" });
    expect(r.takerAddress).toBe("Rua das Flores, 10, sala 2, Rio de Janeiro / RJ, CEP 20000-000");
    expect(invoiceRecord(invoice({ amount_paid: 0 }))).toBeNull();
  });

  it("do Pix: só a sessão paga", () => {
    const s = { id: "cs_1", mode: "payment", payment_status: "paid", amount_total: 5000, currency: "brl", customer: "cus_1", customer_details: { name: "Ana", tax_ids: [{ type: "br_cpf", value: "52998224725" }], address: null } } as unknown as Stripe.Checkout.Session;
    expect(pixRecord(s)).toMatchObject({ source: "pix", amountCents: 5000, takerTaxType: "br_cpf", description: "Crédito do excedente, válido por 12 meses" });
    expect(pixRecord({ ...s, payment_status: "unpaid" } as Stripe.Checkout.Session)).toBeNull();
  });

  it("máscara do CPF e do CNPJ; endereço vazio vira null", () => {
    expect(formatTaxId("52998224725")).toBe("529.982.247-25");
    expect(formatTaxId("12345678000195")).toBe("12.345.678/0001-95");
    expect(addressLine({ line1: null, line2: null, city: null, state: null, postal_code: null, country: "BR" })).toBeNull();
  });

  it("grava uma vez por pagamento (na conta certa); marcar como emitida só uma vez", async () => {
    const tables: Record<string, MemRow[]> = { agencies: [{ id: "a1", name: "Agência Teste", stripe_customer_id: "cus_1" }], fiscal_invoices: [] };
    const db = memoryDb(tables);
    await recordFiscalInvoice(db, invoiceRecord(invoice()));
    await recordFiscalInvoice(db, invoiceRecord(invoice()));
    expect(tables.fiscal_invoices).toHaveLength(1);
    expect(tables.fiscal_invoices[0]).toMatchObject({ agency_id: "a1", agency_name: "Agência Teste", status: "a_emitir" });
    const [n] = await listFiscalInvoices(db, "a_emitir");
    expect(n.takerTaxId).toBe("12345678000195");
    expect(await markFiscalEmitted(db, n.id, { number: "123", by: "ruan@boavoz.com" })).toBe(true);
    expect(await markFiscalEmitted(db, n.id, { number: "124", by: "ruan@boavoz.com" })).toBe(false);
    expect(tables.fiscal_invoices[0]).toMatchObject({ status: "emitida", number: "123" });
    const paid = await paidByAgency(db, "2020-01-01T00:00:00Z", "2100-01-01T00:00:00Z");
    expect(paid.get("a1")).toEqual({ cents: 9900, payments: 1 });
  });
});

describe("alarme de custo de IA", () => {
  it("receita líquida e o limite de 50%", () => {
    // R$ 99: menos 4,7% e R$ 0,39 da Stripe e 6% de imposto
    expect(netRevenueBrl(9900, 1)).toBeCloseTo(99 - 99 * 0.047 - 0.39 - 99 * 0.06, 5);
    expect(overAlarm(40, 100)).toBe(false);
    expect(overAlarm(60, 100)).toBe(true);
    // sem receita, só com custo de pelo menos R$ 10 (as respostas de teste não avisam)
    expect(overAlarm(AI_COST_ALARM.minCostBrl - 1, 0)).toBe(false);
    expect(overAlarm(AI_COST_ALARM.minCostBrl, 0)).toBe(true);
  });

  it("avisa uma vez por conta e mês", async () => {
    vi.stubEnv("USD_BRL", "5.5");
    const now = new Date("2026-10-20T15:00:00Z");
    const hits = new Map<string, number>();
    const base = memoryDb({
      ai_usage_monthly: [
        { agency_id: "a1", period: "2026-10", kind: "resposta", cost_usd: 20 },
        { agency_id: "a2", period: "2026-10", kind: "resposta", cost_usd: 1 },
      ],
      fiscal_invoices: [
        { id: "f1", agency_id: "a1", amount_cents: 9900, paid_at: "2026-10-05T12:00:00Z" },
        { id: "f2", agency_id: "a2", amount_cents: 19900, paid_at: "2026-10-05T12:00:00Z" },
      ],
      agencies: [{ id: "a1", name: "Agência Cara" }, { id: "a2", name: "Agência Ok" }],
    });
    const db = new Proxy(base, {
      get(t, k) {
        if (k === "rpc")
          return async (_f: string, a: { p_key: string; p_max: number }) => {
            const n = (hits.get(a.p_key) ?? 0) + 1;
            hits.set(a.p_key, n);
            return { data: n <= a.p_max, error: null };
          };
        return Reflect.get(t, k);
      },
    }) as SupabaseClient;
    // a1: US$ 20 × 5,5 × 1,35 = R$ 148,50 contra uns R$ 88 líquidos
    expect((await checkAiCostAlarm(db, now)).alarms).toHaveLength(1);
    expect(alerts).toEqual(["Custo de IA acima de 50% da receita: Agência Cara"]);
    expect((await checkAiCostAlarm(db, now)).alarms).toHaveLength(0);
    vi.unstubAllEnvs();
  });
});
