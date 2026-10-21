import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

process.env.CONTACT_HASH_KEY ??= "chave-de-teste-com-mais-de-16-caracteres";

import { memoryDb, type MemRow } from "../memory-db";
import { isDisposableEmail } from "../disposable-email";
import { addSignals, freeLinked, freeLinksOf, normalizeEmailSignal, purgeOrphanSignals, recordOwnerPhone, recordSignupSignals, signalHash } from "../person-signals";

/** Banco falso só para o rpc dos sinais (o resto vai para o banco em memória). */
function withRpc(tables: Record<string, MemRow[]>) {
  const db = memoryDb(tables);
  const calls: Array<{ p_agency_id: string; p_kinds: string[]; p_hashes: string[] }> = [];
  const rpc = vi.fn(async (fn: string, args: { p_agency_id: string; p_kinds: string[]; p_hashes: string[] }) => {
    if (fn !== "add_person_signals") return { data: null, error: { message: `rpc ${fn}` } };
    calls.push(args);
    args.p_kinds.forEach((k, i) => tables.person_signals.push({ agency_id: args.p_agency_id, kind: k, value_hash: args.p_hashes[i], orphaned_at: null }));
    return { data: null, error: null };
  });
  return { db: new Proxy(db, { get: (t, k) => (k === "rpc" ? rpc : (t as unknown as Record<string | symbol, unknown>)[k]) }) as SupabaseClient, calls };
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("trava da conta grátis: puras", () => {
  it("o e-mail como sinal: Gmail sem ponto e sem +apelido; os outros, só sem o +apelido", () => {
    expect(normalizeEmailSignal(" J.O.A.O+teste@Gmail.com ")).toBe("joao@gmail.com");
    expect(normalizeEmailSignal("joao@googlemail.com")).toBe("joao@gmail.com");
    expect(normalizeEmailSignal("ana.lima+bot@empresa.com.br")).toBe("ana.lima@empresa.com.br");
    expect(normalizeEmailSignal("sem-arroba")).toBe("sem-arroba");
  });

  it("e-mail descartável, também em subdomínio; os comuns passam", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@abc.guerrillamail.com")).toBe(true);
    expect(isDisposableEmail("x@10minutemail.com")).toBe(true);
    expect(isDisposableEmail("x@gmail.com")).toBe(false);
    expect(isDisposableEmail("x@empresa.com.br")).toBe(false);
    expect(isDisposableEmail("sem-arroba")).toBe(false);
  });

  it("o HMAC muda com o tipo do sinal e nunca leva o valor", () => {
    const h = signalHash("email", "joao@gmail.com");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(signalHash("device", "joao@gmail.com"));
    expect(h).toBe(signalHash("email", "joao@gmail.com"));
  });

  it("presa só sem assinatura, ligada e sem a liberação do suporte", () => {
    expect(freeLinked({ billing_status: "none", free_blocked_at: "2026-10-21T10:00:00Z", free_released_at: null })).toBe(true);
    expect(freeLinked({ billing_status: "none", free_blocked_at: "2026-10-21T10:00:00Z", free_released_at: "2026-10-21T11:00:00Z" })).toBe(false);
    expect(freeLinked({ billing_status: "active", free_blocked_at: "2026-10-21T10:00:00Z", free_released_at: null })).toBe(false);
    expect(freeLinked({ billing_status: "none", free_blocked_at: null, free_released_at: null })).toBe(false);
  });
});

describe("trava da conta grátis: os sinais", () => {
  let tables: Record<string, MemRow[]>;
  beforeEach(() => {
    tables = {
      agencies: [{ id: A, owner_id: "u-a" }, { id: B, owner_id: "u-b" }, { id: C, owner_id: "u-c" }],
      agency_members: [
        { id: "m-dono", agency_id: A, role: "owner" },
        { id: "m-agente", agency_id: A, role: "agent" },
      ],
      person_signals: [],
    };
  });

  it("no cadastro: e-mail normalizado, navegador e IP; o vazio fica de fora", async () => {
    const { db, calls } = withRpc(tables);
    await recordSignupSignals(db, A, { email: "J.oao+1@gmail.com", device: "dev-1", ip: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].p_kinds).toEqual(["email", "device"]);
    expect(calls[0].p_hashes).toEqual([signalHash("email", "joao@gmail.com"), signalHash("device", "dev-1")]);
    await addSignals(db, A, [{ kind: "ip", value: "  " }]);
    expect(calls).toHaveLength(1);
  });

  it("o WhatsApp confirmado só vale como sinal quando é do dono", async () => {
    const { db, calls } = withRpc(tables);
    await recordOwnerPhone(db, "m-agente", "hash-do-numero");
    expect(calls).toHaveLength(0);
    await recordOwnerPhone(db, "m-dono", "hash-do-numero");
    expect(calls[0]).toMatchObject({ p_agency_id: A, p_kinds: ["phone"], p_hashes: [signalHash("phone", "hash-do-numero")] });
  });

  it("as contas ligadas a esta, vivas ou excluídas, com os sinais em comum", async () => {
    const { db } = withRpc(tables);
    await recordSignupSignals(db, A, { email: "joao@gmail.com", device: "dev-1", ip: "1.1.1.1" });
    await recordSignupSignals(db, B, { email: "j.oao@gmail.com", device: "dev-1", ip: "2.2.2.2" });
    await recordSignupSignals(db, C, { email: "outra@empresa.com", device: "dev-9", ip: "1.1.1.1" });
    tables.person_signals.push({ agency_id: null, kind: "device", value_hash: signalHash("device", "dev-1"), orphaned_at: "2026-01-01T00:00:00Z" });
    const links = await freeLinksOf(db, A);
    expect(links.find((l) => l.agencyId === B)?.kinds.sort()).toEqual(["device", "email"]);
    expect(links.find((l) => l.agencyId === C)?.kinds).toEqual(["ip"]);
    expect(links.find((l) => l.agencyId === null)?.kinds).toEqual(["device"]);
    expect(await freeLinksOf(db, "44444444-4444-4444-8444-444444444444")).toEqual([]);
  });

  it("os sinais de conta excluída saem 12 meses depois", async () => {
    const db = memoryDb(tables);
    tables.person_signals.push(
      { agency_id: null, kind: "email", value_hash: "a".repeat(64), orphaned_at: "2025-09-01T00:00:00.000Z" },
      { agency_id: null, kind: "email", value_hash: "b".repeat(64), orphaned_at: "2026-06-01T00:00:00.000Z" },
      { agency_id: A, kind: "email", value_hash: "c".repeat(64), orphaned_at: null },
    );
    expect(await purgeOrphanSignals(db, new Date("2026-10-21T12:00:00Z"))).toBe(1);
    expect(tables.person_signals.map((s) => (s.value_hash as string)[0])).toEqual(["b", "c"]);
  });
});
