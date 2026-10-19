import type { SupabaseClient } from "@supabase/supabase-js";
import { audit, type AuditActor, type requestMeta } from "./audit";
import { choiceLabel, monthBoundsBR, planSizeChange, renewalLabel, type BillingTarget } from "./billing";
import { applyUpgrade, chargeNow, syncSubscriptionSafe, voidPendingUpgrades } from "./billing-sync";
import { emitOverageChanged, emitSizeChanged } from "./billing-events";
import { botHasAi, isBotSize, type BotSize } from "./plans";
import { botQuota } from "./quota";

/*
 * Operações de cobrança que o painel e a API fazem do mesmo jeito (revisão de preços, parte 7):
 * trocar o tamanho de um chatbot (subir cobra a diferença proporcional na hora; descer ou tirar
 * fica para o dia 1º) e ligar o excedente. Quem chama confere quem pode (papel no painel,
 * permissão e escopo na API); aqui ficam a regra, a cobrança, a auditoria e os webhooks.
 */

export interface BillingActor {
  type: AuditActor;
  /** Usuário (painel) ou chave de API. */
  id: string | null;
  /** IP e navegador (painel). */
  meta?: Awaited<ReturnType<typeof requestMeta>>;
}

/** Conta com assinatura: troca tamanho, assina pacote e compra crédito. */
export interface SubscribedAccount {
  id: string;
  billing_status: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
}

export function subscribedAccount(a: { id: string; billing_status: string; stripe_customer_id: string | null; stripe_subscription_id: string | null }): SubscribedAccount | null {
  if (a.billing_status === "none" || !a.stripe_customer_id || !a.stripe_subscription_id) return null;
  return { id: a.id, billing_status: a.billing_status, stripe_customer_id: a.stripe_customer_id, stripe_subscription_id: a.stripe_subscription_id };
}

export type BillingOpCode = "not_found" | "custom_quota" | "past_due" | "not_available" | "failed";

export class BillingOpError extends Error {
  constructor(
    readonly code: BillingOpCode,
    message: string,
  ) {
    super(message);
  }
}

export const PAST_DUE = "O último pagamento está em aberto. Pague a fatura em Pagamento e faturas antes de subir um tamanho ou assinar um pacote.";

async function auditOp(db: SupabaseClient, agencyId: string, actor: BillingActor, action: string, target: { type: string; id: string }, change: { before?: Record<string, unknown>; after?: Record<string, unknown> }) {
  await audit(db, { agencyId, actorType: actor.type, actorId: actor.id, action, targetType: target.type, targetId: target.id, ...change, ...(actor.meta ?? {}) });
}

/** Resultado da troca de tamanho. */
export type SizeChange =
  | { status: "unchanged" }
  | { status: "already_scheduled"; from: string | null }
  /** Uma subida anterior acabou de ser paga e já valeu: confira e escolha de novo. */
  | { status: "paid_meanwhile" }
  | { status: "cancelled"; size: BotSize | null; volumePacks: number | null }
  | { status: "scheduled"; size: BotSize | null; volumePacks: number | null; from: string }
  /** Valeu agora: cobrado na hora (chargedCents) ou, abaixo de R$ 1, na fatura do dia 1º (deferred). */
  | { status: "applied"; size: BotSize | null; volumePacks: number | null; amountCents: number; deferred: boolean }
  /** Cartão recusado ou pedindo autenticação: vale quando a fatura for paga. */
  | { status: "payment_required"; amountCents: number; url: string | null };

/**
 * Troca o tamanho de um chatbot numa conta com assinatura: subir cobra agora a diferença
 * proporcional (e a cota do mês sobe junto); descer ou tirar fica para o dia 1º; voltar ao tamanho
 * atual cancela a troca agendada.
 */
