import { describe, expect, it } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { firstWeekCreditProblem, firstWeekCreditText } from "../billing-credit";
import { firstWeekUntil } from "../withdrawal";
import { firstWeekEmail } from "../atendimentos";

const AG = "11111111-1111-4111-8111-111111111111";
const PAID = "2026-10-20T12:00:00.000Z";
const IN_WEEK = new Date("2026-10-22T12:00:00.000Z");
const AFTER = new Date("2026-10-27T12:00:01.000Z");

function tables(changes: MemRow[] = []): Record<string, MemRow[]> {
  return {
    agencies: [{ id: AG, first_paid_at: PAID, billing_status: "active" }],
    billing_changes: changes.map((c) => ({ agency_id: AG, created_at: "2026-10-21T10:00:00.000Z", ...c })),
  };
}

describe("primeira semana da assinatura", () => {
  it("vale nos 7 dias do pagamento que abriu a assinatura", () => {
    expect(firstWeekUntil({ billing_status: "active", first_paid_at: PAID }, IN_WEEK)).toBe("2026-10-27T12:00:00.000Z");
    expect(firstWeekUntil({ billing_status: "active", first_paid_at: PAID }, AFTER)).toBeNull();
    expect(firstWeekUntil({ billing_status: "none", first_paid_at: PAID }, IN_WEEK)).toBeNull();
    expect(firstWeekUntil({ billing_status: "active", first_paid_at: null }, IN_WEEK)).toBeNull();
  });

  it("o crédito da semana soma as compras e as recargas (as do Pix pendentes também; as anuladas, não)", async () => {
    const db = memoryDb(tables([
      { kind: "credit", amount_cents: 5000, status: "applied" },
      { kind: "credit", amount_cents: 3000, status: "void" },
      { kind: "upgrade", amount_cents: 9900, status: "applied" },
      { kind: "credit", amount_cents: 2000, status: "applied", created_at: "2026-10-01T10:00:00.000Z" },
    ]));
    expect(await firstWeekCreditProblem(db, AG, 5000, IN_WEEK)).toBeNull();
    expect(await firstWeekCreditProblem(db, AG, 5100, IN_WEEK)).toBe(firstWeekCreditText(5000, "27/10"));
    expect(await firstWeekCreditProblem(db, AG, 50_000, AFTER)).toBeNull();
    const full = memoryDb(tables([{ kind: "recarga", amount_cents: 10_000, status: "pending" }]));
    expect(await firstWeekCreditProblem(full, AG, 5000, IN_WEEK)).toBe(firstWeekCreditText(0, "27/10"));
  });

  it("os textos dizem o limite, o que ainda cabe e quando acaba", () => {
    expect(firstWeekCreditText(5000, "27/10")).toMatch(/ainda cabem R\$\s50/);
    expect(firstWeekCreditText(0, "27/10")).toContain("já chegou a esse valor");
    const [subject, lines] = firstWeekEmail({ name: "Lia", clientName: "Bar do Zé" }, "27/10", "https://dev.boavoz.com/painel/cobranca/uso");
    expect(subject).toBe("Primeira semana da assinatura: o chatbot Lia (Bar do Zé) usou o que a semana libera");
    expect(lines.join(" ")).toContain("até 25% da cota do mês");
    expect(lines.join(" ")).toContain("até 27/10");
  });
});
