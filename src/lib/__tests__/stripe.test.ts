import { afterEach, describe, expect, it, vi } from "vitest";

describe("plano a partir do preço do Stripe", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load() {
    vi.stubEnv("STRIPE_PRICE_AGENCIA", "price_agencia");
    return import("../stripe");
  }

  it("preço do plano devolve o plano", async () => {
    const { planFromPrice } = await load();
    expect(planFromPrice("price_agencia")).toBe("agencia");
  });

  it("preço desconhecido ou ausente não é plano", async () => {
    const { planFromPrice } = await load();
    expect(planFromPrice("price_outro")).toBeNull();
    expect(planFromPrice(undefined)).toBeNull();
  });
});
