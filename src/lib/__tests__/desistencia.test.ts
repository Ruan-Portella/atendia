import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

process.env.CONTACT_HASH_KEY ??= "chave-de-teste-com-mais-de-16-caracteres";

// o fim da assinatura (tamanhos, canais, pacotes) e os e-mails ficam de fora: só se confere a chamada
const ended: string[] = [];
vi.mock("../billing-webhook", () => ({ endSubscription: vi.fn(async (_db: unknown, customer: string) => void ended.push(customer)) }));
const mails: string[] = [];
vi.mock("../notify", () => ({
  notifyAgencyOwner: vi.fn(async (_db: unknown, _id: string, subject: string) => (mails.push(`dono: ${subject}`), true)),
  notifyPlatform: vi.fn(async (subject: string) => (mails.push(`suporte: ${subject}`), true)),
}));

import { memoryDb, type MemRow } from "../memory-db";
import { withdraw, withdrawalState, withdrawalUntil } from "../withdrawal";
import { signalHash } from "../person-signals";

const AG = "11111111-1111-4111-8111-111111111111";
const PAID = "2026-10-20T12:00:00.000Z";
const NOW = new Date("2026-10-22T12:00:00.000Z");

/** O banco em memória com os rpc da trava (marcar e conferir a marca, gravar sinais). */
function db(tables: Record<string, MemRow[]>, o: { marked?: boolean } = {}) {
  const base = memoryDb(tables);
  const rpcs: Array<[string, Record<string, unknown>]> = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcs.push([fn, args]);
    if (fn === "person_marked") return { data: Boolean(o.marked), error: null };
    if (fn === "add_person_signals") {
      (args.p_kinds as string[]).forEach((k, i) => tables.person_signals.push({ agency_id: args.p_agency_id, kind: k, value_hash: (args.p_hashes as string[])[i] }));
      return { data: null, error: null };
    }
    if (fn === "mark_person") return { data: tables.person_signals.filter((s) => s.agency_id === args.p_agency_id && s.kind !== "ip").length, error: null };
    return { data: null, error: { message: `rpc ${fn}` } };
  });
  return { db: new Proxy(base, { get: (t, k) => (k === "rpc" ? rpc : (t as unknown as Record<string | symbol, unknown>)[k]) }) as SupabaseClient, rpcs };
}

function fakeStripe(o: { failOn?: string } = {}) {
  const refunds: Array<{ charge: string; key: string }> = [];
  const canceled: string[] = [];
  const charge = (id: string, amount: number, refunded = 0, status = "succeeded", fp = "fp-cartao-1") => ({ id, amount, amount_refunded: refunded, status, payment_method_details: { card: { fingerprint: fp } } });
  const stripe = {
    charges: { list: vi.fn(async () => ({ data: [charge("ch_assinatura", 14900), charge("ch_credito", 10000, 2000), charge("ch_falhou", 5000, 0, "failed")] })) },
    refunds: {
      create: vi.fn(async (p: { charge: string }, opts: { idempotencyKey: string }) => {
        if (p.charge === o.failOn) throw new Error("cartão expirado");
        refunds.push({ charge: p.charge, key: opts.idempotencyKey });
        return { id: `re_${p.charge}` };
      }),
    },
    subscriptions: { cancel: vi.fn(async (id: string) => (canceled.push(id), { id })) },
  };
  return { stripe: stripe as never, refunds, canceled };
}

