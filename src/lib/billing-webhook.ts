import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appliedBotRow, monthBoundsBR, type BillingTarget } from "./billing";
import { audit } from "./audit";
import { applyUpgrade, syncSubscriptionSafe, voidPendingUpgrades } from "./billing-sync";
import { applyCredit, applyPixCredit, voidPixCredit } from "./billing-credit";
import { endApiPauses } from "./api-pause";
import { classifyGainedAi } from "./gate/base";
import { disconnectUnsized } from "./free-account";
import { releaseDomainsWithoutPack } from "./domain-pack";
import { emitSizeChanged } from "./billing-events";
import { isBotSize, type BotSize } from "./plans";
import { notifyAgencyOwner } from "./notify";
import { appUrl } from "./utils";
import { invoiceRecord, pixRecord, recordFiscalInvoice } from "./fiscal-invoices";
import { recordPaymentSignals } from "./person-signals";
import { stripe } from "./stripe";

/*
 * Eventos da Stripe (revisão de preços, parte 4): a compra paga vale (uma vez só), inclusive a
 * subida paga numa fatura avulsa; a situação da assinatura acompanha (pagamento atrasado pausa a
 * IA até pagar, 18/10); item mexido fora do BoaVoz volta ao que o BoaVoz guarda; e o fim da
 * assinatura tira o tamanho dos chatbots e desconecta os canais (a configuração fica guardada). O
 * crédito pago pelo Pix (Lançamento, parte 6) entra quando a Stripe confirma. Erro do banco vira exceção: o webhook
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
  const { data: before } = must(await db.from("bots").select("id, size, volume_packs").in("id", target.bots.map((b) => b.id)));
  const { data: applied } = must(
    await db.rpc("apply_billing_change", { p_change_id: changeId, p_bots: target.bots.map((b) => appliedBotRow(b, now)), p_packs: target.packs, p_replace_packs: true, p_subscription_id: subscriptionId }),
  );
  if (applied) {
    // bot.size_changed de quem mudou de tamanho com a assinatura
    const prev = new Map((before ?? []).map((b) => [b.id as string, { size: isBotSize(b.size) ? (b.size as BotSize) : null, volumePacks: (b.volume_packs as number | null) ?? null }]));
    for (const b of target.bots) {
      const p = prev.get(b.id) ?? { size: null, volumePacks: null };
      const volumePacks = b.size === "volume" ? b.volumePacks : null;
      if (p.size !== b.size || p.volumePacks !== volumePacks) await emitSizeChanged(db, b.id, { status: "applied", size: b.size, volumePacks, previous: p, effectiveAt: now.toISOString() });
    }
    // chatbots com IA a partir de agora: a base é classificada antes das próximas respostas
    classifyGainedAi(db, target.bots);
    // o pagamento que abre a assinatura abre os 7 dias da desistência (Trava da conta grátis, parte 2)
    must(await db.from("agencies").update({ first_paid_at: now.toISOString(), withdrawn_at: null }).eq("id", change.agency_id));
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

/** E-mail do pagamento que falhou: a IA pausa até a fatura ser paga. Função pura. */
export function pastDueEmail(billingUrl: string): [string, string[]] {
  return [
    "Pagamento da assinatura falhou: a IA está pausada",
    [
      "O pagamento da assinatura do BoaVoz não passou. Até a fatura ser paga, a IA fica pausada em todos os chatbots; as mensagens continuam chegando em Conversas para a sua equipe responder.",
      "",
      `Pague a fatura ou troque o cartão em Cobrança: ${billingUrl}`,
      "",
      "A Stripe tenta cobrar de novo por 2 semanas. Sem pagamento, a assinatura é cancelada, os chatbots ficam sem tamanho e o WhatsApp e o Instagram desconectam (nada é apagado).",
    ],
  ];
}

