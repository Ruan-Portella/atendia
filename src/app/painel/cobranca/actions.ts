"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgency, type AgencyContext } from "@/lib/agency";
import { can } from "@/lib/team";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { choiceLabel, monthBoundsBR, packChargeCents, packsRemovedWith, parseTarget, renewalLabel, targetMonthlyCents, type BillingTarget } from "@/lib/billing";
import { syncSubscriptionSafe, voidPendingUpgrades } from "@/lib/billing-sync";
import { BillingOpError, changeSize, chargeUpgrade, type BillingActor, type SizeChange, type SubscribedAccount } from "@/lib/billing-ops";
import { parseAutoRecharge, parseCreditBrl, pixAmountProblem, purchaseCredit, startPixCredit } from "@/lib/billing-credit";
import { billingEnabled, catalogPrices, checkoutTiming, ensureStripeCustomer, stripe, subscriptionItems } from "@/lib/stripe";
import { unpaidInvoices } from "@/lib/billing-view";
import { emitOverageChanged } from "@/lib/billing-events";
import { PACKS, brlCents, isPackId } from "@/lib/plans";
import { audit, requestMeta } from "@/lib/audit";
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
  // a assinatura anterior terminou sem pagar: primeiro a fatura em aberto
  const unpaid = await unpaidInvoices(ctx.agency.stripe_customer_id);
  if (unpaid.length) return fail(`Há ${unpaid.length === 1 ? "uma fatura" : `${unpaid.length} faturas`} da assinatura anterior sem pagamento (${brlCents(unpaid.reduce((t, i) => t + i.totalCents, 0) / 100)}). Pague nesta tela para assinar de novo.`);
  const db = createAdminClient();
  const { data: bots } = await db.from("bots").select("id").eq("agency_id", ctx.agency.id).eq("is_demo", false).eq("is_template", false).is("quota_override", null);
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

/* ------------------------------------------------------------------ trocas com assinatura (parte 4b) */

const PAST_DUE = "O último pagamento está em aberto. Pague a fatura em Pagamento e faturas antes de subir um tamanho ou assinar um pacote.";
const PAID_MEANWHILE = "Uma cobrança anterior acabou de ser paga e já valeu. Confira a tela e escolha de novo.";

/** Conta com assinatura e permissão de cobrança, ou o motivo da recusa. */
async function subscribed(): Promise<{ ctx: AgencyContext; customer: string; subscription: string } | { error: string }> {
  const ctx = await requireAgency();
  if (!can(ctx.role, "billing")) return { error: DENIED };
  if (!billingEnabled || !stripe) return { error: OFF };
  const { agency } = ctx;
  if (agency.billing_status === "none" || !agency.stripe_customer_id || !agency.stripe_subscription_id) return { error: "A conta ainda não tem assinatura." };
  return { ctx, customer: agency.stripe_customer_id, subscription: agency.stripe_subscription_id };
}

/** A conta da sessão no formato das operações de cobrança. */
const accountOf = (s: { ctx: AgencyContext; customer: string; subscription: string }): SubscribedAccount => ({ id: s.ctx.agency.id, billing_status: s.ctx.agency.billing_status, stripe_customer_id: s.customer, stripe_subscription_id: s.subscription });
const actorOf = async (ctx: AgencyContext): Promise<BillingActor> => ({ type: "user", id: ctx.userId, meta: await requestMeta() });

async function auditBilling(ctx: AgencyContext, action: string, target: { type: string; id: string }, change: { before?: Record<string, unknown>; after?: Record<string, unknown> }) {
  await audit(createAdminClient(), { agencyId: ctx.agency.id, actorType: "user", actorId: ctx.userId, action, targetType: target.type, targetId: target.id, ...change, ...(await requestMeta()) });
}

/**
 * Troca o tamanho de um chatbot numa conta com assinatura (a regra fica em billing-ops, a mesma da
 * API): subir cobra agora a diferença proporcional; descer ou tirar fica para o dia 1º; voltar ao
 * tamanho atual cancela a troca agendada. Cartão recusado: abre a fatura na Stripe para pagar.
 */
