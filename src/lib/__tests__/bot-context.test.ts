import { describe, expect, it } from "vitest";
import { activeContext, contextInput, contextLabel, parseFixedContext, parseSourceTag, tagMatches } from "../bot-context";
import { parseSourceBody, sourceApiObject } from "../api-sources";

describe("contexto fixo e fontes por contexto", () => {
  it("o contexto é um objeto plano: chaves simples, valores texto, número ou booleano", () => {
    expect(parseFixedContext({ loja_id: "42", ativa: true, filial: 3 })).toEqual({ value: { loja_id: "42", ativa: true, filial: 3 } });
    expect(parseFixedContext(null)).toEqual({ value: null });
    expect(parseFixedContext({})).toEqual({ value: null });
    expect(parseFixedContext([1, 2])).toHaveProperty("error");
    expect(parseFixedContext({ "loja id": "42" })).toHaveProperty("error");
    expect(parseFixedContext({ loja: { id: 42 } })).toHaveProperty("error");
    expect(parseFixedContext({ loja: "" })).toHaveProperty("error");
    expect(parseFixedContext({ loja: "x".repeat(201) })).toHaveProperty("error");
    expect(parseFixedContext(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i])))).toHaveProperty("error");
    expect(parseSourceTag(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`k${i}`, i])))).toHaveProperty("error");
  });

  it("o contexto ativo: o da identidade com o fixo do chatbot por cima", () => {
    expect(activeContext({ fixed_context: null }, null)).toBeNull();
    expect(activeContext({ fixed_context: { loja_id: "42" } }, null)).toEqual({ loja_id: "42" });
    expect(activeContext({}, { context: { workspace_id: "ws_a" } })).toEqual({ workspace_id: "ws_a" });
    // o token não troca a loja do chatbot
    expect(activeContext({ fixed_context: { loja_id: "42" } }, { context: { loja_id: "99", workspace_id: "ws_a" } })).toEqual({ loja_id: "42", workspace_id: "ws_a" });
  });

  it("a fonte com etiqueta vale só quando o contexto tem todos os pares, com o mesmo tipo", () => {
    expect(tagMatches(null, null)).toBe(true);
    expect(tagMatches({ workspace_id: "ws_a" }, null)).toBe(false);
    expect(tagMatches({ workspace_id: "ws_a" }, { workspace_id: "ws_a", role: "admin" })).toBe(true);
    expect(tagMatches({ workspace_id: "ws_a", role: "admin" }, { workspace_id: "ws_a" })).toBe(false);
    expect(tagMatches({ loja_id: 42 }, { loja_id: "42" })).toBe(false);
    expect(contextLabel({ workspace_id: "ws_a", role: "admin" })).toBe("workspace_id: ws_a · role: admin");
    expect(contextInput({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(contextInput(null)).toBe("");
  });

  it("o corpo do POST de fontes", () => {
    expect(parseSourceBody({ kind: "text", content: "Horário da unidade: das 8h às 18h.", context: { workspace_id: "ws_a" } })).toEqual({
      kind: "text",
      title: "Texto",
      content: "Horário da unidade: das 8h às 18h.",
      url: null,
      context: { workspace_id: "ws_a" },
    });
    expect(parseSourceBody({ kind: "pdf", url: "https://exemplo.com.br/docs/regulamento.pdf" })).toMatchObject({ kind: "pdf", title: "regulamento.pdf", url: "https://exemplo.com.br/docs/regulamento.pdf", context: null });
    expect(parseSourceBody({ kind: "page", url: "exemplo.com.br/precos", title: "  Preços  " })).toMatchObject({ kind: "page", title: "Preços" });
    expect(parseSourceBody({ kind: "site", url: "https://exemplo.com.br" })).toMatchObject({ field: "kind" });
    expect(parseSourceBody({ kind: "text", content: "curto" })).toMatchObject({ field: "content" });
    expect(parseSourceBody({ kind: "text", content: "x".repeat(30_001) })).toMatchObject({ field: "content" });
    expect(parseSourceBody({ kind: "page", url: "ftp://exemplo.com.br" })).toMatchObject({ field: "url" });
    expect(parseSourceBody({ kind: "text", content: "Conteúdo com tamanho suficiente aqui.", context: { "a b": 1 } })).toMatchObject({ field: "context" });
  });

  it("a fonte como a API devolve", () => {
    const o = sourceApiObject({ id: "11111111-1111-4111-8111-111111111111", bot_id: "22222222-2222-4222-8222-222222222222", kind: "text", title: "Regulamento", url: null, status: "ready", chunk_count: 3, pages: 1, error: null, context: { workspace_id: "ws_a" }, created_at: "2026-10-19T12:00:00.000Z" });
    expect(o).toEqual({ id: "src_11111111-1111-4111-8111-111111111111", bot_id: "bot_22222222-2222-4222-8222-222222222222", kind: "text", title: "Regulamento", url: null, status: "ready", chunks: 3, pages: 1, error: null, context: { workspace_id: "ws_a" }, created_at: "2026-10-19T12:00:00.000Z" });
  });
});
