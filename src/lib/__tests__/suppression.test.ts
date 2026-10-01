import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blocks, canonicalPhone, contactHash, isOptOutKeyword, optOutConfirmation, suppressionScope } from "../suppression";

describe("opt-out pelo chat", () => {
  it("reconhece SAIR, PARAR e STOP sozinhos, sem diferença de caixa, acento ou pontuação", () => {
    for (const t of ["SAIR", "sair", " Sair. ", "PARAR!", "parar", "stop", "Stop 🙏"]) expect(isOptOutKeyword(t), t).toBe(true);
    for (const t of ["quero sair do grupo", "não pare", "stop motion", "", null]) expect(isOptOutKeyword(t), String(t)).toBe(false);
  });

  it("confirmação fixa pela categoria (Textos legais, seção 6)", () => {
    expect(optOutConfirmation("marketing", "Clínica Sorriso")).toBe("Feito, você não vai mais receber promoções da Clínica Sorriso. O atendimento continua normal por aqui.");
    expect(optOutConfirmation("utility", "Clínica Sorriso")).toBe("Feito, você não vai mais receber lembretes e avisos da Clínica Sorriso. O atendimento continua normal por aqui.");
    expect(optOutConfirmation("all", "Clínica Sorriso")).toBe("Feito, você não vai mais receber promoções nem lembretes da Clínica Sorriso. O atendimento continua normal por aqui.");
  });

  it("supressão de cada categoria bloqueia só o que deve", () => {
    expect(blocks(["marketing"], "MARKETING")).toBe(true);
    expect(blocks(["marketing"], "UTILITY")).toBe(false);
    expect(blocks(["utility"], "UTILITY")).toBe(true);
    expect(blocks(["utility"], "MARKETING")).toBe(false);
    expect(blocks(["all"], "UTILITY")).toBe(true);
    expect(blocks([], "MARKETING")).toBe(false);
  });

  it("escopo: a conta do WhatsApp Business quando existe; senão, o bot", () => {
    expect(suppressionScope({ wabaId: "123", botId: "b1" })).toBe("waba:123");
    expect(suppressionScope({ wabaId: null, botId: "b1" })).toBe("bot:b1");
  });
});

describe("hash do contato", () => {
  beforeEach(() => vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-de-teste-com-mais-de-16"));
  afterEach(() => vi.unstubAllEnvs());

  it("o mesmo celular com e sem o 9 vira um hash só; não guarda o telefone", () => {
    expect(canonicalPhone("552199998888")).toBe("5521999998888");
    expect(contactHash("whatsapp", "552199998888")).toBe(contactHash("whatsapp", "5521999998888"));
    expect(contactHash("whatsapp", "5521999998888")).not.toContain("5521");
    expect(contactHash("whatsapp", "5521999998888")).not.toBe(contactHash("instagram", "5521999998888"));
  });

  it("sem chave de hash, recusa (nunca grava o número em claro)", () => {
    vi.stubEnv("WHATSAPP_TOKEN_KEY", "");
    vi.stubEnv("CONTACT_HASH_KEY", "");
    expect(() => contactHash("whatsapp", "5521999998888")).toThrow();
  });
});
