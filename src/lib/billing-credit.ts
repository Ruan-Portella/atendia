import type { SupabaseClient } from "@supabase/supabase-js";
import { creditEventData, emitCreditAlert } from "./billing-events";
import { CREDIT_LOW_SHARE, CREDIT_MAX_BRL, CREDIT_MIN_BRL, OVERAGE_PRICE_BRL, PIX_MAX_BRL, brlCents } from "./plans";
import { monthBoundsBR } from "./billing";
import { chargeNow } from "./billing-sync";
import { notifyAgencyOwner } from "./notify";
import { audit, type AuditActor } from "./audit";
import { stripe } from "./stripe";
import { appUrl } from "./utils";

/*
 * Crédito pré-pago do excedente (revisão de preços, parte 4c). Cada atendimento a mais desconta
 * R$ 0,35 do saldo da conta, na abertura do atendimento (open_atendimento, migração 0098). O
 * crédito é comprado antes, no cartão da assinatura (lotes de 12 meses), à mão ou pela recarga
 * automática, ou pelo Pix (Lançamento, parte 6). Sem saldo, os chatbots que dependem do excedente
 * entram no modo só humano.
 */

export const OVERAGE_PRICE_CENTS = Math.round(OVERAGE_PRICE_BRL * 100);

/** Saldo da conta, em centavos (lotes ainda válidos). */
export async function creditBalance(db: SupabaseClient, agencyId: string): Promise<number> {
  const { data, error } = await db.rpc("credit_balance", { p_agency_id: agencyId });
  if (error) throw new Error(`saldo do crédito: ${error.message}`);
  return Number(data) || 0;
}

/** Valor de compra digitado ("100", "1.000", "R$ 250,00") em centavos, de R$ 50 a R$ 50.000 inteiros; senão null. */
export function parseCreditBrl(raw: string): number | null {
  const v = raw.replace(/R\$|\s/g, "").replace(/,00$/, "");
  if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(v)) return null;
  const n = Number(v.replace(/\./g, ""));
  return Number.isSafeInteger(n) && n >= CREDIT_MIN_BRL && n <= CREDIT_MAX_BRL ? n * 100 : null;
}

/**
 * Aviso deste desconto: "acabou" (o saldo não paga o próximo atendimento a mais) ou "baixo" (cruzou
 * 20% da última compra). Cada um sai uma vez por cruzamento (o saldo desce de 35 em 35). Função pura.
 */
export function creditAlert(leftCents: number, lastPurchaseCents: number): "baixo" | "acabou" | null {
  const before = leftCents + OVERAGE_PRICE_CENTS;
  if (leftCents < OVERAGE_PRICE_CENTS && before >= OVERAGE_PRICE_CENTS) return "acabou";
  const low = Math.round(lastPurchaseCents * CREDIT_LOW_SHARE);
  if (low > 0 && leftCents < low && before >= low) return "baixo";
  return null;
}

export interface AutoRecharge {
  enabled: boolean;
  belowCents: number | null;
  amountCents: number | null;
  monthLimitCents: number | null;
}

/**
 * Recarga automática agora? "charge" (saldo abaixo do gatilho e cabe no limite do mês), "limit"
 * (o limite do mês não deixa) ou "skip". Assinatura atrasada não recarrega. Função pura.
 */
export function rechargeDecision(a: AutoRecharge, billingStatus: string, balanceCents: number, rechargedThisMonthCents: number): "charge" | "limit" | "skip" {
  if (!a.enabled || billingStatus !== "active" || !a.amountCents || a.belowCents === null) return "skip";
  if (balanceCents >= a.belowCents) return "skip";
  if (rechargedThisMonthCents + a.amountCents > (a.monthLimitCents ?? 0)) return "limit";
  return "charge";
}

/** Valida a recarga automática do formulário (reais inteiros): gatilho, valor (mín. R$ 50) e limite do mês (≥ valor). */
export function parseAutoRecharge(fd: FormData): AutoRecharge | { error: string } {
  const enabled = fd.get("auto") === "on";
  const reais = (k: string) => {
    const v = String(fd.get(k) ?? "").replace(/R\$|\s|\./g, "").replace(/,00$/, "");
    return /^\d+$/.test(v) ? Number(v) * 100 : null;
  };
  const below = reais("below");
  const amount = reais("amount");
  const limit = reais("limit");
  if (!enabled) return { enabled: false, belowCents: below, amountCents: amount, monthLimitCents: limit };
  if (below === null || below > CREDIT_MAX_BRL * 100) return { error: "Informe abaixo de quanto o saldo recarrega." };
  if (amount === null || amount < CREDIT_MIN_BRL * 100 || amount > CREDIT_MAX_BRL * 100) return { error: `A recarga vai de ${brlCents(CREDIT_MIN_BRL)} a ${brlCents(CREDIT_MAX_BRL)}.` };
  if (limit === null || limit < amount) return { error: "O limite do mês precisa ser pelo menos o valor de uma recarga." };
  return { enabled, belowCents: below, amountCents: amount, monthLimitCents: limit };
}

