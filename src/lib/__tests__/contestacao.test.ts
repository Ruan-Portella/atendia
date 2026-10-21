import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

process.env.CONTACT_HASH_KEY ??= "chave-de-teste-com-mais-de-16-caracteres";

// o fim da assinatura e os e-mails ficam de fora: só se confere a chamada
const ended: string[] = [];
vi.mock("../billing-webhook", () => ({ endSubscription: vi.fn(async (_db: unknown, customer: string) => void ended.push(customer)) }));
const mails: string[] = [];
vi.mock("../notify", () => ({
  notifyAgencyOwner: vi.fn(async (_db: unknown, _id: string, subject: string) => (mails.push(`dono: ${subject}`), true)),
  notifyPlatform: vi.fn(async (subject: string) => (mails.push(`suporte: ${subject}`), true)),
}));

import type Stripe from "stripe";
import { memoryDb, type MemRow } from "../memory-db";
import { acceptDispute, buildEvidence, disputeNeedsResponse, disputeOutcome, disputeReasonLabel, onDisputeChanged, onDisputeCreated, onEarlyFraudWarning, submitDisputeEvidence } from "../disputes";
import { signalHash } from "../person-signals";

const AG = "11111111-1111-4111-8111-111111111111";
const OWNER = "u-dono";
const PAID = "2026-10-20T12:00:00.000Z";

function db(tables: Record<string, MemRow[]>) {
  const base = memoryDb(tables);
  const rpcs: Array<[string, Record<string, unknown>]> = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcs.push([fn, args]);
    if (fn === "add_person_signals") {
      (args.p_kinds as string[]).forEach((k, i) => tables.person_signals.push({ agency_id: args.p_agency_id, kind: k, value_hash: (args.p_hashes as string[])[i] }));
      return { data: null, error: null };
    }
    if (fn === "mark_person") return { data: 3, error: null };
    return { data: null, error: { message: `rpc ${fn}` } };
  });
  return { db: new Proxy(base, { get: (t, k) => (k === "rpc" ? rpc : (t as unknown as Record<string | symbol, unknown>)[k]) }) as SupabaseClient, rpcs };
}

function fakeStripe(o: { failUpdate?: boolean } = {}) {
  const calls: string[] = [];
  const stripe = {
    charges: { retrieve: vi.fn(async (id: string) => ({ id, customer: "cus_1", amount: 14900, amount_refunded: 0, currency: "brl", payment_method_details: { card: { fingerprint: "fp-1" } } })) },
    refunds: { create: vi.fn(async (p: { charge: string }, opts: { idempotencyKey: string }) => (calls.push(`estorno ${p.charge} ${opts.idempotencyKey}`), { id: "re_1" })) },
    subscriptions: { cancel: vi.fn(async (id: string) => (calls.push(`cancela ${id}`), { id })) },
    disputes: {
      update: vi.fn(async (id: string, p: { evidence: Record<string, string>; submit: boolean }) => {
        if (o.failUpdate) throw new Error("prazo vencido");
        calls.push(`defesa ${id} ${Object.keys(p.evidence).join(",")} ${p.submit}`);
        return { id };
      }),
      close: vi.fn(async (id: string) => (calls.push(`aceita ${id}`), { id })),
    },
  };
  return { stripe: stripe as never, calls };
}

