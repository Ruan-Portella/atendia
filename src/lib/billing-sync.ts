import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOOKUP_KEYS, MIN_CHARGE_CENTS, monthBoundsBR, nextChoice, planSizeChange, targetQuantities, type BillingTarget, type LookupKey } from "./billing";
import { isBotSize, isPackId, type BotSize } from "./plans";
import { botQuota } from "./quota";
import { catalogPrices, stripe } from "./stripe";
import { audit } from "./audit";
import { currentPeriodBR } from "./utils";
import { classifyGainedAi } from "./gate/base";

/*
 * Mudanças numa conta com assinatura (revisão de preços, parte 4b). A assinatura da Stripe
 * guarda sempre o que vale no mês que vem, sem cobrança proporcional (proration "none"): o que
 * sobe no meio do mês é cobrado por nós numa fatura avulsa, com a diferença proporcional; o que
 * desce vale no dia 1º, então a Stripe só precisa da quantidade nova para a próxima fatura.
 */

function must<T extends { error: unknown }>(r: T): T {
  if (r.error) throw r.error;
  return r;
}

export interface SubscriptionItemLike {
  id: string;
  priceId: string;
  quantity: number | null;
}

/**
 * Itens para a atualização da assinatura: muda a quantidade, tira o que zerou e põe o que falta.
 * Vazio = já está igual. Item com preço fora do catálogo (combinado à parte) fica. Função pura.
 */
export function subscriptionDiff(current: SubscriptionItemLike[], want: Partial<Record<LookupKey, number>>, ids: Record<LookupKey, string>): Stripe.SubscriptionUpdateParams.Item[] {
  const byPrice = new Map(current.map((i) => [i.priceId, i]));
  const items: Stripe.SubscriptionUpdateParams.Item[] = [];
  for (const key of Object.values(LOOKUP_KEYS)) {
    const price = ids[key];
    const cur = byPrice.get(price);
    const n = want[key] ?? 0;
    if (cur && n === 0) items.push({ id: cur.id, deleted: true });
    else if (cur && cur.quantity !== n) items.push({ id: cur.id, quantity: n });
    else if (!cur && n > 0) items.push({ price, quantity: n });
  }
  return items;
}

/** O que a conta vai pagar no próximo mês: tamanho de cada chatbot (com a troca agendada) e pacotes que ficam. */
export async function nextMonthTarget(db: SupabaseClient, agencyId: string): Promise<BillingTarget> {
  const [botsRes, packsRes] = await Promise.all([
    db.from("bots").select("id, size, volume_packs, pending_size, pending_volume_packs").eq("agency_id", agencyId).eq("is_demo", false).is("quota_override", null),
    db.from("agency_packs").select("pack, ends_at").eq("agency_id", agencyId),
  ]);
  const bots = must(botsRes).data;
  const packs = must(packsRes).data;
  return {
    bots: (bots ?? []).map((b) => ({
      id: b.id as string,
      ...nextChoice({
        size: isBotSize(b.size) ? b.size : null,
        volumePacks: (b.volume_packs as number | null) ?? null,
        pendingSize: b.pending_size === "none" ? "none" : isBotSize(b.pending_size) ? b.pending_size : null,
        pendingVolumePacks: (b.pending_volume_packs as number | null) ?? null,
      }),
    })),
    packs: (packs ?? []).filter((p) => !p.ends_at && isPackId(p.pack)).map((p) => p.pack),
  };
}

/** Deixa as quantidades da assinatura iguais ao que vale no próximo mês. Sem assinatura, nada. */
export async function syncSubscription(db: SupabaseClient, agencyId: string): Promise<void> {
  if (!stripe) return;
  const { data: agency } = must(await db.from("agencies").select("stripe_subscription_id").eq("id", agencyId).maybeSingle());
  const subId = agency?.stripe_subscription_id as string | null | undefined;
  if (!subId) return;
  must(await db.rpc("apply_due_bot_changes", { p_agency_id: agencyId }));
  const [target, ids, sub] = await Promise.all([nextMonthTarget(db, agencyId), catalogPrices(), stripe.subscriptions.retrieve(subId)]);
  if (sub.status === "canceled" || sub.status === "incomplete_expired") return;
  const items = subscriptionDiff(
    sub.items.data.map((i) => ({ id: i.id, priceId: i.price.id, quantity: i.quantity ?? null })),
    targetQuantities(target),
    ids,
  );
  if (items.length) await stripe.subscriptions.update(subId, { items, proration_behavior: "none" });
}

/** Sincroniza sem derrubar quem chamou: a falha fica no log (o próximo sync corrige). */
export async function syncSubscriptionSafe(db: SupabaseClient, agencyId: string): Promise<void> {
  try {
    await syncSubscription(db, agencyId);
  } catch (e) {
    console.error("cobrança: assinatura não sincronizada", agencyId, e);
  }
}

export type ChargeResult = { status: "paid" | "next_invoice"; invoiceId: string | null } | { status: "open"; invoiceId: string; url: string | null };

/**
 * Cobra agora a diferença proporcional de uma subida (fatura avulsa no cartão da assinatura).
 * Abaixo do mínimo, a diferença entra na fatura do dia 1º e a subida vale na hora. Cartão
 * recusado ou pedindo autenticação: a fatura fica aberta, e a subida vale quando ela for paga.
 */