function tables(): Record<string, MemRow[]> {
  return {
    agencies: [{ id: AG, name: "Agência Teste", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", first_paid_at: PAID, withdrawn_at: null, billing_status: "active", credit_auto_enabled: true, free_blocked_at: null, free_block_reason: null, free_released_at: null }],
    credit_lots: [
      { id: 1, agency_id: AG, source: "compra", remaining_cents: 8000, created_at: "2026-10-21T10:00:00.000Z" },
      { id: 2, agency_id: AG, source: "compra", remaining_cents: 3000, created_at: "2026-09-01T10:00:00.000Z" },
      { id: 3, agency_id: AG, source: "ajuste", remaining_cents: 500, created_at: "2026-10-21T10:00:00.000Z" },
    ],
    fiscal_invoices: [
      { id: "f1", agency_id: AG, status: "a_emitir", paid_at: PAID, refunded_at: null },
      { id: "f2", agency_id: AG, status: "emitida", paid_at: "2026-10-21T09:00:00.000Z", refunded_at: null },
      { id: "f3", agency_id: AG, status: "a_emitir", paid_at: "2026-09-01T09:00:00.000Z", refunded_at: null },
    ],
    person_signals: [{ agency_id: AG, kind: "email", value_hash: "e".repeat(64) }],
    withdrawals: [],
    audit_log: [],
  };
}

beforeEach(() => {
  ended.length = 0;
  mails.length = 0;
});

describe("desistência em 7 dias: a janela", () => {
  it("7 dias do pagamento que abriu a assinatura", () => {
    expect(withdrawalUntil(PAID).toISOString()).toBe("2026-10-27T12:00:00.000Z");
  });

  it("aberta, pelo suporte (pessoa marcada), fora do prazo, sem assinatura e feita", async () => {
    const a = { id: AG, billing_status: "active", first_paid_at: PAID, withdrawn_at: null };
    expect(await withdrawalState(db(tables()).db, a, NOW)).toEqual({ kind: "open", since: PAID, until: "2026-10-27T12:00:00.000Z" });
    expect((await withdrawalState(db(tables(), { marked: true }).db, a, NOW)).kind).toBe("support");
    expect((await withdrawalState(db(tables()).db, a, new Date("2026-10-27T12:00:01Z"))).kind).toBe("none");
    expect((await withdrawalState(db(tables()).db, { ...a, billing_status: "none" }, NOW)).kind).toBe("none");
    expect(await withdrawalState(db(tables()).db, { ...a, billing_status: "none", withdrawn_at: "2026-10-22T10:00:00Z" }, NOW)).toEqual({ kind: "done", at: "2026-10-22T10:00:00Z" });
    // assinou de novo depois de desistir: a assinatura nova tem a sua janela
    expect((await withdrawalState(db(tables()).db, { ...a, withdrawn_at: "2026-10-01T10:00:00Z" }, NOW)).kind).toBe("open");
  });
});

describe("desistência em 7 dias: fazer", () => {
  it("estorna o que sobrou de cada cobrança, encerra, tira o crédito da semana, marca a pessoa e avisa", async () => {
    const t = tables();
    const { db: d, rpcs } = db(t);
    const s = fakeStripe();
    const r = await withdraw(d, s.stripe, AG, { via: "painel", actor: "u-dono" }, NOW);
    expect(r).toEqual({ ok: true, refundedCents: 14900 + 8000 });
    // a cobrança que falhou não volta; a parcialmente estornada volta só o resto; a chave evita estorno duplicado
    expect(s.refunds).toEqual([
      { charge: "ch_assinatura", key: `desistencia:${AG}:ch_assinatura` },
      { charge: "ch_credito", key: `desistencia:${AG}:ch_credito` },
    ]);
    expect(s.canceled).toEqual(["sub_1"]);
    expect(ended).toEqual(["cus_1"]);
    // o crédito comprado na semana sai; o de antes e o ajuste da BoaVoz ficam
    expect(t.credit_lots.map((l) => l.remaining_cents)).toEqual([0, 3000, 500]);
    // a nota a emitir vira estornada; a emitida fica marcada para cancelar; a de antes não muda
    expect(t.fiscal_invoices.map((f) => [f.status, Boolean(f.refunded_at)])).toEqual([["estornada", true], ["emitida", true], ["a_emitir", false]]);
    // o cartão vira sinal e a pessoa fica marcada por 12 meses
    expect(t.person_signals.some((x) => x.kind === "card" && x.value_hash === signalHash("card", "fp-cartao-1"))).toBe(true);
    expect(rpcs.find(([fn]) => fn === "mark_person")?.[1]).toEqual({ p_agency_id: AG, p_reason: "desistencia", p_months: 12 });
    expect(t.agencies[0]).toMatchObject({ withdrawn_at: NOW.toISOString(), credit_auto_enabled: false, free_block_reason: "marca" });
    expect(t.withdrawals[0]).toMatchObject({ via: "painel", actor: "u-dono", refunded_cents: 22900, status: "feita", refund_ids: ["re_ch_assinatura", "re_ch_credito"] });
    expect(t.audit_log.map((a) => a.action)).toContain("assinatura.desistencia");
    expect(mails).toEqual(["dono: Desistência da assinatura confirmada", "suporte: Desistência: Agência Teste"]);
    // de novo: já foi feita
    expect(await withdraw(d, s.stripe, AG, { via: "painel", actor: "u-dono" }, NOW)).toEqual({ ok: false, message: "A desistência desta assinatura já foi feita." });
  });

  it("estorno que falha não encerra nada: fica o registro com o erro e o suporte é avisado", async () => {
    const t = tables();
    const s = fakeStripe({ failOn: "ch_credito" });
    const r = await withdraw(db(t).db, s.stripe, AG, { via: "painel", actor: "u-dono" }, NOW);
    expect(r.ok).toBe(false);
    expect(s.canceled).toEqual([]);
    expect(ended).toEqual([]);
    expect(t.agencies[0].withdrawn_at).toBeNull();
    expect(t.withdrawals[0]).toMatchObject({ status: "erro", refunded_cents: 14900, error: "cartão expirado" });
    expect(mails).toEqual(["suporte: Desistência com erro no estorno: Agência Teste"]);
  });
});
