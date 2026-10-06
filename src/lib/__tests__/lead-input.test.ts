import { describe, expect, it } from "vitest";
import { checkLeadInput, contactWasTyped, nameWasGiven, validInstagram, validPhone } from "../lead-input";

describe("dados do lead que a IA manda", () => {
  it("sem nome de verdade ou sem contato, não grava e pede os dados", () => {
    const r = checkLeadInput({ nome: "não informado", whatsapp: "não informado" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.instrucao).toMatch(/falta o nome e um contato/);
    expect(checkLeadInput({ nome: "Ana" }).ok).toBe(false);
    expect(checkLeadInput({ nome: "Ana", whatsapp: "123" }).ok).toBe(false);
    expect(checkLeadInput({ nome: "Ana", email: "não tem" }).ok).toBe(false);
    expect(checkLeadInput({ nome: "Ana", instagram: "sem instagram" }).ok).toBe(false);
    expect(checkLeadInput({ nome: "Cliente", whatsapp: "21 99999-8888" }).ok).toBe(false);
  });

  it("nome e um contato: WhatsApp com DDD, e-mail ou @ do Instagram", () => {
    expect(checkLeadInput({ nome: " Ana  Lima ", whatsapp: "(21) 99999-8888" })).toEqual({ ok: true, nome: "Ana Lima", whatsapp: "(21) 99999-8888", email: null, instagram: null });
    expect(checkLeadInput({ nome: "Ana", email: "Ana@Loja.com" })).toMatchObject({ ok: true, email: "ana@loja.com" });
    expect(checkLeadInput({ nome: "Ana", instagram: "@Ana.Lima" })).toMatchObject({ ok: true, instagram: "@ana.lima" });
  });

  it("no WhatsApp e no Instagram, a conversa já é o contato: basta o nome", () => {
    expect(checkLeadInput({ nome: "Ana" }, { phone: "5521999998888" })).toMatchObject({ ok: true, nome: "Ana" });
    expect(checkLeadInput({ nome: "Ana" }, { instagram: true })).toMatchObject({ ok: true, nome: "Ana", instagram: null });
    expect(checkLeadInput({ nome: "não informado" }, { instagram: true }).ok).toBe(false);
  });

  it("telefone e @ válidos", () => {
    expect(validPhone("não informado")).toBeNull();
    expect(validPhone("21 99999-8888")).toBe("21 99999-8888");
    expect(validPhone(null)).toBeNull();
    expect(validInstagram("https://www.instagram.com/bar.do.ze/")).toBe("@bar.do.ze");
    expect(validInstagram("fulano_1")).toBe("@fulano_1");
    expect(validInstagram("@")).toBeNull();
    expect(validInstagram("não tenho")).toBeNull();
  });
});

describe("depois de registrar o lead", () => {
  it("a IA confirma o retorno pelo próprio canal e não pede mais dados", async () => {
    const { leadSavedNote } = await import("../lead-input");
    expect(leadSavedNote("instagram")).toContain("por aqui, pelo Instagram");
    expect(leadSavedNote("whatsapp")).toContain("por aqui, pelo WhatsApp");
    expect(leadSavedNote("widget")).not.toContain("por aqui");
    expect(leadSavedNote("instagram")).toMatch(/Não peça mais nenhum dado/);
  });
});

describe("nome dito pela pessoa", () => {
  it("o nome precisa aparecer no que a pessoa escreveu ou num nome já conhecido", () => {
    expect(nameWasGiven("Ruan", ["quero uma pizza", "Ruan"])).toBe(true);
    expect(nameWasGiven("Ruan Portella", ["meu nome é ruan"])).toBe(true);
    expect(nameWasGiven("José", ["sou o Jose"])).toBe(true);
    expect(nameWasGiven("Maria", ["quero uma pizza", "Não, só a calabresa"])).toBe(false);
    expect(nameWasGiven("Ana Souza", ["oi"])).toBe(false);
  });

  it("lead com nome inventado é recusado; com o nome do perfil do WhatsApp, aceito", () => {
    const said = ["quero pedir uma pizza", "Calabresa", "Não, só a calabresa"];
    expect(checkLeadInput({ nome: "Maria" }, { instagram: true, said }).ok).toBe(false);
    expect(checkLeadInput({ nome: "Ruan" }, { instagram: true, said: [...said, "Ruan"] }).ok).toBe(true);
    expect(checkLeadInput({ nome: "Carla" }, { phone: "5511999990000", said: ["pode sim", "Carla"] }).ok).toBe(true);
    // sem a lista (chamadas antigas), não confere
    expect(checkLeadInput({ nome: "Maria" }, { instagram: true }).ok).toBe(true);
  });
});

describe("contato que a pessoa escreveu", () => {
  it("@ montado a partir do nome não conta; o @ digitado, sim", () => {
    expect(contactWasTyped("instagram", "@ruan", ["quero uma pizza", "Ruan"])).toBe(false);
    expect(contactWasTyped("instagram", "@mrtnsruan", ["meu insta é @mrtnsruan"])).toBe(true);
    expect(contactWasTyped("instagram", "@mrtnsruan", ["instagram.com/mrtnsruan"])).toBe(true);
    expect(contactWasTyped("instagram", "@ruan", ["meu insta é @mrtnsruan"])).toBe(false);
    expect(contactWasTyped("instagram", "@ana.souza", ["meu insta é ana.souza"])).toBe(true);
    expect(contactWasTyped("instagram", "@ana.souza", ["meu insta é anaxsouza"])).toBe(false);
    expect(contactWasTyped("instagram", "@ruan", ["Ruan", "pode me chamar no insta"])).toBe(false);
  });

  it("WhatsApp pelos últimos 8 dígitos, com ou sem 55 e formatação; e-mail exato", () => {
    expect(contactWasTyped("whatsapp", "5511999990000", ["meu whats é (11) 99999-0000"])).toBe(true);
    expect(contactWasTyped("whatsapp", "11 98888-7777", ["meu whats é (11) 99999-0000"])).toBe(false);
    expect(contactWasTyped("email", "ana@x.com", ["pode ser Ana@X.com"])).toBe(true);
    expect(contactWasTyped("email", "ana@x.com", ["Ana"])).toBe(false);
  });

  it("no Instagram, @ inventado fica de fora e o lead vale pela conta do Direct", () => {
    const r = checkLeadInput({ nome: "Ruan", instagram: "@ruan" }, { instagram: true, said: ["quero uma pizza", "Ruan"] });
    expect(r).toMatchObject({ ok: true, nome: "Ruan", instagram: null });
  });

  it("no site, contato inventado fica de fora e falta contato", () => {
    const r = checkLeadInput({ nome: "Ruan", whatsapp: "11999990000" }, { said: ["quero orçamento", "Ruan"] });
    expect(r.ok).toBe(false);
    expect(checkLeadInput({ nome: "Ruan", whatsapp: "11999990000" }, { said: ["Ruan, 11 99999-0000"] })).toMatchObject({ ok: true, whatsapp: "11999990000" });
  });
});
