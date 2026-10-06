import { describe, expect, it } from "vitest";
import { checkLeadInput, validInstagram, validPhone } from "../lead-input";

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
