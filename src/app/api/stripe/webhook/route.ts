import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingEnabled, planBaseCents, planFromPrice, stripe } from "@/lib/stripe";
import { notifyPlatform } from "@/lib/notify";
import { REFERRAL_RATE } from "@/lib/referral-credit";
import { applyPlanLimits } from "@/lib/plan-limits";

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
  try {
    await handle(db, event);
  } catch (e) {
    // 500: o Stripe entrega o evento de novo (a comissão é por fatura, então repetir não dobra)
    console.error("stripe webhook:", event.type, event.id, e);
    return Response.json({ error: "handler_failed" }, { status: 500 });
  }
  return Response.json({ received: true });
}

/** Erro do banco vira exceção (antes era ignorado e o evento se perdia). */
function must<T extends { error: unknown }>(r: T): T {
  if (r.error) throw r.error;
  return r;
}

async function handle(db: SupabaseClient, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      const agencyId = s.metadata?.agencyId ?? s.client_reference_id;
      const plan = s.metadata?.plan;
      if (!agencyId || !plan) break;
      const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
      must(await db.from("agencies").update({ plan, stripe_subscription_id: subId ?? null }).eq("id", agencyId));
      must(await db.from("referrals").update({ status: "paying" }).eq("referred_id", agencyId));
      // troca de plano: o excedente pausa (downgrade) e o que estava pausado volta (upgrade)
      await applyPlanLimits(db, agencyId);
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const priceId = sub.items.data[0]?.price.id;
      const plan = planFromPrice(priceId);
      const active = ["active", "trialing", "past_due"].includes(sub.status);
      if (active && !plan) {
        // preço que não é de nenhum plano (env trocada, preço novo no Stripe): mantém o plano
        // atual em vez de cancelar uma agência que está pagando, e avisa quem opera
        must(await db.from("agencies").update({ stripe_subscription_id: sub.id }).eq("stripe_customer_id", customer));
        await notifyPlatform("Preço do Stripe não reconhecido", [
          `Assinatura ${sub.id} (cliente ${customer}) está ativa com o preço ${priceId ?? "(sem preço)"}, que não bate com STRIPE_PRICE_FREELANCER/AGENCIA/ESCALA.`,
          "O plano da agência foi mantido como estava. Confira as variáveis de preço na Vercel e o produto no Stripe.",
        ]);
        break;
      }
      const { data: changed } = must(await db.from("agencies").update({ plan: active && plan ? plan : "cancelado", stripe_subscription_id: sub.id }).eq("stripe_customer_id", customer).select("id"));
      for (const ag of changed ?? []) await applyPlanLimits(db, ag.id as string);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const { data: ag } = must(await db.from("agencies").update({ plan: "cancelado", stripe_subscription_id: null }).eq("stripe_customer_id", customer).select("id").maybeSingle());
      if (ag) must(await db.from("referrals").update({ status: "churned" }).eq("referred_id", ag.id));
      break;
    }
    case "invoice.paid": {
      // Comissão recorrente para quem indicou: 30% da mensalidade do plano que a agência
      // indicada pagou de fato. Uma linha por fatura: o mesmo evento repetido não paga de novo.
      const inv = event.data.object;
      const customer = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
      if (!customer || !inv.id) break;
      const { data: ag } = must(await db.from("agencies").select("id").eq("stripe_customer_id", customer).maybeSingle());
      if (!ag) break;
      const { data: ref } = must(await db.from("referrals").select("id").eq("referred_id", ag.id).maybeSingle());
      if (!ref) break;
      const base = planBaseCents(inv);
      const commission = Math.round(base * REFERRAL_RATE);
      if (commission > 0) {
        must(await db.from("referral_commissions").upsert({ invoice_id: inv.id, referral_id: ref.id, base_cents: base, commission_cents: commission }, { onConflict: "invoice_id", ignoreDuplicates: true }));
      }
      const { data: rows } = must(await db.from("referral_commissions").select("commission_cents").eq("referral_id", ref.id));
      const total = (rows ?? []).reduce((t, r) => t + r.commission_cents, 0);
      must(await db.from("referrals").update({ status: "paying", commission_cents: total }).eq("id", ref.id));
      break;
    }
  }
}