/** E-mails do crédito. Função pura. */
export function creditEmail(kind: "baixo" | "acabou" | "recarga" | "recarga_falhou" | "limite" | "pix", o: { balanceCents: number; amountCents?: number; payUrl?: string | null; autoOn: boolean; creditUrl: string }): [string, string[]] {
  const saldo = brlCents(o.balanceCents / 100);
  const buy = `Comprar crédito ou ajustar a recarga automática: ${o.creditUrl}`;
  switch (kind) {
    case "baixo":
      return [
        `Crédito do excedente baixo: ${saldo}`,
        [`O crédito do excedente da sua conta está em ${saldo}. Cada atendimento a mais (além da cota de um chatbot) usa ${brlCents(OVERAGE_PRICE_BRL)}.`, "", o.autoOn ? "A recarga automática está ligada e compra mais quando o saldo cair abaixo do valor escolhido." : "Quando o saldo acabar, os chatbots que estão no excedente entram no modo só humano.", "", buy],
      ];
    case "acabou":
      return [
        "O crédito do excedente acabou",
        [`O crédito do excedente da sua conta acabou (${saldo}). Os chatbots com a cota do mês cheia entram no modo só humano: a IA não responde a quem começa um atendimento novo, e as mensagens chegam em Conversas para a sua equipe.`, "", "Os chatbots que ainda têm cota seguem normais.", "", buy],
      ];
    case "recarga":
      return [`Recarga automática de ${brlCents((o.amountCents ?? 0) / 100)} feita`, [`A recarga automática comprou ${brlCents((o.amountCents ?? 0) / 100)} de crédito do excedente no cartão da assinatura. Saldo agora: ${saldo}. O crédito vale 12 meses.`, "", buy]];
    case "recarga_falhou":
      return [
        "A recarga automática do crédito não foi paga",
        [`O cartão da assinatura recusou a recarga automática de ${brlCents((o.amountCents ?? 0) / 100)}. Saldo: ${saldo}.`, "", o.payUrl ? `Pague a fatura para o crédito entrar: ${o.payUrl}` : "Atualize o cartão em Cobrança → Assinatura → Pagamento e faturas.", "", buy],
      ];
    case "pix":
      return [`Crédito de ${brlCents((o.amountCents ?? 0) / 100)} recebido pelo Pix`, [`O Pix de ${brlCents((o.amountCents ?? 0) / 100)} foi confirmado e o crédito do excedente entrou. Saldo agora: ${saldo}. O crédito vale 12 meses.`, "", buy]];
    case "limite":
      return [
        "Recarga automática parada pelo limite do mês",
        [`O saldo do crédito do excedente está em ${saldo}, mas a próxima recarga automática passaria do limite do mês que vocês escolheram. Nenhuma recarga foi feita.`, "", buy],
      ];
  }
}

/** Põe o crédito de uma compra paga (uma vez só). Devolve o saldo novo, ou null se já tinha entrado. */
export async function applyCredit(db: SupabaseClient, changeId: string, source: "compra" | "recarga"): Promise<number | null> {
  const { data, error } = await db.rpc("add_credit", { p_change_id: changeId, p_source: source });
  if (error) throw error;
  return data === null || data === undefined ? null : Number(data);
}

export type PurchaseResult = { status: "paid"; balanceCents: number } | { status: "open"; url: string | null };

