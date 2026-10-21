import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { endSubscription } from "./billing-webhook";
import { addSignals } from "./person-signals";
import { notifyAgencyOwner, notifyPlatform } from "./notify";
import { audit } from "./audit";
import { WITHDRAWAL_MARK_MONTHS, brlCents } from "./plans";
import { company } from "./company";
import { withdrawalUntil } from "./withdrawal";

/*
 * Contestação no cartão (leva Trava da conta grátis, parte 5, 21/10/2026; post do X do Dinzo, 20/10).
 * - Contestação (charge.dispute.created): a assinatura acaba na hora (cobrar de novo um cartão
 *   contestado traz mais contestações, e a Stripe pune a conta inteira do BoaVoz pela taxa delas),
 *   a pessoa fica marcada por 12 meses (como na desistência) e o suporte é avisado com o prazo. O
 *   rascunho da defesa sai sozinho com o que o BoaVoz já registra: as entradas no painel (IP e
 *   hora, o registro do Marco Civil), o uso do período (só contagens, nunca conversa), o aceite
 *   dos termos no checkout e a desistência em 7 dias oferecida e não usada. O suporte revisa no
 *   backoffice e envia pela Stripe (ou aceita a contestação).
 * - Aviso antecipado de fraude (radar.early_fraud_warning.created): o banco avisa antes que o
 *   cartão pode ter sido usado sem o titular saber; o BoaVoz estorna na hora (evita a contestação e
 *   a taxa dela), encerra a assinatura e marca a pessoa.
 */

export type DisputeKind = "contestacao" | "aviso_fraude";

/** Os motivos da Stripe, como o suporte lê. */
export const DISPUTE_REASON_LABEL: Record<string, string> = {
  fraudulent: "fraude (o titular diz que não reconhece)",
  unrecognized: "cobrança não reconhecida",
  duplicate: "cobrança duplicada",
  subscription_canceled: "assinatura cancelada",
  product_unacceptable: "serviço não aceito",
  product_not_received: "serviço não recebido",
  credit_not_processed: "reembolso não processado",
  general: "geral",
  bank_cannot_process: "o banco não conseguiu processar",
  debit_not_authorized: "débito não autorizado",
  customer_initiated: "pedido do cliente",
  incorrect_account_details: "dados da conta errados",
  insufficient_funds: "sem saldo",
  noncompliant: "fora das regras da bandeira",
  // os tipos do aviso antecipado de fraude
  made_with_stolen_card: "cartão roubado",
  made_with_lost_card: "cartão perdido",
  made_with_counterfeit_card: "cartão falsificado",
  unauthorized_use_of_card: "uso do cartão sem autorização",
  card_never_received: "cartão nunca recebido",
  fraudulent_card_application: "cartão pedido com fraude",
  misc: "outro tipo de fraude",
};
export const disputeReasonLabel = (r: string | null | undefined) => (r ? (DISPUTE_REASON_LABEL[r] ?? r) : "não informado");

/** O que a Stripe devolve no fim, como o BoaVoz guarda. Pura. */
export function disputeOutcome(status: string): "ganha" | "perdida" | "encerrada" | null {
  if (status === "won") return "ganha";
  if (status === "lost") return "perdida";
  if (status === "warning_closed" || status === "prevented") return "encerrada";
  return null;
}

/** A contestação ainda espera a defesa? Pura. */
export const disputeNeedsResponse = (status: string) => status === "needs_response" || status === "warning_needs_response";

export interface Evidence {
  customer_name?: string;
  customer_email_address?: string;
  customer_purchase_ip?: string;
  service_date?: string;
  product_description?: string;
  access_activity_log?: string;
  refund_policy_disclosure?: string;
  refund_refusal_explanation?: string;
  cancellation_policy_disclosure?: string;
  uncategorized_text?: string;
}

