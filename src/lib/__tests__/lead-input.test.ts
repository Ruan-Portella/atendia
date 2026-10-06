import { describe, expect, it } from "vitest";
import { checkLeadInput, validPhone } from "../lead-input";

describe("dados do lead que a IA manda", () => {
  it("sem nome de verdade ou sem contato, não grava e pede os dados", () => {
    const r = checkLeadInput({ nome: "não informado", whatsapp: "não informado" }, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.instrucao).toMatch(/falta o nome e o WhatsApp/);
    expect(checkLeadInput({ nome: "Ana" }, null).ok).toBe(false);
    expect(checkLeadInput({ nome: "Ana", whatsapp: "123" }, null).ok).toBe(false);
    expect(checkLeadInput({ nome: "Ana", email: "não tem" }, null).ok).toBe(false);
    expect(checkLeadInput({ nome: "Cliente", whatsapp: "21 99999-8888" }, null).ok).toBe(false);
  });

  it("nome e WhatsApp com DDD, ou e-mail; no WhatsApp basta o nome", () => {
    expect(checkLeadInput({ nome: " Ana  Lima ", whatsapp: "(21) 99999-8888" }, null)).toEqual({ ok: true, nome: "Ana Lima", whatsapp: "(21) 99999-8888", email: null });
    expect(checkLeadInput({ nome: "Ana", email: "Ana@Loja.com" }, null)).toEqual({ ok: true, nome: "Ana", whatsapp: null, email: "ana@loja.com" });
    expect(checkLeadInput({ nome: "Ana" }, "5521999998888")).toEqual({ ok: true, nome: "Ana", whatsapp: null, email: null });
  });

  it("telefone válido para o botão do WhatsApp", () => {
    expect(validPhone("não informado")).toBeNull();
    expect(validPhone("21 99999-8888")).toBe("21 99999-8888");
    expect(validPhone(null)).toBeNull();
  });
});
