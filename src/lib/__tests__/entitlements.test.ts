import { describe, expect, it } from "vitest";
import { activeOf, webhookLimit } from "../entitlements";

describe("pacotes da conta", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  it("valem até o dia 1º em que saem; pacote desconhecido não conta", () => {
    expect(
      activeOf(
        [
          { pack: "integracoes", ends_at: null },
          { pack: "dominio", ends_at: "2026-11-01T03:00:00Z" },
          { pack: "plataforma", ends_at: "2026-10-01T03:00:00Z" },
          { pack: "outro", ends_at: null },
        ],
        now,
      ),
    ).toEqual(["integracoes", "dominio"]);
  });

  it("webhooks: um por chatbot no ar, no mínimo 2", () => {
    expect(webhookLimit(0)).toBe(2);
    expect(webhookLimit(1)).toBe(2);
    expect(webhookLimit(5)).toBe(5);
  });
});