export async function changeBotSize(botId: string, fd: FormData): Promise<ActionResult> {
  const s = await subscribed();
  if ("error" in s) return fail(s.error);
  const { ctx } = s;
  // a sessão confere o escopo de quem está logado; a troca roda pela service role
  const { data: visible } = await (await createClient()).from("bots").select("id, name").eq("id", botId).maybeSingle();
  if (!visible) return fail("Chatbot não encontrado.");
  const parsed = parseTarget(fd, [botId]);
  if ("error" in parsed) return fail(parsed.error);
  const next = parsed.bots[0];
  const renewal = renewalLabel();
  const name = visible.name as string;
  let r: SizeChange;
  try {
    r = await changeSize(createAdminClient(), accountOf(s), botId, next, await actorOf(ctx));
  } catch (e) {
    if (e instanceof BillingOpError) return fail(e.message);
    console.error("cobrança: troca de tamanho", e);
    return fail("Não foi possível cobrar agora. Tente de novo em instantes.");
  }
  if (r.status === "unchanged") return ok("Nada mudou.");
  if (r.status === "already_scheduled") return ok(`Essa troca já está agendada para ${renewal}.`);
  revalidatePath("/painel", "layout");
  if (r.status === "paid_meanwhile") return ok(PAID_MEANWHILE);
  if (r.status === "cancelled") return ok(`Troca agendada cancelada: ${name} segue ${choiceLabel(r)}.`);
  if (r.status === "scheduled") {
    return ok(
      r.size
        ? `${name} fica ${choiceLabel(r)} a partir de ${renewal}. Até lá, segue com o tamanho e a cota de agora.`
        : `${name} fica sem tamanho a partir de ${renewal}: nesse dia, o WhatsApp e o Instagram dele desconectam. Até lá, segue com o tamanho e a cota de agora.`,
    );
  }
  if (r.status === "applied") {
    return ok(r.deferred ? `Pronto: ${name} já está ${choiceLabel(r)}. A diferença (${brlCents(r.amountCents / 100)}) vem na fatura de ${renewal}.` : `Pronto: ${name} já está ${choiceLabel(r)}. Cobramos ${brlCents(r.amountCents / 100)} agora, proporcional até ${renewal}.`);
  }
  if (!r.url) return fail("O cartão não foi cobrado. Atualize o cartão em Pagamento e faturas e tente de novo.");
  // cartão recusado ou pedindo autenticação: paga na página da Stripe; vale quando ela confirmar
  redirect(r.url);
}

/** Cobra a subida de um pacote e aplica se pagou; cartão recusado abre a fatura na Stripe. */
async function chargeAndApply(ctx: AgencyContext, s: { customer: string; subscription: string }, target: BillingTarget, amountCents: number, description: string, doneText: string): Promise<ActionResult> {
  let url: string | null = null;
  try {
    const r = await chargeUpgrade(createAdminClient(), accountOf({ ctx, ...s }), target, amountCents, description, await actorOf(ctx));
    if (r.status !== "open") {
      revalidatePath("/painel", "layout");
      return ok(
        r.status === "paid"
          ? `Pronto: ${doneText}. Cobramos ${brlCents(amountCents / 100)} agora, proporcional até ${renewalLabel()}.`
          : `Pronto: ${doneText}. A diferença (${brlCents(amountCents / 100)}) vem na fatura de ${renewalLabel()}.`,
      );
    }
    url = r.url;
  } catch (e) {
    console.error("cobrança: subida", e);
    return fail("Não foi possível cobrar agora. Tente de novo em instantes.");
  }
  if (!url) return fail("O cartão não foi cobrado. Atualize o cartão em Pagamento e faturas e tente de novo.");
  // cartão recusado ou pedindo autenticação: paga na página da Stripe; vale quando ela confirmar
  redirect(url);
}