/** Compra de crédito no cartão da assinatura: grava a compra, cobra na hora e põe o crédito se pagou. */
export async function purchaseCredit(db: SupabaseClient, agency: { id: string; stripe_customer_id: string; stripe_subscription_id: string }, amountCents: number, source: "compra" | "recarga", createdBy: string | null, actor?: { type: AuditActor; id: string | null }): Promise<PurchaseResult> {
  const kind = source === "recarga" ? "recarga" : "credit";
  const { data: change, error } = await db.from("billing_changes").insert({ agency_id: agency.id, kind, target: { credito_centavos: amountCents }, amount_cents: amountCents, created_by: createdBy }).select("id").single();
  if (error || !change) throw new Error(error?.message ?? "compra não gravada");
  const description = source === "recarga" ? `Recarga automática do crédito do excedente (${brlCents(amountCents / 100)})` : `Crédito do excedente (${brlCents(amountCents / 100)}), válido por 12 meses`;
  const r = await chargeNow(agency, { changeId: change.id as string, agencyId: agency.id, amountCents, description });
  if (r.invoiceId) await db.from("billing_changes").update({ stripe_ref: r.invoiceId }).eq("id", change.id);
  if (r.status === "open") return { status: "open", url: r.url };
  const balance = await applyCredit(db, change.id as string, source);
  await audit(db, { agencyId: agency.id, actorType: actor?.type ?? (createdBy ? "user" : "system"), actorId: actor?.id ?? createdBy, action: source === "recarga" ? "credito.recarga" : "credito.comprar", targetType: "agency", targetId: agency.id, after: { valor_centavos: amountCents } });
  return { status: "paid", balanceCents: balance ?? (await creditBalance(db, agency.id)) };
}

/* ------------------------------------------------------------------ Pix (Lançamento, parte 6) */

/*
 * Pix na compra de crédito (19/10/2026). Conta brasileira na Stripe só tem o Pix avulso (sem Pix
 * Automático e sem Pix na fatura), então a assinatura e a recarga automática seguem no cartão. A
 * página de pagamento da Stripe pede o CPF ou CNPJ de quem paga e mostra o QR e o copia e cola; o
 * crédito entra quando a Stripe confirma (webhook), uma vez só.
 */

/** Validade do código Pix. */
export const PIX_EXPIRES_SECONDS = 3600;

/** O valor passa do que o Pix aceita? Pura. */
export function pixAmountProblem(cents: number): string | null {
  return cents > PIX_MAX_BRL * 100 ? `Pelo Pix, até ${brlCents(PIX_MAX_BRL)} por compra. Para mais, use o cartão ou faça mais de uma compra.` : null;
}

/** Abre o pagamento por Pix na Stripe: grava a compra e devolve o endereço da página de pagamento. */
export async function startPixCredit(db: SupabaseClient, agency: { id: string; stripe_customer_id: string }, amountCents: number, createdBy: string | null): Promise<string> {
  if (!stripe) throw new Error("Stripe não configurado.");
  const { data: change, error } = await db.from("billing_changes").insert({ agency_id: agency.id, kind: "credit", target: { credito_centavos: amountCents, via: "pix" }, amount_cents: amountCents, created_by: createdBy }).select("id").single();
  if (error || !change) throw new Error(error?.message ?? "compra não gravada");
  const metadata = { agencyId: agency.id, changeId: change.id as string };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: agency.stripe_customer_id,
    client_reference_id: agency.id,
    line_items: [{ quantity: 1, price_data: { currency: "brl", unit_amount: amountCents, product_data: { name: "Crédito do excedente", description: "Válido por 12 meses, não reembolsável" } } }],
    payment_method_types: ["pix"],
    payment_method_options: { pix: { expires_after_seconds: PIX_EXPIRES_SECONDS } },
    payment_intent_data: { description: `Crédito do excedente (${brlCents(amountCents / 100)}), válido por 12 meses`, metadata },
    metadata,
    success_url: appUrl("/painel/cobranca/credito?pix=ok"),
    cancel_url: appUrl("/painel/cobranca/credito"),
    locale: "pt-BR",
  });
  await db.from("billing_changes").update({ stripe_ref: session.id }).eq("id", change.id);
  if (!session.url) throw new Error("Checkout sem URL");
  return session.url;
}

/** O Pix confirmado pela Stripe: o crédito entra (uma vez só), com a auditoria e o e-mail ao dono. */
export async function applyPixCredit(db: SupabaseClient, changeId: string, apply = applyCredit): Promise<number | null> {
  const { data: change } = await db.from("billing_changes").select("agency_id, kind, amount_cents, created_by").eq("id", changeId).maybeSingle();
  if (!change || change.kind !== "credit") return null;
  const balance = await apply(db, changeId, "compra");
  if (balance === null) return null;
  const agencyId = change.agency_id as string;
  const amountCents = Number(change.amount_cents) || 0;
  const createdBy = (change.created_by as string | null) ?? null;
  await audit(db, { agencyId, actorType: createdBy ? "user" : "system", actorId: createdBy, action: "credito.comprar", targetType: "agency", targetId: agencyId, after: { valor_centavos: amountCents, via: "pix" } });
  const [subject, lines] = creditEmail("pix", { balanceCents: balance, amountCents, autoOn: false, creditUrl: appUrl("/painel/cobranca/credito") });
  await notifyAgencyOwner(db, agencyId, subject, lines).catch(() => false);
  return balance;
}

