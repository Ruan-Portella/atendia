import { describe, expect, it } from "vitest";
import { auditFields } from "../audit-view";

describe("o antes e depois da auditoria, sem JSON", () => {
  it("campos com nome de gente e o que mudou", () => {
    expect(auditFields({ papel: "admin", escopo: "all" }, { papel: "editor", escopo: "all" })).toEqual([
      { label: "Papel", before: "Administrador", after: "Editor", changed: true },
      { label: "O que vê", before: "Todos os clientes", after: "Todos os clientes", changed: false },
    ]);
  });

  it("só um lado: o que foi registrado", () => {
    expect(auditFields(null, { email: "a@b.com", aceito: true })).toEqual([
      { label: "E-mail", before: null, after: "a@b.com", changed: false },
      { label: "Aceitou o convite", before: null, after: "Sim", changed: false },
    ]);
  });

  it("reais, datas, ids, listas e objetos", () => {
    const rows = auditFields(null, {
      valor_centavos: 3679,
      ate: "2026-10-23T17:15:00.000Z",
      modelo: "6a4f8858-fac9-4707-9cd7-8a7fe35233d5",
      palavras: ["eu quero", "quero"],
      chatbots: [{ id: "x" }, { id: "y" }],
      de: { size: "atendimento", volume_packs: null },
      allow_hours: false,
      vazio: [],
    });
    // o real vem com o espaço fixo do toLocaleString
    expect(rows.map((r) => [r.label, r.after?.replace(/[^\S ]/g, " ")])).toEqual([
      ["Valor", "R$ 36,79"],
      ["Até", "23/10/2026, 14:15"],
      ["Modelo", "6a4f8858…"],
      ["Palavras", "eu quero, quero"],
      ["Chatbots", "2 itens"],
      ["De", "tamanho: atendimento; volume packs: —"],
      ["Allow hours", "Não"],
      ["Vazio", "nenhum"],
    ]);
  });
});