/** Os campos da defesa que o backoffice mostra para revisar, na ordem. */
export const EVIDENCE_FIELDS: Array<{ key: keyof Evidence; label: string; rows: number }> = [
  { key: "customer_name", label: "Nome do cliente", rows: 1 },
  { key: "customer_email_address", label: "E-mail do cliente", rows: 1 },
  { key: "customer_purchase_ip", label: "IP na contratação", rows: 1 },
  { key: "service_date", label: "Início do serviço (AAAA-MM-DD)", rows: 1 },
  { key: "product_description", label: "O serviço", rows: 3 },
  { key: "access_activity_log", label: "Registro de uso e de acesso", rows: 10 },
  { key: "refund_policy_disclosure", label: "Política de reembolso mostrada", rows: 3 },
  { key: "refund_refusal_explanation", label: "Por que não houve reembolso", rows: 3 },
  { key: "cancellation_policy_disclosure", label: "Política de cancelamento", rows: 2 },
  { key: "uncategorized_text", label: "Resumo para o banco", rows: 6 },
];

const dt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const SIZE_LABEL: Record<string, string> = { atendimento: "Atendimento", P: "P", M: "M", G: "G", volume: "Volume" };

/**
 * O rascunho da defesa (Trava da conta grátis, parte 5): o que provaria a contratação e o uso, com o
 * que o BoaVoz já guarda. Do contato, só contagens: nunca o conteúdo das conversas.
 */
export async function buildEvidence(db: SupabaseClient, agencyId: string, o: { amountCents: number; sizes?: Array<{ name: string; size: string }> } = { amountCents: 0 }): Promise<Evidence> {
  const { data: a } = await db.from("agencies").select("name, owner_id, first_paid_at").eq("id", agencyId).maybeSingle();
  if (!a) return {};
  const since = (a.first_paid_at as string | null) ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: owner }, { data: sessions }, { data: purchase }, { count: atendimentos }, { data: terms }, { data: wa }, { data: ig }] = await Promise.all([
    db.from("agency_members").select("display_name, email").eq("agency_id", agencyId).eq("role", "owner").maybeSingle(),
    db.from("access_log").select("created_at, ip, event").eq("actor_type", "user").eq("actor_id", String(a.owner_id)).gte("created_at", since).order("created_at").limit(60),
    db.from("access_log").select("created_at, ip").eq("actor_type", "user").eq("actor_id", String(a.owner_id)).lte("created_at", since).order("created_at", { ascending: false }).limit(1),
    db.from("atendimentos").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).gte("started_at", since),
    db.from("audit_log").select("created_at").eq("agency_id", agencyId).eq("action", "assinatura.aceite_termos").lte("created_at", since).order("created_at", { ascending: false }).limit(1),
    db.from("whatsapp_channels").select("bot_id, bots!inner(agency_id)").eq("bots.agency_id", agencyId).is("disconnected_at", null),
    db.from("instagram_channels").select("bot_id, bots!inner(agency_id)").eq("bots.agency_id", agencyId).is("disconnected_at", null),
  ]);
  const sizes = o.sizes ?? [];
  const accepted = (terms ?? [])[0]?.created_at as string | undefined;
  const withdrawUntil = a.first_paid_at ? day(withdrawalUntil(a.first_paid_at as string).toISOString()) : null;
  const logLines = ((sessions ?? []) as Array<{ created_at: string; ip: string | null; event: string }>).map((s) => `${dt(s.created_at)} · ${s.event === "login" ? "entrada" : "uso"} do painel${s.ip ? ` · IP ${s.ip}` : ""}`);
  const usage = [
    `Assinatura desde ${day(since)}.`,
    `${atendimentos ?? 0} atendimentos feitos pela IA do serviço desde então.`,
    `${(wa ?? []).length} WhatsApp e ${(ig ?? []).length} Instagram conectados pela conta.`,
    accepted ? `Termos de Uso aceitos no checkout em ${dt(accepted)}.` : null,
  ].filter(Boolean);
  return {
    customer_name: ((owner?.display_name as string | null) ?? (a.name as string)).slice(0, 200),
    customer_email_address: (owner?.email as string | undefined) ?? undefined,
    customer_purchase_ip: ((purchase ?? [])[0]?.ip as string | null | undefined) ?? undefined,
    service_date: new Date(since).toISOString().slice(0, 10),
    product_description: `Assinatura mensal do ${company.brand}, software de atendimento ao cliente com IA (site, WhatsApp e Instagram), para a conta "${a.name}"${sizes.length ? `: ${sizes.map((s) => `${s.name} no tamanho ${SIZE_LABEL[s.size] ?? s.size}`).join(", ")}` : ""}.`,
    access_activity_log: [...usage, "", "Entradas no painel (registro de acesso do Marco Civil):", ...(logLines.length ? logLines : ["(nenhuma no período)"])].join("\n").slice(0, 19_000),
    refund_policy_disclosure: `Os Termos de Uso (seção 3) e a tela de Cobrança oferecem a desistência em 7 dias, com o estorno integral feito pelo próprio cliente no painel, num botão.${withdrawUntil ? ` Nesta assinatura, o botão ficou disponível até ${withdrawUntil}.` : ""}`,
    refund_refusal_explanation: "O cliente não pediu reembolso, não usou a desistência em 7 dias disponível no painel e não procurou o suporte antes de contestar.",
    cancellation_policy_disclosure: "Cancelamento a qualquer momento pelo portal de pagamento, sem fidelidade; a assinatura segue até o fim do mês pago.",
    uncategorized_text: `Serviço digital contratado e usado pelo titular da conta, que entrou no painel pelo próprio e-mail. Valor contestado: ${brlCents(o.amountCents / 100)}. ${usage.join(" ")} A assinatura foi encerrada quando a contestação chegou.`.slice(0, 5_000),
  };
}