/** O Pix venceu sem pagamento (ou a página de pagamento expirou): a compra fica anulada. */
export async function voidPixCredit(db: SupabaseClient, changeId: string): Promise<boolean> {
  const { data } = await db.from("billing_changes").update({ status: "void" }).eq("id", changeId).eq("kind", "credit").eq("status", "pending").select("id");
  return Boolean(data?.length);
}

/**
 * Recarga automática depois de um desconto: saldo abaixo do gatilho, dentro do limite do mês, com
 * a assinatura em dia. Uma por vez (trava no banco). Nunca lança: a falha vira e-mail ou log.
 */
export async function maybeAutoRecharge(db: SupabaseClient, agencyId: string): Promise<void> {
  try {
    const { data: a } = await db.from("agencies").select("id, billing_status, stripe_customer_id, stripe_subscription_id, credit_auto_enabled, credit_auto_below_cents, credit_auto_amount_cents, credit_auto_month_limit_cents").eq("id", agencyId).maybeSingle();
    if (!a?.credit_auto_enabled || !a.stripe_customer_id || !a.stripe_subscription_id) return;
    const auto: AutoRecharge = { enabled: true, belowCents: a.credit_auto_below_cents as number | null, amountCents: a.credit_auto_amount_cents as number | null, monthLimitCents: a.credit_auto_month_limit_cents as number | null };
    const balance = await creditBalance(db, agencyId);
    const { data: lots } = await db.from("credit_lots").select("amount_cents").eq("agency_id", agencyId).eq("source", "recarga").gte("created_at", monthBoundsBR().start.toISOString());
    const recharged = (lots ?? []).reduce((t, l) => t + (Number(l.amount_cents) || 0), 0);
    const decision = rechargeDecision(auto, a.billing_status as string, balance, recharged);
    if (decision === "skip") return;
    const creditUrl = appUrl("/painel/cobranca/credito");
    if (decision === "limit") {
      // avisa uma vez por cruzamento do gatilho (o desconto seguinte já está abaixo)
      if (balance + OVERAGE_PRICE_CENTS >= (auto.belowCents ?? 0)) {
        const [subject, lines] = creditEmail("limite", { balanceCents: balance, autoOn: true, creditUrl });
        await notifyAgencyOwner(db, agencyId, subject, lines);
      }
      return;
    }
    const { data: claimed } = await db.rpc("claim_credit_recharge", { p_agency_id: agencyId });
    if (!claimed) return;
    try {
      const r = await purchaseCredit(db, { id: agencyId, stripe_customer_id: a.stripe_customer_id as string, stripe_subscription_id: a.stripe_subscription_id as string }, auto.amountCents!, "recarga", null);
      const [subject, lines] =
        r.status === "paid"
          ? creditEmail("recarga", { balanceCents: r.balanceCents, amountCents: auto.amountCents!, autoOn: true, creditUrl })
          : creditEmail("recarga_falhou", { balanceCents: balance, amountCents: auto.amountCents!, payUrl: r.url, autoOn: true, creditUrl });
      await notifyAgencyOwner(db, agencyId, subject, lines);
    } finally {
      await db.from("agencies").update({ credit_auto_started_at: null }).eq("id", agencyId);
    }
  } catch (e) {
    console.error("crédito: recarga automática", agencyId, e);
  }
}

/** Avisos depois de um desconto (saldo baixo ou acabou) e a recarga automática. Nunca lança. */
export async function afterCreditUse(db: SupabaseClient, agencyId: string, leftCents: number): Promise<void> {
  try {
    const { data: last } = await db.from("credit_lots").select("id, amount_cents").eq("agency_id", agencyId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const alert = creditAlert(leftCents, Number(last?.amount_cents) || 0);
    const { data: a } = await db.from("agencies").select("credit_auto_enabled").eq("id", agencyId).maybeSingle();
    const autoOn = Boolean(a?.credit_auto_enabled);
    if (alert) {
      const [subject, lines] = creditEmail(alert, { balanceCents: leftCents, autoOn, creditUrl: appUrl("/painel/cobranca/credito") });
      await notifyAgencyOwner(db, agencyId, subject, lines);
      // webhooks da conta: account.credit_low e account.credit_depleted
      await emitCreditAlert(db, agencyId, alert, (last?.id as string | undefined) ?? null, creditEventData(leftCents, Number(last?.amount_cents) || 0, autoOn));
    }
    if (autoOn) await maybeAutoRecharge(db, agencyId);
  } catch (e) {
    console.error("crédito: avisos", agencyId, e);
  }
}
