import type { SupabaseClient } from "@supabase/supabase-js";

/** Comissão recorrente para quem indica (fração da fatura paga pela agência indicada). */
export const REFERRAL_RATE = 0.3;
/** Valor mínimo para converter em desconto, em centavos. Evita lançamentos de centavos no Stripe. */
export const MIN_REDEEM_CENTS = 1000;

export interface CreditSummary {
  earnedCents: number; // total gerado pelas indicações (vida toda)
  redeemedCents: number; // já convertido em desconto
  availableCents: number; // pode converter agora
}

/** Soma o que as indicações geraram e subtrai o que já virou desconto. */
export async function creditSummary(db: SupabaseClient, agencyId: string): Promise<CreditSummary> {
  const [{ data: rows }, { data: ag }] = await Promise.all([
    // uma linha por fatura paga (migração 0022): o total não dobra se o Stripe reenviar o evento
    db.from("referral_commissions").select("commission_cents, referrals!inner(referrer_id)").eq("referrals.referrer_id", agencyId),
    db.from("agencies").select("credit_redeemed_cents").eq("id", agencyId).maybeSingle(),
  ]);
  const earnedCents = (rows ?? []).reduce((s, r) => s + (r.commission_cents ?? 0), 0);
  // coluna ausente (migração 0003 não rodou) → trata como zero
  const redeemedCents = (ag as { credit_redeemed_cents?: number } | null)?.credit_redeemed_cents ?? 0;
  return { earnedCents, redeemedCents, availableCents: Math.max(0, earnedCents - redeemedCents) };
}