/** Fim da assinatura: os chatbots ficam sem tamanho (sem cota), os canais desconectam e os pacotes saem. */
export async function endSubscription(db: SupabaseClient, customer: string): Promise<void> {
  const { data: agencies } = must(await db.from("agencies").update({ billing_status: "none", stripe_subscription_id: null, billing_cancel_at: null }).eq("stripe_customer_id", customer).select("id"));
  for (const a of agencies ?? []) {
    const id = a.id as string;
    // o retrato do mês para o bot.month_closed (o tamanho que valeu até aqui) e o aviso de cada tamanho que sai
    const { data: sized } = must(await db.from("bots").select("id, size, volume_packs, prorated_month, prorated_quota").eq("agency_id", id).not("size", "is", null));
    const closing = monthBoundsBR(new Date(Date.now() - 5 * 60_000)).firstDay;
    if (sized?.length) await db.from("bot_month_close").upsert(sized.map((b) => ({ bot_id: b.id, month: closing, size: b.size, volume_packs: b.volume_packs, prorated_month: b.prorated_month, prorated_quota: b.prorated_quota })), { onConflict: "bot_id,month" });
    // subida ainda não paga não vale mais (a fatura avulsa é anulada): só a da assinatura fica devida
    await voidPendingUpgrades(db, id, () => true).catch((e) => console.error("assinatura: subidas pendentes", (e as Error).message));
    must(await db.from("bots").update({ size: null, volume_packs: null, pending_size: null, pending_volume_packs: null, pending_from: null, prorated_month: null, prorated_quota: null }).eq("agency_id", id));
    must(await db.from("agency_packs").delete().eq("agency_id", id));
    // sem o Integrações, as pausas que a API fez nas conversas acabam
    await endApiPauses(db, id).catch((e) => console.error("assinatura: pausas da API", (e as Error).message));
    for (const b of sized ?? []) {
      await emitSizeChanged(db, b.id as string, { status: "applied", size: null, volumePacks: null, previous: { size: isBotSize(b.size) ? (b.size as BotSize) : null, volumePacks: (b.volume_packs as number | null) ?? null }, effectiveAt: new Date().toISOString() });
    }
    // sem tamanho, sem canal: o WhatsApp e o Instagram desconectam na hora (a tarefa diária pega o que falhar)
    await disconnectUnsized(db, { agencyId: id }).catch((e) => console.error("assinatura: canais sem tamanho", (e as Error).message));
    // sem o pacote, o domínio próprio sai
    await releaseDomainsWithoutPack(db, { agencyId: id }).catch((e) => console.error("assinatura: domínio sem pacote", (e as Error).message));
    await audit(db, { agencyId: id, actorType: "system", actorId: null, action: "assinatura.encerrar", targetType: "agency", targetId: id });
  }
}

/** Os sinais do pagamento: o documento e os cartões das últimas cobranças. Falha aqui não volta para a Stripe. */
async function paymentSignals(db: SupabaseClient, customer: string | null, taxId: string | null): Promise<void> {
  if (!customer) return;
  try {
    const charges = stripe ? (await stripe.charges.list({ customer, limit: 3 })).data : [];
    const cards = charges.map((c) => c.payment_method_details?.card?.fingerprint).filter((f): f is string => Boolean(f));
    await recordPaymentSignals(db, customer, taxId, cards);
  } catch (e) {
    console.error("trava da conta grátis: sinais do pagamento", (e as Error).message);
  }
}

