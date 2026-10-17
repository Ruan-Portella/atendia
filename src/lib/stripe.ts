import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOOKUP_KEYS, monthBoundsBR, targetQuantities, type BillingTarget, type LookupKey } from "./billing";

export const billingEnabled = Boolean(process.env.STRIPE_SECRET_KEY);
export const stripe = billingEnabled ? new Stripe(process.env.STRIPE_SECRET_KEY!) : null;

/**
 * Garante que a agência tem um customer no Stripe e devolve o id.
 * Criado antes da assinatura quando necessário.
 */
export async function ensureStripeCustomer(admin: SupabaseClient, agency: { id: string; name: string; stripe_customer_id: string | null }, email?: string | null): Promise<string> {
  if (agency.stripe_customer_id) return agency.stripe_customer_id;
  if (!stripe) throw new Error("Stripe não configurado.");
  const c = await stripe.customers.create({ email: email ?? undefined, name: agency.name, metadata: { agencyId: agency.id } });
  await admin.from("agencies").update({ stripe_customer_id: c.id }).eq("id", agency.id);
  return c.id;
}

let catalog: { at: number; ids: Record<LookupKey, string> } | null = null;

/**
 * Id de cada preço pela chave de pesquisa (o mesmo código no teste e na produção; sem variável
 * por preço). Guardado por 10 minutos. Falta um preço: erro com o nome dele.
 */
export async function catalogPrices(): Promise<Record<LookupKey, string>> {
  if (catalog && Date.now() - catalog.at < 10 * 60_000) return catalog.ids;
  if (!stripe) throw new Error("Stripe não configurado.");
  const keys = Object.values(LOOKUP_KEYS);
  const { data } = await stripe.prices.list({ lookup_keys: keys, active: true, limit: keys.length });
  const ids = Object.fromEntries(data.map((p) => [p.lookup_key, p.id])) as Record<LookupKey, string>;
  const missing = keys.filter((k) => !ids[k]);
  if (missing.length) throw new Error(`Preço sem cadastro na Stripe: ${missing.join(", ")}`);
  catalog = { at: Date.now(), ids };
  return ids;
}

/** Itens da assinatura para a escolha: quantidade por preço (o excedente é do crédito, fora daqui). */
export function subscriptionItems(target: BillingTarget, ids: Record<LookupKey, string>): Array<{ price: string; quantity: number }> {
  return Object.entries(targetQuantities(target)).map(([k, n]) => ({ price: ids[k as LookupKey], quantity: n }));
}

/**
 * Âncora da fatura (dia 1º seguinte, 00:00 em São Paulo, em segundos) e o prazo do Checkout, que
 * precisa terminar antes dela. Nas últimas 2 horas do mês, a âncora vai para o dia 1º depois.
 */
export function checkoutTiming(now = new Date()): { anchor: number; expiresAt: number } {
  const nowS = Math.floor(now.getTime() / 1000);
  let anchor = Math.floor(monthBoundsBR(now).end.getTime() / 1000);
  if (anchor - nowS < 2 * 3600) anchor = Math.floor(monthBoundsBR(new Date(anchor * 1000 + 3600_000)).end.getTime() / 1000);
  return { anchor, expiresAt: Math.min(nowS + 24 * 3600, anchor - 600) };
}
