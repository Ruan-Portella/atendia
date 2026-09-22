import { describe, expect, it } from "vitest";
import { initials, normalizeUrl, slugify } from "../utils";

describe("normalizeUrl", () => {
  it("completa https e tira o #", () => {
    expect(normalizeUrl("clinicasorriso.com.br")).toBe("https://clinicasorriso.com.br/");
    expect(normalizeUrl("http://a.com/x#y")).toBe("http://a.com/x");
  });
  it("recusa o que não é site", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("localhost")).toBeNull();
  });
});

describe("slugify / initials", () => {
  it("tira acento e símbolos", () => {
    expect(slugify("Clínica Sorriso & Cia")).toBe("clinica-sorriso-cia");
    expect(slugify("!!!")).toBe("bot");
  });
  it("pega até duas iniciais", () => {
    expect(initials("clínica sorriso feliz")).toBe("CS");
    expect(initials("X")).toBe("X");
  });
});
