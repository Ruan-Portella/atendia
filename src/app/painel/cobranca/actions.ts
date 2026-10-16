"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgency } from "@/lib/agency";
import { can } from "@/lib/team";
import { fail, type ActionResult } from "@/lib/action-result";
import { parseTarget, targetMonthlyCents } from "@/lib/billing";
import { billingEnabled, catalogPrices, checkoutTiming, ensureStripeCustomer, stripe, subscriptionItems } from "@/lib/stripe";
import { appUrl } from "@/lib/utils";

const DENIED = "O seu papel na equipe não permite mexer na cobrança. Fale com o dono ou com um administrador da agência.";
const OFF = "A cobrança ainda não está configurada neste servidor.";

/**
 * Primeira assinatura (revisão de preços, parte 4a): o tamanho de cada chatbot e os pacotes vão
 * para o Checkout da Stripe, com a fatura no dia 1º e o primeiro mês proporcional. A compra fica
 * guardada (billing_changes) e só vale quando a Stripe confirma o pagamento (webhook).
 * Chatbots com cota sob medida ficam fora: o preço deles é combinado à parte.
 */
export async function startCheckout(fd: FormData): Promise<ActionResult> {
  const ctx = await requireAgency();
  if (!can(ctx.role, "billing")) return fail(DENIED);
  if (!billingEnabled || !stripe) return fail(OFF);
  if (ctx.agency.billing_status !== "none") return fail("A conta já tem assinatura. Recarregue a página.");
  const db = createAdminClient();
  const { data: bots } = await db.from("bots").select("id").eq("agency_id", ctx.agency.id).eq("is_demo", false).is("quota_override", null);
  const target = parseTarget(fd, (bots ?? []).map((b) => b.id as string));
  if ("error" in target) return fail(target.error);
  if (!target.bots.some((b) => b.size)) return fail("Escolha o tamanho de pelo menos um chatbot.");

  let url: string;
  try {
    const ids = await catalogPrices();
    const customer = await ensureStripeCustomer(db, ctx.agency, ctx.email);
    const { data: change, error } = await db.from("billing_changes").insert({ agency_id: ctx.agency.id, kind: "checkout", target, amount_cents: targetMonthlyCents(target), created_by: ctx.userId }).select("id").single();
    if (error || !change) throw new Error(error?.message ?? "compra não gravada");
    const { anchor, expiresAt } = checkoutTiming();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: ctx.agency.id,
      line_items: subscriptionItems(target, ids),
      payment_method_types: ["card"],
      success_url: appUrl("/painel/cobranca?ok=1"),
      cancel_url: appUrl("/painel/cobranca"),
      expires_at: expiresAt,
      metadata: { agencyId: ctx.agency.id, changeId: change.id as string },
      subscription_data: { billing_cycle_anchor: anchor, proration_behavior: "create_prorations", metadata: { agencyId: ctx.agency.id } },
      allow_promotion_codes: true,
      locale: "pt-BR",
    });
    await db.from("billing_changes").update({ stripe_ref: session.id }).eq("id", change.id);
    if (!session.url) throw new Error("Checkout sem URL");
    url = session.url;
  } catch (e) {
    console.error("cobrança: checkout", e);
    return fail("Não foi possível abrir o pagamento agora. Tente de novo em instantes.");
  }
  redirect(url);
}

/** Portal da Stripe: cartão, faturas e cancelar no fim do período. */
export async function openBillingPortal(): Promise<ActionResult> {
  const ctx = await requireAgency();
  if (!can(ctx.role, "billing")) return fail(DENIED);
  if (!billingEnabled || !stripe) return fail(OFF);
  if (!ctx.agency.stripe_customer_id) return fail("Ainda não há assinatura.");
  let url: string;
  try {
    url = (await stripe.billingPortal.sessions.create({ customer: ctx.agency.stripe_customer_id, return_url: appUrl("/painel/cobranca"), locale: "pt-BR" })).url;
  } catch (e) {
    console.error("cobrança: portal", e);
    return fail("Não foi possível abrir o portal de pagamento agora. Tente de novo em instantes.");
  }
  redirect(url);
}
