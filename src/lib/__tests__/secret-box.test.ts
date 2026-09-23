import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seal, unseal } from "../secret-box";

describe("secret-box", () => {
  beforeEach(() => vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-de-teste-bem-comprida-123"));
  afterEach(() => vi.unstubAllEnvs());

  it("cifra e decifra, com resultado diferente a cada vez", () => {
    const a = seal("EAAG-token-do-cliente");
    const b = seal("EAAG-token-do-cliente");
    expect(a).not.toBe(b);
    expect(a).not.toContain("EAAG");
    expect(unseal(a)).toBe("EAAG-token-do-cliente");
  });

  it("recusa texto adulterado ou cifrado com outra chave", () => {
    const sealed = seal("123456");
    const [v, iv, tag, data] = sealed.split(".");
    const flipped = data.startsWith("A") ? "B" + data.slice(1) : "A" + data.slice(1);
    expect(() => unseal([v, iv, tag, flipped].join("."))).toThrow();
    vi.stubEnv("WHATSAPP_TOKEN_KEY", "outra-chave-bem-comprida-456");
    expect(() => unseal(sealed)).toThrow();
  });

  it("exige a chave configurada", () => {
    vi.stubEnv("WHATSAPP_TOKEN_KEY", "");
    expect(() => seal("x")).toThrow(/WHATSAPP_TOKEN_KEY/);
  });
});
