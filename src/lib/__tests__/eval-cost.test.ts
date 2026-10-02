import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAiUsageMany } from "../ai-usage";
import { summarizeAiCosts, type AiCostRow } from "../backoffice";

describe("custo das avaliações", () => {
  it("grava cada chamada da avaliação num insert só, com o custo de cada uma", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const db = { from: () => ({ insert }) } as unknown as SupabaseClient;
    await recordAiUsageMany(db, { agencyId: "a1", botId: "b1", kind: "avaliacao" }, [
      { model: "gpt-4.1-mini-2025-04-14", inputTokens: 6000, cachedInputTokens: 5000, outputTokens: 60 },
      { model: "gpt-4.1-mini-2025-04-14", inputTokens: 700, outputTokens: 15 },
      { embeddingModel: "text-embedding-3-small", embeddingTokens: 12 },
    ]);
    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === "avaliacao" && r.agency_id === "a1" && r.bot_id === "b1")).toBe(true);
    expect(rows.every((r) => typeof r.cost_usd === "number")).toBe(true);
    expect(rows[0].cost_usd as number).toBeGreaterThan(0);
    expect(rows[1].cost_usd as number).toBeGreaterThan(0);
    expect(rows[2].model).toBe("text-embedding-3-small");
  });

  it("nada a gravar: não chama o banco", async () => {
    const insert = vi.fn();
    await recordAiUsageMany({ from: () => ({ insert }) } as unknown as SupabaseClient, { agencyId: "a1", kind: "avaliacao" }, []);
    expect(insert).not.toHaveBeenCalled();
  });

  it("entram no custo da plataforma, mas não no custo da agência dona do bot de teste", () => {
    const row = (kind: string, agency: string, cost: number): AiCostRow => ({ kind, model: "gpt-4.1-mini", channel: null, agency_id: agency, calls: 1, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, audio_seconds: 0, cost_usd: cost, unpriced: 0 });
    const s = summarizeAiCosts([row("resposta", "a1", 0.01), row("avaliacao", "a1", 0.5), row("resposta", "a2", 0.02)]);
    expect(s.total.cost).toBeCloseTo(0.53);
    expect(s.byKind.find((k) => k.key === "avaliacao")?.cost).toBeCloseTo(0.5);
    expect(s.byAgency.find((a) => a.key === "a1")?.cost).toBeCloseTo(0.01);
  });
});