type StripeLike = Pick<Stripe, "charges" | "refunds" | "subscriptions" | "disputes">;

/** A conta pela cobrança (o cliente da Stripe) e a impressão do cartão. */
async function accountOfCharge(db: SupabaseClient, stripe: StripeLike, chargeId: string): Promise<{ agencyId: string | null; customer: string | null; card: string | null; charge: Stripe.Charge | null }> {
  const charge = await stripe.charges.retrieve(chargeId).catch(() => null);
  const customer = charge ? (typeof charge.customer === "string" ? charge.customer : (charge.customer?.id ?? null)) : null;
  const { data } = customer ? await db.from("agencies").select("id").eq("stripe_customer_id", customer).maybeSingle() : { data: null };
  return { agencyId: (data?.id as string | undefined) ?? null, customer, card: charge?.payment_method_details?.card?.fingerprint ?? null, charge };
}

/** O fim comum: a assinatura acaba na hora e a pessoa fica marcada por 12 meses. */
async function endAndMark(db: SupabaseClient, stripe: StripeLike, agencyId: string, customer: string, card: string | null, reason: "contestacao") {
  const { data: a } = await db.from("agencies").select("stripe_subscription_id").eq("id", agencyId).maybeSingle();
  if (a?.stripe_subscription_id) await stripe.subscriptions.cancel(a.stripe_subscription_id as string, { prorate: false, invoice_now: false }).catch((e) => console.error("contestação: assinatura já cancelada?", (e as Error).message));
  await endSubscription(db, customer);
  if (card) await addSignals(db, agencyId, [{ kind: "card", value: card }]);
  await db.rpc("mark_person", { p_agency_id: agencyId, p_reason: reason, p_months: WITHDRAWAL_MARK_MONTHS });
  const now = new Date().toISOString();
  await db.from("agencies").update({ credit_auto_enabled: false, free_blocked_at: now, free_block_reason: "marca", free_released_at: null }).eq("id", agencyId);
}

