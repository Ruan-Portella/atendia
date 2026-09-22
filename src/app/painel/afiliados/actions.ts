"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgency } from "@/lib/agency";
import { billingEnabled, ensureStripeCustomer, stripe } from "@/lib/stripe";
import { creditSummary, MIN_REDEEM_CENTS } from "@/lib/referral-credit";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { brl } from "@/lib/plans";

/**
 * Converte todo o crédito de indicação disponível em desconto na assinatura.
 * Lança um "customer balance" negativo no Stripe: ele é abatido automaticamente
 * da(s) próxima(s) fatura(s), sem cupom e sem PIX.
 */
export async function redeemCredit(): Promise<ActionResult> {
  if (!billingEnabled || !stripe) return fail("O pagamento ainda não está configurado. O crédito fica guardado e você poderá usar quando a cobrança estiver ativa.");

  const { agency, email } = await requireAgency();
  const supabase = await createClient();
  const admin = createAdminClient();

  const { availableCents, redeemedCents } = await creditSummary(supabase, agency.id);
  if (availableCents < MIN_REDEEM_CENTS) return fail(`O mínimo para converter é ${brl(MIN_REDEEM_CENTS / 100)}. Você tem ${brl(availableCents / 100)} disponível.`);

  // 1) reserva o valor com lock otimista (impede clique duplo / duas abas)
  const { data: locked, error: lockError } = await admin
    .from("agencies")
    .update({ credit_redeemed_cents: redeemedCents + availableCents })
    .eq("id", agency.id)
    .eq("credit_redeemed_cents", redeemedCents)
    .select("id")
    .maybeSingle();
  if (lockError) return fail(lockError.message.includes("credit_redeemed_cents") ? "Rode a migração 0003_referral_credit.sql no Supabase para ativar o crédito." : lockError.message);
  if (!locked) return fail("Outro pedido acabou de ser processado. Atualize a página.");

  // 2) lança o crédito no Stripe; se falhar, devolve a reserva
  try {
    const customer = await ensureStripeCustomer(admin, agency, email);
    const txn = await stripe.customers.createBalanceTransaction(customer, {
      amount: -availableCents,
      currency: "brl",
      description: `Crédito de indicação · ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
      metadata: { agencyId: agency.id, kind: "referral_credit" },
    });
    await admin.from("credit_redemptions").insert({ agency_id: agency.id, amount_cents: availableCents, stripe_balance_txn_id: txn.id });
  } catch (e) {
    await admin.from("agencies").update({ credit_redeemed_cents: redeemedCents }).eq("id", agency.id);
    return fail(`Não foi possível lançar o crédito no Stripe: ${(e as Error).message}`);
  }

  revalidatePath("/painel/afiliados");
  revalidatePath("/painel/cobranca");
  return ok(`${brl(availableCents / 100)} de desconto lançados. Eles saem automaticamente da sua próxima fatura.`);
}
