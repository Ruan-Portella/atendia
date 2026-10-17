import { describe, expect, it } from "vitest";
import { invoiceRow } from "../billing-view";

const base = { id: "in_1", number: "ABC-0001", created: Date.parse("2026-11-01T03:10:00Z") / 1000, description: null, total: 24_600, status: "paid", hosted_invoice_url: "https://pay", invoice_pdf: "https://pdf", billing_reason: "subscription_cycle" } as const;

describe("faturas na tela de Assinatura", () => {
  it("fatura do mês: 'Assinatura de <mês>', paga, com os links", () => {
    expect(invoiceRow(base as never)).toEqual({ id: "in_1", number: "ABC-0001", created: "2026-11-01T03:10:00.000Z", description: "Assinatura de novembro de 2026", totalCents: 24_600, status: "paga", url: "https://pay", pdf: "https://pdf" });
  });

  it("primeira fatura e fatura avulsa (subida, crédito) com a descrição dela", () => {
    expect(invoiceRow({ ...base, billing_reason: "subscription_create" } as never).description).toBe("Primeira fatura da assinatura (proporcional)");
    const avulsa = invoiceRow({ ...base, billing_reason: "manual", description: "Crédito do excedente (R$ 50,00), válido por 12 meses", status: "open" } as never);
    expect(avulsa.description).toBe("Crédito do excedente (R$ 50,00), válido por 12 meses");
    expect(avulsa.status).toBe("em aberto");
  });

  it("anulada e não cobrável", () => {
    expect(invoiceRow({ ...base, status: "void" } as never).status).toBe("anulada");
    expect(invoiceRow({ ...base, status: "uncollectible" } as never).status).toBe("não cobrável");
  });
});
