import { describe, expect, it } from "vitest";
import { isAccountProfile, parseFirstAccess } from "../first-access";
import { agencySlug } from "../agency";

const form = (v: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return fd;
};

describe("primeiro acesso", () => {
  it("aceita os três perfis e mais nada", () => {
    expect(["agency", "business", "developer"].every(isAccountProfile)).toBe(true);
    expect(isAccountProfile("toString")).toBe(false);
    expect(parseFirstAccess(form({ account_name: "Norte", display_name: "Ana" }))).toEqual({ ok: false, message: "Escolha como você vai usar o BoaVoz." });
  });

  it("limpa os espaços e devolve o número como veio", () => {
    expect(parseFirstAccess(form({ profile: "business", account_name: "  Clínica   Sorriso ", display_name: " Ana  Souza ", phone: " (41) 99999-0000 " }))).toEqual({
      ok: true,
      value: { profile: "business", accountName: "Clínica Sorriso", displayName: "Ana Souza", phone: "(41) 99999-0000" },
    });
  });

  it("o nome da conta usa o rótulo do perfil, e o da pessoa, as regras de Meu perfil", () => {
    expect(parseFirstAccess(form({ profile: "business", account_name: "C", display_name: "Ana" }))).toEqual({ ok: false, message: "Nome do seu negócio: escreva pelo menos 2 letras." });
    expect(parseFirstAccess(form({ profile: "agency", account_name: "Norte", display_name: "A" }))).toEqual({ ok: false, message: "Escreva o seu nome (pelo menos 2 letras)." });
    expect(parseFirstAccess(form({ profile: "agency", account_name: "Norte", display_name: "<b>Ana</b>" }))).toEqual({ ok: false, message: "Use só letras, números e espaços no seu nome." });
  });

  it("o slug acompanha o nome novo e mantém o sufixo", () => {
    expect(agencySlug("ruanmorales29-x7k2", "Clínica Sorriso")).toBe("clinica-sorriso-x7k2");
    expect(agencySlug("clinica-sorriso-x7k2", "Clínica Sorriso")).toBe("clinica-sorriso-x7k2");
  });
});
