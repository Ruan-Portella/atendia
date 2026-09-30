import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

type Line = { amount: number; price: string; discounts?: number[] };
const invoice = (amountPaid: number, lines: Line[]) =>
  ({
    amount_paid: amountPaid,
    lines: {
      data: lines.map((l) => ({
        amount: l.amount,
        pricing: { type: "price_details", price_details: { price: l.price, product: "prod" }, unit_amount_decimal: null },
        discount_amounts: (l.discounts ?? []).map((amount) => ({ amount, discount: "d" })),
      })),
    },
  }) as unknown as Pick<Stripe.Invoice, "amount_paid" | "lines">;

describe("base da comissão de afiliado", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load() {
    vi.stubEnv("STRIPE_PRICE_AGENCIA", "price_agencia");
    return import("../stripe");
  }

  it("só a mensalidade do plano, sem pacotes e ajustes", async () => {
    const { planBaseCents } = await load();
    expect(planBaseCents(invoice(39800, [{ amount: 24900, price: "price_agencia" }, { amount: 14900, price: "price_pacote" }]))).toBe(24900);
  });

  it("desconto da linha e crédito usado na fatura reduzem a base", async () => {
    const { planBaseCents } = await load();
    expect(planBaseCents(invoice(19900, [{ amount: 24900, price: "price_agencia", discounts: [2000] }]))).toBe(19900);
    expect(planBaseCents(invoice(0, [{ amount: 24900, price: "price_agencia" }]))).toBe(0);
  });

  it("preço desconhecido não é plano", async () => {
    const { planBaseCents, planFromPrice } = await load();
    expect(planFromPrice("price_outro")).toBeNull();
    expect(planBaseCents(invoice(24900, [{ amount: 24900, price: "price_outro" }]))).toBe(0);
  });
});
