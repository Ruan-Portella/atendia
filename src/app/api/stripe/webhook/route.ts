import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingEnabled, stripe } from "@/lib/stripe";
import { handleStripeEvent } from "@/lib/billing-webhook";

/** Webhook da Stripe: a compra paga vale e a assinatura da conta acompanha (ver billing-webhook.ts). */
export async function POST(req: Request) {
  if (!billingEnabled || !stripe) return Response.json({ error: "billing_disabled" }, { status: 501 });
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return Response.json({ error: "missing_signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), sig, secret);
  } catch (e) {
    return Response.json({ error: "bad_signature", message: (e as Error).message }, { status: 400 });
  }

  try {
    await handleStripeEvent(createAdminClient(), event);
  } catch (e) {
    // 500: a Stripe entrega o evento de novo (as gravações podem rodar mais de uma vez)
    console.error("stripe webhook:", event.type, event.id, e);
    return Response.json({ error: "handler_failed" }, { status: 500 });
  }
  return Response.json({ received: true });
}
