import { describe, expect, it, vi } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { applyPixCredit, creditEmail, pixAmountProblem, voidPixCredit } from "../billing-credit";
import { PIX_MAX_BRL } from "../plans";

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const change = (id: string, over: Partial<MemRow> = {}): MemRow => ({ id, agency_id: AGENCY, kind: "credit", status: "pending", amount_cents: 10_000, created_by: USER, target: { credito_centavos: 10_000, via: "pix" }, ...over });

describe("crédito pelo Pix", () => {
  it("o Pix vai até R$ 10.000 por compra", () => {
    expect(pixAmountProblem(PIX_MAX_BRL * 100)).toBeNull();
    expect(pixAmountProblem(PIX_MAX_BRL * 100 + 100)).toMatch(/Pelo Pix, até R\$\s?10\.000/);
  });

  it("o Pix confirmado põe o crédito uma vez só, com a auditoria; o que não é compra de crédito fica de fora", async () => {
    const t: Record<string, MemRow[]> = { billing_changes: [change("c1"), change("c2", { kind: "upgrade" })], audit_log: [] };
    const db = memoryDb(t);
    let applied = false;
    const apply = vi.fn(async () => {
      if (applied) return null;
      applied = true;
      return 15_000;
    });
    expect(await applyPixCredit(db, "c1", apply)).toBe(15_000);
    expect(apply).toHaveBeenCalledWith(db, "c1", "compra");
    expect(t.audit_log).toEqual([expect.objectContaining({ agency_id: AGENCY, actor_type: "user", actor_id: USER, action: "credito.comprar", after: { valor_centavos: 10_000, via: "pix" } })]);
    // o segundo aviso da Stripe (completed e async_payment_succeeded, ou a entrega repetida) não repete nada
    expect(await applyPixCredit(db, "c1", apply)).toBeNull();
    expect(t.audit_log).toHaveLength(1);
    expect(await applyPixCredit(db, "c2", apply)).toBeNull();
    expect(await applyPixCredit(db, "nao-existe", apply)).toBeNull();
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("o Pix vencido anula só a compra de crédito pendente", async () => {
    const t: Record<string, MemRow[]> = { billing_changes: [change("c1"), change("c2", { status: "applied" }), change("c3", { kind: "checkout" })] };
    const db = memoryDb(t);
    expect(await voidPixCredit(db, "c1")).toBe(true);
    expect(await voidPixCredit(db, "c2")).toBe(false);
    expect(await voidPixCredit(db, "c3")).toBe(false);
    expect(t.billing_changes.map((c) => c.status)).toEqual(["void", "applied", "pending"]);
  });

  it("o e-mail do Pix confirmado diz o valor e o saldo", () => {
    const [subject, lines] = creditEmail("pix", { balanceCents: 15_000, amountCents: 10_000, autoOn: false, creditUrl: "https://boavoz.com/painel/cobranca/credito" });
    expect(subject).toMatch(/R\$\s?100,00 recebido pelo Pix/);
    expect(lines.join("\n")).toMatch(/Saldo agora: R\$\s?150,00/);
  });
});