/** Assina um pacote (cobra agora o proporcional) ou tira (fica ativo até o dia 1º). */
export async function changePack(pack: string, on: boolean): Promise<ActionResult> {
  const s = await subscribed();
  if ("error" in s) return fail(s.error);
  const { ctx } = s;
  if (!isPackId(pack)) return fail("Pacote inválido.");
  const db = createAdminClient();
  await db.rpc("apply_due_bot_changes", { p_agency_id: ctx.agency.id });
  const { data: rows } = await db.from("agency_packs").select("pack, ends_at").eq("agency_id", ctx.agency.id);
  const state = new Map((rows ?? []).map((r) => [r.pack as string, (r.ends_at as string | null) ?? null]));
  const renewal = renewalLabel();
  const info = PACKS[pack];

  if (!on) {
    const removing = packsRemovedWith(pack).filter((p) => state.has(p) && !state.get(p));
    if (!removing.length) return ok(`${info.name} já sai em ${renewal}.`);
    if (await voidPendingUpgrades(db, ctx.agency.id, (t) => t.packs.some((p) => removing.includes(p)))) return ok(PAID_MEANWHILE);
    const { error } = await db.from("agency_packs").update({ ends_at: monthBoundsBR().end.toISOString() }).eq("agency_id", ctx.agency.id).in("pack", removing);
    if (error) return fail("Não foi possível salvar. Tente de novo.");
    await syncSubscriptionSafe(db, ctx.agency.id);
    await auditBilling(ctx, "assinatura.pacote_tirar", { type: "agency", id: ctx.agency.id }, { after: { pacotes: removing, ate: renewal } });
    revalidatePath("/painel", "layout");
    const names = removing.map((p) => PACKS[p].name).join(" e ");
    return ok(removing.length > 1 ? `${names} ficam ativos até ${renewal}.` : `${names} fica ativo até ${renewal}.`);
  }

  if (state.has(pack)) {
    if (!state.get(pack)) return ok(`${info.name} já está ativo.`);
    // já pago até o dia 1º: só desfaz a saída
    const { error } = await db.from("agency_packs").update({ ends_at: null }).eq("agency_id", ctx.agency.id).eq("pack", pack);
    if (error) return fail("Não foi possível salvar. Tente de novo.");
    await syncSubscriptionSafe(db, ctx.agency.id);
    await auditBilling(ctx, "assinatura.pacote_manter", { type: "agency", id: ctx.agency.id }, { after: { pacote: pack } });
    revalidatePath("/painel", "layout");
    return ok(`${info.name} continua.`);
  }
  const need = info.requires;
  if (need && (!state.has(need) || state.get(need))) return fail(`${info.name} precisa do ${PACKS[need].name} ativo. Assine o ${PACKS[need].name} antes.`);
  if (ctx.agency.billing_status === "past_due") return fail(PAST_DUE);
  if (await voidPendingUpgrades(db, ctx.agency.id, (t) => t.packs.includes(pack))) return ok(PAID_MEANWHILE);
  return chargeAndApply(ctx, s, { bots: [], packs: [pack] }, packChargeCents(pack), `Pacote ${info.name}, proporcional até ${renewal}`, `${info.name} já está ativo`);
}

/* ------------------------------------------------------------------ crédito do excedente (parte 4c) */

/**
 * Compra crédito (R$ 50 a R$ 50.000, válido por 12 meses, sem reembolso): no cartão da assinatura,
 * cobrado na hora, ou pelo Pix (até R$ 10.000), na página de pagamento da Stripe; o crédito do Pix
 * entra quando a Stripe confirma (webhook).
 */
export async function buyCredit(fd: FormData): Promise<ActionResult> {
  const s = await subscribed();
  if ("error" in s) return fail(s.error);
  const { ctx } = s;
  const raw = String(fd.get("amount") ?? "") === "outro" ? String(fd.get("other") ?? "") : String(fd.get("amount") ?? "");
  const cents = parseCreditBrl(raw);
  if (cents === null) return fail(`Escolha um valor de ${brlCents(50)} a ${brlCents(50_000)}, em reais inteiros.`);
  if (fd.get("via") === "pix") {
    const problem = pixAmountProblem(cents);
    if (problem) return fail(problem);
    let pixUrl: string;
    try {
      pixUrl = await startPixCredit(createAdminClient(), { id: ctx.agency.id, stripe_customer_id: s.customer }, cents, ctx.userId);
    } catch (e) {
      console.error("crédito: pix", e);
      return fail("Não foi possível abrir o Pix agora. Tente de novo em instantes.");
    }
    redirect(pixUrl);
  }
  let url: string | null = null;
  try {
    const r = await purchaseCredit(createAdminClient(), { id: ctx.agency.id, stripe_customer_id: s.customer, stripe_subscription_id: s.subscription }, cents, "compra", ctx.userId);
    if (r.status === "paid") {
      revalidatePath("/painel", "layout");
      return ok(`Crédito de ${brlCents(cents / 100)} comprado. Saldo: ${brlCents(r.balanceCents / 100)}.`);
    }
    url = r.url;
  } catch (e) {
    console.error("crédito: compra", e);
    return fail("Não foi possível cobrar agora. Tente de novo em instantes.");
  }
  if (!url) return fail("O cartão não foi cobrado. Atualize o cartão em Pagamento e faturas e tente de novo.");
  // cartão recusado ou pedindo autenticação: paga na página da Stripe; o crédito entra quando ela confirmar
  redirect(url);
}

