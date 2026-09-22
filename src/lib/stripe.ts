import Stripe from "stripe";
import type { PlanId } from "./plans";

export const billingEnabled = Boolean(process.env.STRIPE_SECRET_KEY);
export const stripe = billingEnabled ? new Stripe(process.env.STRIPE_SECRET_KEY!) : null;

const PRICES: Record<string, string | undefined> = {
  freelancer: process.env.STRIPE_PRICE_FREELANCER,
  agencia: process.env.STRIPE_PRICE_AGENCIA,
  escala: process.env.STRIPE_PRICE_ESCALA,
};

export function priceFor(plan: string): string | undefined {
  return PRICES[plan];
}

export function planFromPrice(priceId: string | undefined): PlanId | null {
  if (!priceId) return null;
  const hit = Object.entries(PRICES).find(([, v]) => v === priceId);
  return (hit?.[0] as PlanId | undefined) ?? null;
}
