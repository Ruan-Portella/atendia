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
  const [{ data: refs }, { data: ag }] = await Promise.all([
    db.from("referrals").select("commission_cents").eq("referrer_id", agencyId),
    db.from("agencies").select("credit_redeemed_cents").eq("id", agencyId).maybeSingle(),
  ]);
  const earnedCents = (refs ?? []).reduce((s, r) => s + (r.commission_cents ?? 0), 0);
  // coluna ausente (migração 0003 não rodou) → trata como zero
  const redeemedCents = (ag as { credit_redeemed_cents?: number } | null)?.credit_redeemed_cents ?? 0;
  return { earnedCents, redeemedCents, availableCents: Math.max(0, earnedCents - redeemedCents) };
}