/** Liga, desliga ou ajusta a recarga automática do crédito. */
export async function saveAutoRecharge(fd: FormData): Promise<ActionResult> {
  const ctx = await requireAgency();
  if (!can(ctx.role, "billing")) return fail(DENIED);
  const a = parseAutoRecharge(fd);
  if ("error" in a) return fail(a.error);
  if (a.enabled && ctx.agency.billing_status === "none") return fail("A recarga automática usa o cartão da assinatura: assine um tamanho antes.");
  const db = createAdminClient();
  const after = { credit_auto_enabled: a.enabled, credit_auto_below_cents: a.belowCents, credit_auto_amount_cents: a.amountCents, credit_auto_month_limit_cents: a.monthLimitCents };
  const { error } = await db.from("agencies").update(after).eq("id", ctx.agency.id);
  if (error) return fail("Não foi possível salvar. Confira os valores e tente de novo.");
  await auditBilling(ctx, "credito.recarga_automatica", { type: "agency", id: ctx.agency.id }, { after });
  revalidatePath("/painel/cobranca/credito");
  return ok(a.enabled ? `Recarga automática ligada: abaixo de ${brlCents(a.belowCents! / 100)}, compra ${brlCents(a.amountCents! / 100)}, até ${brlCents(a.monthLimitCents! / 100)} por mês.` : "Recarga automática desligada.");
}

/** Resposta ao pico no chat do site: "tráfego real" (o excedente volta, sem nova suspensão por 7 dias) ou "ataque" (suspenso até o mês virar). */
export async function resolveSpike(botId: string, verdict: "real" | "ataque"): Promise<ActionResult> {
  const ctx = await requireAgency();
  if (!can(ctx.role, "billing")) return fail(DENIED);
  const { data: visible } = await (await createClient()).from("bots").select("id").eq("id", botId).maybeSingle();
  if (!visible) return fail("Chatbot não encontrado.");
  const db = createAdminClient();
  const change =
    verdict === "real"
      ? { overage_suspended_at: null, overage_suspended_reason: null, overage_suspended_until: null, overage_spike_ok_until: new Date(Date.now() + 7 * 86_400_000).toISOString() }
      : { overage_suspended_at: new Date().toISOString(), overage_suspended_reason: "ataque", overage_suspended_until: monthBoundsBR().end.toISOString() };
  const { error } = await db.from("bots").update(change).eq("id", botId).eq("agency_id", ctx.agency.id).not("overage_suspended_reason", "is", null);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  await auditBilling(ctx, verdict === "real" ? "excedente.trafego_real" : "excedente.ataque", { type: "bot", id: botId }, { after: change });
  const { data: b } = await db.from("bots").select("overage_enabled, overage_cap_brl").eq("id", botId).maybeSingle();
  await emitOverageChanged(db, botId, { enabled: Boolean(b?.overage_enabled), capBrl: b?.overage_cap_brl === null || b?.overage_cap_brl === undefined ? null : Number(b.overage_cap_brl), suspended: verdict === "real" ? null : "ataque" });
  revalidatePath("/painel", "layout");
  return ok(verdict === "real" ? "Excedente de volta. Nos próximos 7 dias, um pico não suspende de novo." : `Marcado como ataque: o excedente desse chatbot fica suspenso até ${renewalLabel()}.`);
}

/** Desfaz o cancelamento agendado no portal: a assinatura segue no dia 1º. */
export async function reactivateSubscription(): Promise<ActionResult> {
  const s = await subscribed();
  if ("error" in s) return fail(s.error);
  try {
    await stripe!.subscriptions.update(s.subscription, { cancel_at_period_end: false });
  } catch (e) {
    console.error("cobrança: reativar", e);
    return fail("Não foi possível reativar agora. Tente de novo em instantes.");
  }
  await createAdminClient().from("agencies").update({ billing_cancel_at: null }).eq("id", s.ctx.agency.id);
  await auditBilling(s.ctx, "assinatura.reativar", { type: "agency", id: s.ctx.agency.id }, {});
  revalidatePath("/painel", "layout");
  return ok("Assinatura reativada: ela segue normalmente no dia 1º.");
}
