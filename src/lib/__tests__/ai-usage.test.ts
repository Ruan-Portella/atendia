import { describe, expect, it } from "vitest";
import { costUsd } from "../ai-usage";

describe("custo de IA", () => {
  it("resposta: entrada, cache e saída pelo preço do modelo (aceita id com data)", () => {
    // gpt-4o-mini: 0,15 entrada, 0,075 em cache, 0,60 saída (US$ por 1M)
    expect(costUsd({ model: "gpt-4o-mini-2024-07-18", inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000 })).toBe(0.75);
    expect(costUsd({ model: "gpt-4o-mini", inputTokens: 2000, cachedInputTokens: 1000, outputTokens: 0 })).toBe(0.000225);
  });

  it("soma o embedding da pergunta e o áudio", () => {
    expect(costUsd({ embeddingModel: "text-embedding-3-small", embeddingTokens: 1_000_000 })).toBe(0.02);
    expect(costUsd({ audioModel: "gpt-4o-mini-transcribe", audioSeconds: 120 })).toBe(0.006);
  });

  it("modelos gpt-5: o id mais longo vence (gpt-5-mini não é cobrado como gpt-5)", () => {
    // gpt-5-mini: 0,25 entrada, 0,025 em cache, 2,00 saída
    expect(costUsd({ model: "gpt-5-mini-2025-08-07", inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 })).toBe(0.25);
    expect(costUsd({ model: "gpt-5-mini", inputTokens: 1000, cachedInputTokens: 1000, outputTokens: 1000 })).toBe(0.002025);
    expect(costUsd({ model: "gpt-5.4-nano", inputTokens: 1_000_000, outputTokens: 0 })).toBe(0.2);
    expect(costUsd({ model: "gpt-5", inputTokens: 1_000_000, outputTokens: 0 })).toBe(1.25);
  });

  it("modelo sem preço conhecido fica sem custo (não chuta)", () => {
    expect(costUsd({ model: "modelo-novo", inputTokens: 10, outputTokens: 10 })).toBeNull();
    expect(costUsd({ model: "gpt-4.1", inputTokens: 10, outputTokens: 10 })).not.toBeNull();
  });
});
