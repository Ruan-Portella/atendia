import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { endSubscription } from "./billing-webhook";
import { addSignals } from "./person-signals";
import { notifyAgencyOwner, notifyPlatform } from "./notify";
import { audit } from "./audit";
import { FIRST_WEEK_DAYS, WITHDRAWAL_MARK_MONTHS, brlCents } from "./plans";
import { company } from "./company";

/*
 * Desistência em 7 dias (leva Trava da conta grátis, parte 2, 21/10/2026; art. 49 do CDC e Decreto
 * 7.962/2013). Nos 7 dias do pagamento que abriu a assinatura, o dono desiste em Cobrança: tudo o que
 * foi pago desde então volta (cada cobrança da Stripe é estornada), a assinatura acaba na hora
 * (os chatbots ficam sem tamanho e os canais desconectam, como no fim da assinatura), o crédito
 * comprado na semana sai e a conta volta para a conta grátis, sem o teste. A pessoa fica marcada
 * por 12 meses (os sinais da conta): o teste grátis não volta em conta nenhuma dela, e a
 * desistência de uma assinatura nova é feita pelo suporte, que analisa. Os textos jurídicos ainda
 * passam pelo advogado.
 */

export const WITHDRAWAL_DAYS = FIRST_WEEK_DAYS;
export const MARK_MONTHS = WITHDRAWAL_MARK_MONTHS;
/** Folga antes do primeiro pagamento (a cobrança do Checkout sai segundos antes do registro). */
const SLACK_MS = 60 * 60_000;

export type WithdrawalState =
  | { kind: "none" }
  | { kind: "open"; since: string; until: string }
  | { kind: "support"; since: string; until: string }
  | { kind: "done"; at: string };

/** Até quando vale a desistência (7 dias do pagamento que abriu a assinatura). Pura. */
export const withdrawalUntil = (firstPaidAt: string) => new Date(Date.parse(firstPaidAt) + WITHDRAWAL_DAYS * 86_400_000);

/** Até quando vale a primeira semana da assinatura (25% da cota e R$ 100 de crédito), ou null. Pura. */
export function firstWeekUntil(a: { billing_status: string; first_paid_at: string | null }, now = new Date()): string | null {
  if (a.billing_status === "none" || !a.first_paid_at) return null;
  const until = withdrawalUntil(a.first_paid_at);
  return until > now ? until.toISOString() : null;
}

/** O que a tela de Cobrança mostra: o botão, o caminho pelo suporte, nada ou a desistência feita. */
export async function withdrawalState(db: SupabaseClient, a: { id: string; billing_status: string; first_paid_at: string | null; withdrawn_at: string | null }, now = new Date()): Promise<WithdrawalState> {
  if (a.billing_status === "none") return a.withdrawn_at ? { kind: "done", at: a.withdrawn_at } : { kind: "none" };
  if (!a.first_paid_at) return { kind: "none" };
  const until = withdrawalUntil(a.first_paid_at);
  if (until <= now) return { kind: "none" };
  const { data: marked, error } = await db.rpc("person_marked", { p_agency_id: a.id });
  if (error) console.error("desistência: marca não conferida", error.message);
  return { kind: marked ? "support" : "open", since: a.first_paid_at, until: until.toISOString() };
}

/** O e-mail ao dono depois da desistência. Pura. */
export function withdrawalEmail(refundedCents: number): [string, string[]] {
  return [
    "Desistência da assinatura confirmada",
    [
      `A desistência da assinatura do ${company.brand} foi feita. Estornamos ${brlCents(refundedCents / 100)}: o valor volta para o mesmo meio de pagamento, no prazo do seu banco (no cartão, costuma aparecer em até 2 faturas).`,
      "",
      "A assinatura acabou: os chatbots ficaram sem tamanho, e o WhatsApp e o Instagram foram desconectados. A configuração continua guardada na conta.",
      "",
      `Se quiser voltar, é só assinar de novo em Cobrança. Dúvidas: ${company.email}.`,
    ],
  ];
}

type StripeLike = Pick<Stripe, "charges" | "refunds" | "subscriptions">;

export interface WithdrawalInput {
  via: "painel" | "suporte";
  /** quem pediu: o id do dono (painel) ou o e-mail do suporte */
  actor: string;
  reason?: string | null;
}

/**
 * Faz a desistência: estorna cada cobrança desde o primeiro pagamento, encerra a assinatura, tira o
 * crédito da semana, marca a pessoa por 12 meses e volta a conta para a conta grátis sem o teste.
 * Estorno que falha não encerra nada: o registro fica com erro, o suporte é avisado e pode refazer
 * (os estornos levam a chave de idempotência da cobrança).
 */