export async function chargeNow(agency: { stripe_customer_id: string; stripe_subscription_id: string }, o: { changeId: string; agencyId: string; amountCents: number; description: string }): Promise<ChargeResult> {
  if (!stripe) throw new Error("Stripe não configurado.");
  const customer = agency.stripe_customer_id;
  if (o.amountCents < MIN_CHARGE_CENTS) {
    if (o.amountCents > 0) await stripe.invoiceItems.create({ customer, subscription: agency.stripe_subscription_id, amount: o.amountCents, currency: "brl", description: o.description, metadata: { changeId: o.changeId } });
    return { status: "next_invoice", invoiceId: null };
  }
  const sub = await stripe.subscriptions.retrieve(agency.stripe_subscription_id);
  const pm = typeof sub.default_payment_method === "string" ? sub.default_payment_method : (sub.default_payment_method?.id ?? undefined);
  const inv = await stripe.invoices.create({
    customer,
    collection_method: "charge_automatically",
    auto_advance: false,
    pending_invoice_items_behavior: "exclude",
    default_payment_method: pm,
    description: o.description,
    metadata: { changeId: o.changeId, agencyId: o.agencyId },
  });
  await stripe.invoiceItems.create({ customer, invoice: inv.id, amount: o.amountCents, currency: "brl", description: o.description });
  const fin = await stripe.invoices.finalizeInvoice(inv.id, { auto_advance: false });
  try {
    const paid = await stripe.invoices.pay(fin.id);
    if (paid.status === "paid") return { status: "paid", invoiceId: fin.id };
  } catch {
    // recusado ou pedindo autenticação: segue aberta para pagar na página da Stripe
  }
  const again = await stripe.invoices.retrieve(fin.id);
  if (again.status === "paid") return { status: "paid", invoiceId: fin.id };
  return { status: "open", invoiceId: fin.id, url: again.hosted_invoice_url ?? null };
}

/**
 * Aplica uma subida paga, uma vez só: o tamanho novo (com a cota do mês somando a parte
 * proporcional, calculada agora) e os pacotes novos; depois sincroniza a assinatura.
 */
export async function applyUpgrade(db: SupabaseClient, changeId: string, now = new Date()): Promise<boolean> {
  const { data: change } = must(await db.from("billing_changes").select("id, agency_id, kind, target, status").eq("id", changeId).maybeSingle());
  if (!change || change.status !== "pending" || change.kind !== "upgrade") return false;
  const agencyId = change.agency_id as string;
  const target = change.target as BillingTarget;
  const rows: Array<Record<string, unknown>> = [];
  for (const b of target.bots) {
    const { data: bot } = must(await db.from("bots").select("id, size, volume_packs, quota_override, prorated_month, prorated_quota").eq("id", b.id).eq("agency_id", agencyId).maybeSingle());
    if (!bot) continue;
    const size = isBotSize(bot.size) ? (bot.size as BotSize) : null;
    const monthQuota = botQuota({ size, volume_packs: bot.volume_packs as number | null, prorated_month: bot.prorated_month as string | null, prorated_quota: bot.prorated_quota as number | null }, currentPeriodBR(now));
    const plan = planSizeChange({ size, volumePacks: (bot.volume_packs as number | null) ?? null, monthQuota, pendingSize: null, pendingVolumePacks: null }, b, now);
    rows.push({ id: b.id, size: b.size, volume_packs: b.size === "volume" ? b.volumePacks : null, prorated_month: monthBoundsBR(now).firstDay, prorated_quota: plan.kind === "upgrade" ? plan.monthQuota : monthQuota });
  }
  const { data: applied } = must(await db.rpc("apply_billing_change", { p_change_id: changeId, p_bots: rows, p_packs: target.packs, p_replace_packs: false, p_subscription_id: null }));
  if (!applied) return false;
  // chatbots com IA a partir de agora: a base é classificada antes das próximas respostas
  classifyGainedAi(db, target.bots);
  await audit(db, { agencyId, actorType: "system", actorId: null, action: "assinatura.subir", targetType: "agency", targetId: agencyId, after: { chatbots: target.bots.map((b) => ({ id: b.id, tamanho: b.size, pacotes: b.volumePacks })), pacotes: target.packs } });
  await syncSubscriptionSafe(db, agencyId);
  return true;
}

/**
 * Anula as subidas ainda não pagas que mexem no mesmo chatbot ou pacote (a fatura aberta vira
 * nula), para uma fatura antiga não valer depois de outra escolha. Se uma delas acabou de ser
 * paga, aplica e devolve true: quem chamou deve pedir para conferir e tentar de novo.
 */
export async function voidPendingUpgrades(db: SupabaseClient, agencyId: string, touches: (t: BillingTarget) => boolean): Promise<boolean> {
  const { data } = must(await db.from("billing_changes").select("id, target, stripe_ref").eq("agency_id", agencyId).eq("kind", "upgrade").eq("status", "pending"));
  let paidMeanwhile = false;
  for (const c of (data ?? []).filter((c) => touches(c.target as BillingTarget))) {
    const ref = (c.stripe_ref as string | null) ?? null;
    if (ref?.startsWith("in_") && stripe) {
      const inv = await stripe.invoices.retrieve(ref);
      if (inv.status === "paid") {
        await applyUpgrade(db, c.id as string);
        paidMeanwhile = true;
        continue;
      }
      if (inv.status === "open" || inv.status === "draft") await stripe.invoices.voidInvoice(ref).catch((e) => console.error("cobrança: fatura não anulada", ref, e));
    }
    must(await db.from("billing_changes").update({ status: "void" }).eq("id", c.id).eq("status", "pending"));
  }
  return paidMeanwhile;
}
