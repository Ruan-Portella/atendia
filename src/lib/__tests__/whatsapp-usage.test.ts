import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateCost, recordUsage, referencePrices, usageRow } from "../whatsapp-usage";

describe("usageRow", () => {
  it("lê categoria, cobrança e o mês no horário de Brasília", () => {
    // 1º de outubro, 01:30 em UTC = ainda 30 de setembro em Brasília
    const ts = String(Date.UTC(2026, 9, 1, 1, 30) / 1000);
    const row = usageRow("b1", "p1", { id: "wamid.1", status: "sent", timestamp: ts, pricing: { billable: true, category: "service", type: "regular" } });
    expect(row).toMatchObject({ message_id: "wamid.1", bot_id: "b1", period: "2026-09", category: "service", billable: true, pricing_type: "regular" });
  });

  it("status sem preço não vira consumo", () => {
    expect(usageRow("b1", "p1", { id: "wamid.2", status: "read" })).toBeNull();
    expect(usageRow("b1", "p1", { status: "sent", pricing: { category: "service" } })).toBeNull();
  });

  it("billable ausente conta como não cobrada", () => {
    expect(usageRow("b1", "p1", { id: "w", pricing: { category: "utility" } })?.billable).toBe(false);
  });
});

describe("recordUsage", () => {
  it("grava uma linha por mensagem, mesmo com sent/delivered/read no mesmo webhook", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const db = { from: vi.fn(() => ({ upsert })) } as unknown as SupabaseClient;
    const pricing = { billable: false, category: "service", type: "free_customer_service" };
    await recordUsage(db, "b1", "p1", [
      { id: "w1", status: "sent", pricing },
      { id: "w1", status: "delivered", pricing },
      { id: "w2", status: "sent", pricing },
      { id: "w3", status: "read" },
    ]);
    expect(upsert.mock.calls[0][0].map((r: { message_id: string }) => r.message_id)).toEqual(["w1", "w2"]);
    expect(upsert.mock.calls[0][1]).toMatchObject({ onConflict: "message_id", ignoreDuplicates: true });
  });
});

describe("preços e estimativa", () => {
  it("valores de referência podem ser trocados pelo .env", () => {
    expect(referencePrices("")).toEqual({ service: 0.035, utility: 0.035 });
    expect(referencePrices("marketing=0.35, service=0.04, lixo, x=abc")).toEqual({ service: 0.04, utility: 0.035, marketing: 0.35 });
  });

  it("soma só o que foi cobrado e aponta categoria sem preço", () => {
    const r = estimateCost(
      [
        { category: "service", sent: 1200, billed: 200 },
        { category: "utility", sent: 10, billed: 0 },
        { category: "marketing", sent: 5, billed: 5 },
      ],
      { service: 0.035, utility: 0.035 },
    );
    expect(r.total).toBeCloseTo(7);
    expect(r.unpriced).toEqual(["marketing"]);
  });
});
