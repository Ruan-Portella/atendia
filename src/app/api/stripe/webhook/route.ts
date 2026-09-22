import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingEnabled, planFromPrice, stripe } from "@/lib/stripe";
import { PLANS } from "@/lib/plans";
import { REFERRAL_RATE } from "@/lib/referral-credit";

/** Webhook do Stripe: mantém o plano da agência e a comissão de afiliado em dia. */
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

  const db = createAdminClient();
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      const agencyId = s.metadata?.agencyId ?? s.client_reference_id;
      const plan = s.metadata?.plan;
      if (!agencyId || !plan) break;
      const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
      await db.from("agencies").update({ plan, stripe_subscription_id: subId ?? null }).eq("id", agencyId);
      await db.from("referrals").update({ status: "paying" }).eq("referred_id", agencyId);
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const plan = planFromPrice(sub.items.data[0]?.price.id);
      const active = ["active", "trialing", "past_due"].includes(sub.status);
      await db.from("agencies").update({ plan: active && plan ? plan : "cancelado", stripe_subscription_id: sub.id }).eq("stripe_customer_id", customer);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const { data: ag } = await db.from("agencies").update({ plan: "cancelado", stripe_subscription_id: null }).eq("stripe_customer_id", customer).select("id").maybeSingle();
      if (ag) await db.from("referrals").update({ status: "churned" }).eq("referred_id", ag.id);
      break;
    }
    case "invoice.paid": {
      // Comissão recorrente para quem indicou: 30% do que a agência indicada pagou de fato
      // (se ela usou crédito de indicação na fatura, a comissão é sobre o valor líquido).
      const inv = event.data.object;
      const customer = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
      if (!customer) break;
      const { data: ag } = await db.from("agencies").select("id, plan").eq("stripe_customer_id", customer).maybeSingle();
      if (!ag) break;
      const { data: ref } = await db.from("referrals").select("id, commission_cents").eq("referred_id", ag.id).maybeSingle();
      if (!ref) break;
      const paidCents = inv.amount_paid ?? Math.round(((PLANS as Record<string, { priceBrl: number }>)[ag.plan]?.priceBrl ?? 0) * 100);
      const commission = Math.round(paidCents * REFERRAL_RATE);
      if (commission > 0) await db.from("referrals").update({ status: "paying", commission_cents: ref.commission_cents + commission }).eq("id", ref.id);
      else await db.from("referrals").update({ status: "paying" }).eq("id", ref.id);
      break;
    }
  }
  return Response.json({ received: true });
}