export async function changeSize(db: SupabaseClient, account: SubscribedAccount, botId: string, next: { size: BotSize | null; volumePacks: number | null }, actor: BillingActor): Promise<SizeChange> {
  await db.rpc("apply_due_bot_changes", { p_agency_id: account.id });
  const { data: bot } = await db
    .from("bots")
    .select("id, name, size, volume_packs, quota_override, pending_size, pending_volume_packs, pending_from, prorated_month, prorated_quota")
    .eq("id", botId)
    .eq("agency_id", account.id)
    .eq("is_demo", false)
    .maybeSingle();
  if (!bot) throw new BillingOpError("not_found", "Chatbot não encontrado.");
  if (bot.quota_override !== null) throw new BillingOpError("custom_quota", "Este chatbot tem cota sob medida: o tamanho dele é combinado com a BoaVoz.");
  const size = isBotSize(bot.size) ? (bot.size as BotSize) : null;
  const current = {
    size,
    volumePacks: (bot.volume_packs as number | null) ?? null,
    monthQuota: botQuota({ size, volume_packs: bot.volume_packs as number | null, prorated_month: bot.prorated_month as string | null, prorated_quota: bot.prorated_quota as number | null }),
    pendingSize: bot.pending_size === "none" ? ("none" as const) : isBotSize(bot.pending_size) ? (bot.pending_size as BotSize) : null,
    pendingVolumePacks: (bot.pending_volume_packs as number | null) ?? null,
  };
  const target = { size: next.size, volumePacks: next.size === "volume" ? next.volumePacks : null };
  const previous = { size: current.size, volumePacks: current.volumePacks };
  const plan = planSizeChange(current, next);
  if (plan.kind === "same") return { status: "unchanged" };
  if (plan.kind === "already_scheduled") return { status: "already_scheduled", from: (bot.pending_from as string | null) ?? null };
  if (await voidPendingUpgrades(db, account.id, (t) => t.bots.some((b) => b.id === botId))) return { status: "paid_meanwhile" };

  if (plan.kind === "cancel_pending" || plan.kind === "downgrade") {
    const pending =
      plan.kind === "cancel_pending"
        ? { pending_size: null, pending_volume_packs: null, pending_from: null }
        : { pending_size: next.size ?? "none", pending_volume_packs: target.volumePacks, pending_from: monthBoundsBR().end.toISOString() };
    const { error } = await db.from("bots").update(pending).eq("id", botId).eq("agency_id", account.id);
    if (error) throw new BillingOpError("failed", "Não foi possível salvar. Tente de novo.");
    await syncSubscriptionSafe(db, account.id);
    await auditOp(db, account.id, actor, "assinatura.trocar", { type: "bot", id: botId }, {
      before: { size: current.size, volume_packs: current.volumePacks, pending_size: current.pendingSize },
      after: { agendado: plan.kind === "downgrade" ? choiceLabel(next) : null, a_partir_de: pending.pending_from },
    });
    if (plan.kind === "cancel_pending") {
      await emitSizeChanged(db, botId, { status: "cancelled", size: current.size, volumePacks: current.volumePacks, previous, effectiveAt: new Date().toISOString() });
      return { status: "cancelled", size: current.size, volumePacks: current.volumePacks };
    }
    await emitSizeChanged(db, botId, { status: "scheduled", ...target, previous, effectiveAt: pending.pending_from! });
    return { status: "scheduled", ...target, from: pending.pending_from! };
  }

  if (account.billing_status === "past_due") throw new BillingOpError("past_due", PAST_DUE);
  const description = `${bot.name}: ${choiceLabel(current)} para ${choiceLabel(next)}, proporcional até ${renewalLabel()}`;
  const r = await chargeUpgrade(db, account, { bots: [{ id: botId, ...target }], packs: [] }, plan.amountCents, description, actor);
  if (r.status === "open") return { status: "payment_required", amountCents: plan.amountCents, url: r.url };
  return { status: "applied", ...target, amountCents: plan.amountCents, deferred: r.status === "next_invoice" };
}

/**
 * Cobra uma subida (tamanho ou pacote) na hora, no cartão da assinatura, e aplica se pagou (abaixo
 * de R$ 1, a diferença vai para a fatura do dia 1º e vale na hora). Cartão recusado: a fatura fica
 * aberta (url) e a subida vale quando ela for paga (webhook invoice.paid).
 */
export async function chargeUpgrade(db: SupabaseClient, account: SubscribedAccount, target: BillingTarget, amountCents: number, description: string, actor: BillingActor): Promise<{ status: "paid" | "next_invoice" | "open"; url: string | null }> {
  const { data: change, error } = await db
    .from("billing_changes")
    .insert({ agency_id: account.id, kind: "upgrade", target, amount_cents: amountCents, created_by: actor.type === "user" ? actor.id : null })
    .select("id")
    .single();
  if (error || !change) throw new Error(error?.message ?? "compra não gravada");
  const r = await chargeNow({ stripe_customer_id: account.stripe_customer_id, stripe_subscription_id: account.stripe_subscription_id }, { changeId: change.id as string, agencyId: account.id, amountCents, description });
  if (r.invoiceId) await db.from("billing_changes").update({ stripe_ref: r.invoiceId }).eq("id", change.id);
  await auditOp(db, account.id, actor, "assinatura.subir_pedido", { type: "agency", id: account.id }, { after: { descricao: description, valor_centavos: amountCents, situacao: r.status } });
  if (r.status !== "open") await applyUpgrade(db, change.id as string);
  return { status: r.status, url: r.status === "open" ? r.url : null };
}

/**
 * Liga, desliga ou muda o teto do excedente de um chatbot. Só chatbot com tamanho de IA tem
 * excedente (desligar sempre pode). Devolve o antes e o depois.
 */
export async function setOverage(db: SupabaseClient, agencyId: string, botId: string, o: { enabled: boolean; capBrl: number | null }, actor: BillingActor): Promise<{ before: { overage_enabled: boolean; overage_cap_brl: number | null }; after: { overage_enabled: boolean; overage_cap_brl: number | null } }> {
  const { data: bot } = await db.from("bots").select("id, size, quota_override, overage_enabled, overage_cap_brl, overage_suspended_reason").eq("id", botId).eq("agency_id", agencyId).eq("is_demo", false).maybeSingle();
  if (!bot) throw new BillingOpError("not_found", "Chatbot não encontrado.");
  if (o.enabled && !botHasAi(bot)) throw new BillingOpError("not_available", "O excedente só vale para chatbot com tamanho de IA (P, M, G ou Volume).");
  const before = { overage_enabled: Boolean(bot.overage_enabled), overage_cap_brl: bot.overage_cap_brl === null ? null : Number(bot.overage_cap_brl) };
  const after = { overage_enabled: o.enabled, overage_cap_brl: o.capBrl };
  const { error } = await db.from("bots").update(after).eq("id", botId).eq("agency_id", agencyId);
  if (error) throw new BillingOpError("failed", "Não foi possível salvar. Tente de novo.");
  await auditOp(db, agencyId, actor, "chatbot.excedente", { type: "bot", id: botId }, { before, after });
  if (before.overage_enabled !== after.overage_enabled || before.overage_cap_brl !== after.overage_cap_brl) {
    const suspended = bot.overage_suspended_reason === "pico" || bot.overage_suspended_reason === "ataque" ? bot.overage_suspended_reason : null;
    await emitOverageChanged(db, botId, { enabled: after.overage_enabled, capBrl: after.overage_cap_brl, suspended });
  }
  return { before, after };
}