/** O e-mail ao dono quando chega a contestação. Pura. */
export function disputeOwnerEmail(amountCents: number, kind: DisputeKind): [string, string[]] {
  if (kind === "aviso_fraude") {
    return [
      "Estornamos um pagamento do BoaVoz por segurança",
      [
        `O banco do cartão avisou que um pagamento de ${brlCents(amountCents / 100)} pode ter sido feito sem o titular saber. Por segurança, estornamos o valor e a assinatura foi encerrada: os chatbots ficaram sem tamanho e o WhatsApp e o Instagram desconectaram (a configuração continua guardada).`,
        "",
        `Se foi você que pagou, fale com o suporte em ${company.email} antes de assinar de novo.`,
      ],
    ];
  }
  return [
    "Recebemos uma contestação de um pagamento do BoaVoz",
    [
      `O banco do cartão contestou um pagamento de ${brlCents(amountCents / 100)} da assinatura do ${company.brand}. Com o pagamento contestado, a assinatura foi encerrada: os chatbots ficaram sem tamanho e o WhatsApp e o Instagram desconectaram (a configuração continua guardada).`,
      "",
      `Se foi engano (por exemplo, a cobrança não foi reconhecida), fale com o suporte em ${company.email} e retire a contestação no banco. Para pedir dinheiro de volta, o caminho é o suporte; nos 7 dias do pagamento, a desistência fica no próprio painel.`,
    ],
  ];
}

/** charge.dispute.created: guarda, encerra, marca, monta a defesa e avisa. Pode rodar de novo (a Stripe repete). */
export async function onDisputeCreated(db: SupabaseClient, stripe: StripeLike, d: Stripe.Dispute): Promise<void> {
  const chargeId = typeof d.charge === "string" ? d.charge : d.charge.id;
  const { data: seen } = await db.from("disputes").select("id").eq("id", d.id).maybeSingle();
  const acc = await accountOfCharge(db, stripe, chargeId);
  const dueBy = d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000).toISOString() : null;
  if (seen) {
    await db.from("disputes").update({ status: d.status, due_by: dueBy, updated_at: new Date().toISOString() }).eq("id", d.id);
    return;
  }
  let evidence: Evidence | null = null;
  if (acc.agencyId && acc.customer) {
    const { data: sized } = await db.from("bots").select("name, size").eq("agency_id", acc.agencyId).not("size", "is", null);
    evidence = await buildEvidence(db, acc.agencyId, { amountCents: d.amount, sizes: (sized ?? []).map((b) => ({ name: b.name as string, size: b.size as string })) });
    await endAndMark(db, stripe, acc.agencyId, acc.customer, acc.card, "contestacao");
  }
  await db.from("disputes").insert({ id: d.id, agency_id: acc.agencyId, kind: "contestacao", charge_id: chargeId, amount_cents: d.amount, currency: d.currency, reason: d.reason, status: d.status, due_by: dueBy, evidence });
  if (acc.agencyId) {
    await audit(db, { agencyId: acc.agencyId, actorType: "system", actorId: null, action: "assinatura.contestacao", targetType: "agency", targetId: acc.agencyId, after: { valor_centavos: d.amount, motivo: d.reason } });
    const [subject, lines] = disputeOwnerEmail(d.amount, "contestacao");
    await notifyAgencyOwner(db, acc.agencyId, subject, lines).catch(() => false);
  }
  await notifyPlatform(`Contestação de ${brlCents(d.amount / 100)}${acc.agencyId ? "" : " (conta não encontrada)"}`, [`Motivo: ${disputeReasonLabel(d.reason)}.`, dueBy ? `Prazo para a defesa: ${dt(dueBy)}.` : "Sem prazo informado.", "Revise e envie a defesa no backoffice, na ficha da conta (o rascunho já está montado)."]).catch(() => false);
}

/** charge.dispute.updated e charge.dispute.closed: a situação e o resultado. */
export async function onDisputeChanged(db: SupabaseClient, d: Stripe.Dispute, closed: boolean): Promise<void> {
  const outcome = disputeOutcome(d.status);
  const now = new Date().toISOString();
  await db.from("disputes").update({ status: d.status, updated_at: now, ...(outcome ? { outcome } : {}), ...(closed ? { closed_at: now } : {}) }).eq("id", d.id);
  if (closed && outcome) await notifyPlatform(`Contestação ${outcome}: ${brlCents(d.amount / 100)}`, [`Contestação ${d.id}: ${outcome === "ganha" ? "o banco ficou do lado do BoaVoz e o valor fica" : outcome === "perdida" ? "o banco ficou do lado do cliente e o valor voltou para ele" : "encerrada sem disputa"}.`]).catch(() => false);
}