export async function withdraw(db: SupabaseClient, stripe: StripeLike, agencyId: string, input: WithdrawalInput, now = new Date()): Promise<{ ok: true; refundedCents: number } | { ok: false; message: string }> {
  const { data: a } = await db.from("agencies").select("id, name, stripe_customer_id, stripe_subscription_id, first_paid_at, withdrawn_at, billing_status").eq("id", agencyId).maybeSingle();
  if (!a) return { ok: false, message: "Conta não encontrada." };
  if (a.withdrawn_at) return { ok: false, message: "A desistência desta assinatura já foi feita." };
  if (!a.stripe_customer_id || !a.first_paid_at) return { ok: false, message: "A conta não tem pagamento para estornar." };
  const since = Math.floor((Date.parse(a.first_paid_at as string) - SLACK_MS) / 1000);
  const refundIds: string[] = [];
  let refunded = 0;
  const cards = new Set<string>();
  try {
    const charges = await stripe.charges.list({ customer: a.stripe_customer_id as string, created: { gte: since }, limit: 100 });
    for (const ch of charges.data) {
      const fp = ch.payment_method_details?.card?.fingerprint;
      if (fp) cards.add(fp);
      const left = ch.amount - ch.amount_refunded;
      if (ch.status !== "succeeded" || left <= 0) continue;
      const r = await stripe.refunds.create({ charge: ch.id, reason: "requested_by_customer", metadata: { boavoz: "desistencia", agency_id: agencyId } }, { idempotencyKey: `desistencia:${agencyId}:${ch.id}` });
      refundIds.push(r.id);
      refunded += left;
    }
  } catch (e) {
    const message = (e as Error).message;
    await db.from("withdrawals").insert({ agency_id: agencyId, via: input.via, actor: input.actor, reason: input.reason ?? null, refunded_cents: refunded, refund_ids: refundIds, status: "erro", error: message.slice(0, 500) });
    await notifyPlatform(`Desistência com erro no estorno: ${a.name}`, [`Conta ${agencyId}. Estornado até aqui: ${brlCents(refunded / 100)}.`, `Erro: ${message}`, "Refazer pelo backoffice (os estornos já feitos não se repetem)."]).catch(() => false);
    return { ok: false, message: `Não foi possível concluir o estorno agora. O suporte já foi avisado e conclui a desistência em até 1 dia útil (${company.email}).` };
  }
  // a assinatura acaba na hora (sem fatura nova); o fim da assinatura tira os tamanhos e desconecta os canais
  if (a.stripe_subscription_id) {
    await stripe.subscriptions.cancel(a.stripe_subscription_id as string, { prorate: false, invoice_now: false }).catch((e) => console.error("desistência: assinatura já cancelada?", (e as Error).message));
  }
  await endSubscription(db, a.stripe_customer_id as string);
  const from = new Date(since * 1000).toISOString();
  // o crédito comprado na semana foi estornado junto: sai do saldo, e a recarga automática para
  await db.from("credit_lots").update({ remaining_cents: 0 }).eq("agency_id", agencyId).in("source", ["compra", "recarga"]).gte("created_at", from);
  // as notas dos pagamentos estornados: as a emitir saem da fila; as emitidas o suporte cancela
  await db.from("fiscal_invoices").update({ refunded_at: now.toISOString() }).eq("agency_id", agencyId).gte("paid_at", from);
  await db.from("fiscal_invoices").update({ status: "estornada" }).eq("agency_id", agencyId).eq("status", "a_emitir").gte("paid_at", from);
  // o cartão também marca a pessoa; depois, 12 meses de marca em todos os sinais da conta
  await addSignals(db, agencyId, [...cards].map((value) => ({ kind: "card" as const, value })));
  await db.rpc("mark_person", { p_agency_id: agencyId, p_reason: "desistencia", p_months: MARK_MONTHS });
  await db.from("agencies").update({ withdrawn_at: now.toISOString(), credit_auto_enabled: false, free_blocked_at: now.toISOString(), free_block_reason: "marca", free_released_at: null }).eq("id", agencyId);
  await db.from("withdrawals").insert({ agency_id: agencyId, via: input.via, actor: input.actor, reason: input.reason ?? null, refunded_cents: refunded, refund_ids: refundIds, status: "feita" });
  await audit(db, { agencyId, actorType: input.via === "painel" ? "user" : "support", actorId: input.actor, action: "assinatura.desistencia", targetType: "agency", targetId: agencyId, after: { estornado_centavos: refunded, estornos: refundIds.length, via: input.via } });
  const [subject, lines] = withdrawalEmail(refunded);
  await notifyAgencyOwner(db, agencyId, subject, lines).catch(() => false);
  await notifyPlatform(`Desistência: ${a.name}`, [`Conta ${agencyId}, pelo ${input.via}. Estornado: ${brlCents(refunded / 100)} em ${refundIds.length} cobrança(s).`, "Notas já emitidas desses pagamentos precisam ser canceladas (Notas fiscais no backoffice)."]).catch(() => false);
  return { ok: true, refundedCents: refunded };
}