function tables(): Record<string, MemRow[]> {
  return {
    agencies: [{ id: AG, name: "Agência Teste", owner_id: OWNER, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", first_paid_at: PAID, billing_status: "active", credit_auto_enabled: true, free_blocked_at: null, free_block_reason: null, free_released_at: null }],
    agency_members: [{ id: "m1", agency_id: AG, role: "owner", display_name: "Ruan", email: "dono@agencia.com.br" }],
    access_log: [
      { actor_type: "user", actor_id: OWNER, event: "login", ip: "177.10.20.30", created_at: "2026-10-20T11:55:00.000Z" },
      { actor_type: "user", actor_id: OWNER, event: "session", ip: "177.10.20.31", created_at: "2026-10-21T09:00:00.000Z" },
      { actor_type: "user", actor_id: "outra-pessoa", event: "login", ip: "1.1.1.1", created_at: "2026-10-21T09:00:00.000Z" },
    ],
    atendimentos: [
      { id: 1, agency_id: AG, started_at: "2026-10-20T15:00:00.000Z" },
      { id: 2, agency_id: AG, started_at: "2026-10-21T15:00:00.000Z" },
      { id: 3, agency_id: AG, started_at: "2026-09-21T15:00:00.000Z" },
    ],
    audit_log: [{ agency_id: AG, action: "assinatura.aceite_termos", created_at: "2026-10-20T11:58:00.000Z" }],
    bots: [{ id: "b1", agency_id: AG, name: "Lia", size: "P" }],
    whatsapp_channels: [],
    instagram_channels: [],
    person_signals: [],
    disputes: [],
  };
}

const dispute = (o: Partial<Stripe.Dispute> = {}) => ({ id: "dp_1", charge: "ch_1", amount: 14900, currency: "brl", reason: "fraudulent", status: "needs_response", evidence_details: { due_by: Date.parse("2026-10-30T23:59:00Z") / 1000 }, ...o }) as unknown as Stripe.Dispute;

beforeEach(() => {
  ended.length = 0;
  mails.length = 0;
});

describe("contestação no cartão: puras", () => {
  it("o resultado, o que espera defesa e o motivo em português", () => {
    expect(disputeOutcome("won")).toBe("ganha");
    expect(disputeOutcome("lost")).toBe("perdida");
    expect(disputeOutcome("warning_closed")).toBe("encerrada");
    expect(disputeOutcome("under_review")).toBeNull();
    expect(disputeNeedsResponse("needs_response")).toBe(true);
    expect(disputeNeedsResponse("warning_needs_response")).toBe(true);
    expect(disputeNeedsResponse("under_review")).toBe(false);
    expect(disputeReasonLabel("fraudulent")).toBe("fraude (o titular diz que não reconhece)");
    expect(disputeReasonLabel("novo_motivo")).toBe("novo_motivo");
    expect(disputeReasonLabel(null)).toBe("não informado");
  });
});

describe("contestação no cartão", () => {
  it("o rascunho da defesa: o IP da contratação, as entradas do dono, o uso, o aceite e a desistência oferecida", async () => {
    const e = await buildEvidence(db(tables()).db, AG, { amountCents: 14900, sizes: [{ name: "Lia", size: "P" }] });
    expect(e.customer_name).toBe("Ruan");
    expect(e.customer_email_address).toBe("dono@agencia.com.br");
    expect(e.customer_purchase_ip).toBe("177.10.20.30");
    expect(e.service_date).toBe("2026-10-20");
    expect(e.product_description).toContain("Lia no tamanho P");
    expect(e.access_activity_log).toContain("IP 177.10.20.31");
    expect(e.access_activity_log).not.toContain("1.1.1.1");
    expect(e.access_activity_log).toContain("2 atendimentos feitos pela IA");
    expect(e.access_activity_log).toContain("Termos de Uso aceitos no checkout em 20/10/2026");
    expect(e.refund_policy_disclosure).toContain("disponível até 27/10/2026");
  });

  it("chegou a contestação: guarda com o rascunho, encerra a assinatura, marca a pessoa e avisa; repetida, só atualiza", async () => {
    const t = tables();
    const { db: d, rpcs } = db(t);
    const s = fakeStripe();
    await onDisputeCreated(d, s.stripe, dispute());
    expect(s.calls).toEqual(["cancela sub_1"]);
    expect(ended).toEqual(["cus_1"]);
    expect(rpcs.find(([fn]) => fn === "mark_person")?.[1]).toEqual({ p_agency_id: AG, p_reason: "contestacao", p_months: 12 });
    expect(t.person_signals.some((x) => x.kind === "card" && x.value_hash === signalHash("card", "fp-1"))).toBe(true);
    expect(t.agencies[0]).toMatchObject({ free_block_reason: "marca", credit_auto_enabled: false });
    expect(t.disputes[0]).toMatchObject({ id: "dp_1", agency_id: AG, kind: "contestacao", amount_cents: 14900, reason: "fraudulent", status: "needs_response", due_by: "2026-10-30T23:59:00.000Z" });
    expect((t.disputes[0].evidence as { customer_purchase_ip: string }).customer_purchase_ip).toBe("177.10.20.30");
    expect(t.audit_log.map((a) => a.action)).toContain("assinatura.contestacao");
    expect(mails).toEqual(["dono: Recebemos uma contestação de um pagamento do BoaVoz", "suporte: Contestação de R$ 149,00"]);
    // a Stripe manda de novo: não encerra nem avisa outra vez
    await onDisputeCreated(d, s.stripe, dispute({ status: "warning_needs_response" } as Partial<Stripe.Dispute>));
    expect(s.calls).toEqual(["cancela sub_1"]);
    expect(t.disputes).toHaveLength(1);
    expect(t.disputes[0].status).toBe("warning_needs_response");
  });

  it("o suporte envia a defesa (só os campos preenchidos) ou aceita; o fim da contestação chega pelo webhook", async () => {
    const t = tables();
    t.disputes.push({ id: "dp_1", agency_id: AG, kind: "contestacao", status: "needs_response", evidence: null, closed_at: null, outcome: null });
    const s = fakeStripe();
    expect(await submitDisputeEvidence(db(t).db, s.stripe, "dp_1", { customer_name: "Ruan", uncategorized_text: "resumo", product_description: "  " }, "suporte@boavoz.com")).toEqual({ ok: true });
    expect(s.calls).toEqual(["defesa dp_1 customer_name,uncategorized_text true"]);
    expect(t.disputes[0]).toMatchObject({ status: "under_review", submitted_by: "suporte@boavoz.com" });
    await onDisputeChanged(db(t).db, dispute({ status: "won" } as Partial<Stripe.Dispute>), true);
    expect(t.disputes[0]).toMatchObject({ status: "won", outcome: "ganha" });
    expect(t.disputes[0].closed_at).toBeTruthy();
    expect(mails).toEqual(["suporte: Contestação ganha: R$ 149,00"]);
    const failing = fakeStripe({ failUpdate: true });
    expect(await submitDisputeEvidence(db(t).db, failing.stripe, "dp_1", { customer_name: "Ruan" }, "x")).toEqual({ ok: false, message: "A Stripe recusou a defesa: prazo vencido" });
    expect(await acceptDispute(db(t).db, s.stripe, "dp_1", "suporte@boavoz.com")).toEqual({ ok: true });
    expect(t.disputes[0]).toMatchObject({ outcome: "aceita", status: "lost" });
  });

  it("aviso antecipado de fraude: estorna na hora (uma vez), encerra e marca; o não acionável não estorna", async () => {
    const t = tables();
    const s = fakeStripe();
    const warning = { id: "issfr_1", charge: "ch_1", actionable: true, fraud_type: "made_with_stolen_card" } as unknown as Stripe.Radar.EarlyFraudWarning;
    await onEarlyFraudWarning(db(t).db, s.stripe, warning);
    expect(s.calls).toEqual(["estorno ch_1 aviso-fraude:issfr_1", "cancela sub_1"]);
    expect(t.disputes[0]).toMatchObject({ id: "issfr_1", kind: "aviso_fraude", outcome: "estornada", amount_cents: 14900 });
    expect(mails[0]).toBe("dono: Estornamos um pagamento do BoaVoz por segurança");
    await onEarlyFraudWarning(db(t).db, s.stripe, warning);
    expect(s.calls).toHaveLength(2);
    const t2 = tables();
    const s2 = fakeStripe();
    await onEarlyFraudWarning(db(t2).db, s2.stripe, { ...warning, id: "issfr_2", actionable: false } as Stripe.Radar.EarlyFraudWarning);
    expect(s2.calls).toEqual(["cancela sub_1"]);
    expect(t2.disputes[0]).toMatchObject({ status: "aviso", outcome: null });
  });
});