/**
 * radar.early_fraud_warning.created: o banco avisa antes da contestação. Com o aviso "acionável",
 * o BoaVoz estorna na hora (sem taxa de contestação), encerra a assinatura e marca a pessoa.
 */
export async function onEarlyFraudWarning(db: SupabaseClient, stripe: StripeLike, w: Stripe.Radar.EarlyFraudWarning): Promise<void> {
  const chargeId = typeof w.charge === "string" ? w.charge : w.charge.id;
  const { data: seen } = await db.from("disputes").select("id").eq("id", w.id).maybeSingle();
  if (seen) return;
  const acc = await accountOfCharge(db, stripe, chargeId);
  const left = acc.charge ? acc.charge.amount - acc.charge.amount_refunded : 0;
  let outcome: "estornada" | null = null;
  if (w.actionable && left > 0) {
    await stripe.refunds.create({ charge: chargeId, reason: "fraudulent", metadata: { boavoz: "aviso_fraude", warning: w.id } }, { idempotencyKey: `aviso-fraude:${w.id}` });
    outcome = "estornada";
  }
  if (acc.agencyId && acc.customer) await endAndMark(db, stripe, acc.agencyId, acc.customer, acc.card, "contestacao");
  await db.from("disputes").insert({ id: w.id, agency_id: acc.agencyId, kind: "aviso_fraude", charge_id: chargeId, amount_cents: left, currency: acc.charge?.currency ?? "brl", reason: w.fraud_type, status: w.actionable ? "estornado" : "aviso", outcome, closed_at: outcome ? new Date().toISOString() : null });
  if (acc.agencyId) {
    await audit(db, { agencyId: acc.agencyId, actorType: "system", actorId: null, action: "assinatura.aviso_fraude", targetType: "agency", targetId: acc.agencyId, after: { valor_centavos: left, tipo: w.fraud_type, estornado: Boolean(outcome) } });
    const [subject, lines] = disputeOwnerEmail(left, "aviso_fraude");
    await notifyAgencyOwner(db, acc.agencyId, subject, lines).catch(() => false);
  }
  await notifyPlatform(`Aviso antecipado de fraude: ${brlCents(left / 100)}`, [`Tipo: ${w.fraud_type}. ${outcome ? "Estornado na hora e assinatura encerrada." : "Não acionável: nada estornado; a assinatura foi encerrada."}`]).catch(() => false);
}

/** O suporte envia a defesa (revisada) pela Stripe. */
export async function submitDisputeEvidence(db: SupabaseClient, stripe: StripeLike, disputeId: string, evidence: Evidence, by: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const clean = Object.fromEntries(Object.entries(evidence).filter(([, v]) => typeof v === "string" && v.trim())) as Evidence;
  try {
    await stripe.disputes.update(disputeId, { evidence: clean, submit: true });
  } catch (e) {
    return { ok: false, message: `A Stripe recusou a defesa: ${(e as Error).message}` };
  }
  const now = new Date().toISOString();
  const { data: row } = await db.from("disputes").update({ evidence: clean, evidence_submitted_at: now, submitted_by: by, status: "under_review", updated_at: now }).eq("id", disputeId).select("agency_id").maybeSingle();
  await audit(db, { agencyId: (row?.agency_id as string | null) ?? null, actorType: "support", actorId: by, action: "contestacao.defesa", targetType: "dispute", targetId: disputeId });
  return { ok: true };
}

/** O suporte aceita a contestação (fraude de verdade, por exemplo): o valor fica com o cliente. */
export async function acceptDispute(db: SupabaseClient, stripe: StripeLike, disputeId: string, by: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await stripe.disputes.close(disputeId);
  } catch (e) {
    return { ok: false, message: `A Stripe recusou: ${(e as Error).message}` };
  }
  const now = new Date().toISOString();
  const { data: row } = await db.from("disputes").update({ outcome: "aceita", status: "lost", closed_at: now, updated_at: now, submitted_by: by }).eq("id", disputeId).select("agency_id").maybeSingle();
  await audit(db, { agencyId: (row?.agency_id as string | null) ?? null, actorType: "support", actorId: by, action: "contestacao.aceita", targetType: "dispute", targetId: disputeId });
  return { ok: true };
}
