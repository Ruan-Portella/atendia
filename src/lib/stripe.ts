import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanId } from "./plans";

export const billingEnabled = Boolean(process.env.STRIPE_SECRET_KEY);
export const stripe = billingEnabled ? new Stripe(process.env.STRIPE_SECRET_KEY!) : null;

/**
 * Garante que a agência tem um customer no Stripe e devolve o id.
 * Criado antes da assinatura quando necessário (ex.: crédito de indicação esperando a primeira fatura).
 */
export async function ensureStripeCustomer(admin: SupabaseClient, agency: { id: string; name: string; stripe_customer_id: string | null }, email?: string | null): Promise<string> {
  if (agency.stripe_customer_id) return agency.stripe_customer_id;
  if (!stripe) throw new Error("Stripe não configurado.");
  const c = await stripe.customers.create({ email: email ?? undefined, name: agency.name, metadata: { agencyId: agency.id } });
  await admin.from("agencies").update({ stripe_customer_id: c.id }).eq("id", agency.id);
  return c.id;
}

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
