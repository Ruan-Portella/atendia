import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appliedBotRow, type BillingTarget } from "./billing";
import { audit } from "./audit";
import { applyUpgrade, syncSubscriptionSafe } from "./billing-sync";
import { applyCredit } from "./billing-credit";

/*
 * Eventos da Stripe (revisão de preços, parte 4): a compra paga vale (uma vez só), inclusive a
 * subida paga numa fatura avulsa; a situação da assinatura acompanha (pagamento atrasado suspende
 * o excedente); item mexido fora do BoaVoz volta ao que o BoaVoz guarda; e o fim da assinatura
 * tira o tamanho dos chatbots (a configuração fica guardada). Erro do banco vira exceção: o webhook
 * devolve 500 e a Stripe entrega de novo (tudo aqui pode rodar mais de uma vez).
 */

function must<T extends { error: unknown }>(r: T): T {
  if (r.error) throw r.error;
  return r;
}

const customerOf = (c: string | { id: string }) => (typeof c === "string" ? c : c.id);

/** Situação da conta pela da assinatura; null = ainda não vale (primeiro pagamento pendente). */
export function billingStatusOf(status: Stripe.Subscription.Status): "active" | "past_due" | "none" | null {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "incomplete") return null;
  return "none";
}

/** Aplica a compra do Checkout: tamanhos, cota proporcional do mês, pacotes e a assinatura. */
export async function applyCheckout(db: SupabaseClient, changeId: string, subscriptionId: string | null, now = new Date()): Promise<boolean> {
  const { data: change } = must(await db.from("billing_changes").select("id, agency_id, target, status").eq("id", changeId).maybeSingle());
  if (!change || change.status !== "pending") return false;
  const target = change.target as BillingTarget;
  const { data: applied } = must(
    await db.rpc("apply_billing_change", { p_change_id: changeId, p_bots: target.bots.map((b) => appliedBotRow(b, now)), p_packs: target.packs, p_replace_packs: true, p_subscription_id: subscriptionId }),
  );
  if (applied) {
    await audit(db, {
      agencyId: change.agency_id as string,
      actorType: "system",
      actorId: null,
      action: "assinatura.ativar",
      targetType: "agency",
      targetId: change.agency_id as string,
      after: { chatbots: target.bots.filter((b) => b.size).map((b) => ({ id: b.id, tamanho: b.size, pacotes: b.volumePacks })), pacotes: target.packs },
    });
  }
  return Boolean(applied);
}

/** Fim da assinatura: os chatbots ficam sem tamanho (sem cota) e os pacotes saem. */
export async function endSubscription(db: SupabaseClient, customer: string): Promise<void> {
  const { data: agencies } = must(await db.from("agencies").update({ billing_status: "none", stripe_subscription_id: null }).eq("stripe_customer_id", customer).select("id"));
  for (const a of agencies ?? []) {
    const id = a.id as string;
    must(await db.from("bots").update({ size: null, volume_packs: null, pending_size: null, pending_volume_packs: null, pending_from: null, prorated_month: null, prorated_quota: null }).eq("agency_id", id));
    must(await db.from("agency_packs").delete().eq("agency_id", id));
    await audit(db, { agencyId: id, actorType: "system", actorId: null, action: "assinatura.encerrar", targetType: "agency", targetId: id });
  }
}

export async function handleStripeEvent(db: SupabaseClient, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      const changeId = s.metadata?.changeId;
      if (!changeId || s.mode !== "subscription" || s.payment_status === "unpaid") break;
      const sub = typeof s.subscription === "string" ? s.subscription : (s.subscription?.id ?? null);
      await applyCheckout(db, changeId, sub);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const customer = customerOf(sub.customer);
      const status = billingStatusOf(sub.status);
      if (status === null) break;
      if (status === "none") {
        await endSubscription(db, customer);
        break;
      }
      const { data: agencies } = must(await db.from("agencies").update({ billing_status: status, stripe_subscription_id: sub.id }).eq("stripe_customer_id", customer).select("id"));
      // virada do mês: as trocas agendadas para o dia 1º valem
      for (const a of agencies ?? []) must(await db.rpc("apply_due_bot_changes", { p_agency_id: a.id }));
      // itens mudados (por nós ou no painel da Stripe): a assinatura fica igual ao que o BoaVoz guarda
      const changedItems = event.type === "customer.subscription.updated" && "items" in ((event.data.previous_attributes ?? {}) as Record<string, unknown>);
      if (changedItems) for (const a of agencies ?? []) await syncSubscriptionSafe(db, a.id as string);
      break;
    }
    case "invoice.paid": {
      // fatura avulsa paga depois na página da Stripe (cartão recusado na hora): subida ou crédito
      const changeId = event.data.object.metadata?.changeId;
      if (!changeId) break;
      const { data: change } = must(await db.from("billing_changes").select("kind").eq("id", changeId).maybeSingle());
      if (change?.kind === "upgrade") await applyUpgrade(db, changeId);
      else if (change?.kind === "credit" || change?.kind === "recarga") await applyCredit(db, changeId, change.kind === "recarga" ? "recarga" : "compra");
      break;
    }
    case "customer.subscription.deleted":
      await endSubscription(db, customerOf(event.data.object.customer));
      break;
  }
}
