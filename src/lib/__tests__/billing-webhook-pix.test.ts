import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const { applyPixCredit, voidPixCredit } = vi.hoisted(() => ({ applyPixCredit: vi.fn(async () => 1), voidPixCredit: vi.fn(async () => true) }));
vi.mock("../billing-credit", async (original) => ({ ...(await original<typeof import("../billing-credit")>()), applyPixCredit, voidPixCredit }));

import { memoryDb } from "../memory-db";
import { handleStripeEvent } from "../billing-webhook";

const session = (type: string, o: Record<string, unknown>) => ({ id: "evt_1", type, data: { object: { object: "checkout.session", metadata: { changeId: "chg1" }, ...o } } }) as unknown as Stripe.Event;

describe("webhook da Stripe: crédito pelo Pix", () => {
  beforeEach(() => {
    applyPixCredit.mockClear();
    voidPixCredit.mockClear();
  });

  it("o pagamento pago põe o crédito, no completed ou no async_payment_succeeded", async () => {
    const db = memoryDb({ billing_changes: [] });
    await handleStripeEvent(db, session("checkout.session.completed", { mode: "payment", payment_status: "paid" }));
    await handleStripeEvent(db, session("checkout.session.async_payment_succeeded", { mode: "payment", payment_status: "paid" }));
    expect(applyPixCredit).toHaveBeenCalledTimes(2);
    expect(applyPixCredit).toHaveBeenCalledWith(db, "chg1");
  });

  it("ainda sem pagamento, ou a assinatura, não mexem no crédito; o vencido anula", async () => {
    const db = memoryDb({ billing_changes: [] });
    await handleStripeEvent(db, session("checkout.session.completed", { mode: "payment", payment_status: "unpaid" }));
    await handleStripeEvent(db, session("checkout.session.completed", { mode: "subscription", payment_status: "paid", subscription: "sub_1" }));
    expect(applyPixCredit).not.toHaveBeenCalled();
    await handleStripeEvent(db, session("checkout.session.expired", { mode: "payment", payment_status: "unpaid" }));
    await handleStripeEvent(db, session("checkout.session.async_payment_failed", { mode: "payment", payment_status: "unpaid" }));
    await handleStripeEvent(db, session("checkout.session.expired", { mode: "subscription", payment_status: "unpaid" }));
    expect(voidPixCredit).toHaveBeenCalledTimes(2);
    expect(voidPixCredit).toHaveBeenCalledWith(db, "chg1");
  });
});