export async function handleStripeEvent(db: SupabaseClient, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object;
      const changeId = s.metadata?.changeId;
      if (!changeId || s.payment_status === "unpaid") break;
      if (s.mode === "subscription") {
        const sub = typeof s.subscription === "string" ? s.subscription : (s.subscription?.id ?? null);
        await applyCheckout(db, changeId, sub);
      } else if (s.mode === "payment") {
        // crédito pago pelo Pix: a nota a emitir (sem fatura na Stripe) e o crédito
        const record = pixRecord(s);
        await recordFiscalInvoice(db, record);
        await paymentSignals(db, record?.customerId ?? null, record?.takerTaxId ?? null);
        await applyPixCredit(db, changeId);
      }
      break;
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      // o Pix venceu sem pagamento: a compra fica anulada
      const s = event.data.object;
      if (s.mode === "payment" && s.metadata?.changeId) await voidPixCredit(db, s.metadata.changeId);
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
      // cancelada no portal: vale no fim do período (cancel_at); até lá, tudo segue
      const cancelAt = sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null;
      const { data: before } = must(await db.from("agencies").select("id, billing_status").eq("stripe_customer_id", customer));
      const { data: agencies } = must(await db.from("agencies").update({ billing_status: status, stripe_subscription_id: sub.id, billing_cancel_at: cancelAt }).eq("stripe_customer_id", customer).select("id"));
      // o pagamento acabou de falhar: a IA pausa até pagar (regra de estado) e o dono é avisado uma vez
      if (status === "past_due") {
        for (const a of (before ?? []).filter((a) => a.billing_status !== "past_due")) {
          const [subject, lines] = pastDueEmail(appUrl("/painel/cobranca"));
          await notifyAgencyOwner(db, a.id as string, subject, lines).catch(() => false);
          // aviso no WhatsApp do dono, pelo assistente da BoaVoz
          const { sendTeamNotice } = await import("./team-notices");
          const { data: ag } = await db.from("agencies").select("name").eq("id", a.id).maybeSingle();
          await sendTeamNotice(db, { kind: "pagamento", agencyId: a.id as string, vars: [(ag?.name as string | undefined) ?? "sua agência"], path: "painel/cobranca", ref: a.id as string });
        }
      }
      // virada do mês: as trocas agendadas para o dia 1º valem; quem ficou sem tamanho perde os canais
      for (const a of agencies ?? []) {
        must(await db.rpc("apply_due_bot_changes", { p_agency_id: a.id }));
        await disconnectUnsized(db, { agencyId: a.id as string }).catch((e) => console.error("assinatura: canais sem tamanho", (e as Error).message));
        // pacote Domínio próprio tirado vale até o dia 1º: depois, o domínio sai
        await releaseDomainsWithoutPack(db, { agencyId: a.id as string }).catch((e) => console.error("assinatura: domínio sem pacote", (e as Error).message));
      }
      // itens mudados (por nós ou no painel da Stripe): a assinatura fica igual ao que o BoaVoz guarda
      const changedItems = event.type === "customer.subscription.updated" && "items" in ((event.data.previous_attributes ?? {}) as Record<string, unknown>);
      if (changedItems) for (const a of agencies ?? []) await syncSubscriptionSafe(db, a.id as string);
      break;
    }
    case "invoice.paid": {
      // todo pagamento vira nota a emitir (assinatura, subida e crédito no cartão); erro aqui volta
      // para a Stripe tentar de novo (gravar a mesma fatura de novo não duplica)
      const record = invoiceRecord(event.data.object);
      await recordFiscalInvoice(db, record);
      // o documento e o cartão de quem pagou viram sinais da conta (trava da conta grátis e desistência)
      await paymentSignals(db, record?.customerId ?? null, record?.takerTaxId ?? null);
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
    // contestação no cartão e aviso antecipado de fraude (Trava da conta grátis, parte 5)
    case "charge.dispute.created": {
      if (!stripe) break;
      const { onDisputeCreated } = await import("./disputes");
      await onDisputeCreated(db, stripe, event.data.object);
      break;
    }
    case "charge.dispute.updated":
    case "charge.dispute.closed": {
      const { onDisputeChanged } = await import("./disputes");
      await onDisputeChanged(db, event.data.object, event.type === "charge.dispute.closed");
      break;
    }
    case "radar.early_fraud_warning.created": {
      if (!stripe) break;
      const { onEarlyFraudWarning } = await import("./disputes");
      await onEarlyFraudWarning(db, stripe, event.data.object);
      break;
    }
  }
}
