import { describe, expect, it } from "vitest";
import { Webhook } from "standardwebhooks";
import { actionInputProblem, callBody, newActionSecret, paramsSchemaProblem, queryCallId, readResponse, signatureHeader } from "../actions";

const valid = {
  name: "buscar_cardapio",
  description: "Use quando o cliente perguntar o que tem no cardápio, preços ou disponibilidade.",
  url: "https://api.loja.com/boavoz/cardapio",
  params_schema: { type: "object", properties: { categoria: { type: "string", description: "ex.: pizzas" } }, required: [] },
};

describe("cadastro de ação", () => {
  it("aceita uma ação de consulta bem formada", () => {
    expect(actionInputProblem(valid)).toBeNull();
  });

  it("nome em snake_case e sem os nomes reservados", () => {
    expect(actionInputProblem({ ...valid, name: "BuscarCardapio" })).toMatch(/snake_case/);
    expect(actionInputProblem({ ...valid, name: "chamar_atendente" })).toMatch(/reservado/);
    expect(actionInputProblem({ ...valid, name: "boavoz_teste" })).toMatch(/reservado/);
  });

  it("só HTTPS e nunca endereço interno", () => {
    expect(actionInputProblem({ ...valid, url: "http://api.loja.com/x" })).toMatch(/HTTPS/);
    expect(actionInputProblem({ ...valid, url: "https://127.0.0.1/x" })).toMatch(/interno/);
    expect(actionInputProblem({ ...valid, url: "https://localhost/x" })).toMatch(/interno/);
    expect(actionInputProblem({ ...valid, url: "https://169.254.169.254/latest" })).toMatch(/interno/);
  });

  it("descrição com tamanho certo", () => {
    expect(actionInputProblem({ ...valid, description: "curta" })).toMatch(/pelo menos 20/);
    expect(actionInputProblem({ ...valid, description: "x".repeat(501) })).toMatch(/500/);
  });

  it("parâmetros: objeto, tipos simples (e listas deles), no máximo 10", () => {
    expect(paramsSchemaProblem({ type: "object", properties: { itens: { type: "array", items: { type: "string" } } } })).toBeNull();
    expect(paramsSchemaProblem({ type: "array" })).toMatch(/object/);
    expect(paramsSchemaProblem({ type: "object", properties: { x: { type: "object" } } })).toMatch(/não aceito/);
    expect(paramsSchemaProblem({ type: "object", properties: { x: { type: "array", items: { type: "object" } } } })).toMatch(/tipos simples/);
    const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`p${i}`, { type: "string" }]));
    expect(paramsSchemaProblem({ type: "object", properties: many })).toMatch(/10/);
    expect(paramsSchemaProblem({ type: "object", properties: {}, required: ["y"] })).toMatch(/não existe/);
  });
});

describe("assinatura (Standard Webhooks)", () => {
  it("o dev valida com a biblioteca oficial; na troca, as duas assinaturas valem", () => {
    const nova = newActionSecret();
    const antiga = newActionSecret();
    expect(nova).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    const body = JSON.stringify({ call_id: "call_1", action: "buscar_cardapio", params: {} });
    const now = new Date();
    const headers = { "webhook-id": "call_1", "webhook-timestamp": String(Math.floor(now.getTime() / 1000)), "webhook-signature": signatureHeader([nova, antiga], "call_1", now, body) };
    expect(headers["webhook-signature"].split(" ")).toHaveLength(2);
    // o dev que ainda está com o segredo antigo continua validando durante a troca
    expect(() => new Webhook(antiga).verify(body, headers)).not.toThrow();
    expect(() => new Webhook(nova).verify(body, headers)).not.toThrow();
    expect(() => new Webhook(newActionSecret()).verify(body, headers)).toThrow();
  });
});

describe("chamada", () => {
  it("o call_id de uma consulta é o mesmo no reprocesso (mesma mensagem, ação e parâmetros)", () => {
    const a = queryCallId("msg1", "act1", { categoria: "pizzas", tamanho: "g" });
    expect(queryCallId("msg1", "act1", { tamanho: "g", categoria: "pizzas" })).toBe(a);
    expect(queryCallId("msg2", "act1", { categoria: "pizzas", tamanho: "g" })).not.toBe(a);
    expect(a).toMatch(/^call_[0-9a-f]{32}$/);
  });

  it("corpo enviado: ids com prefixo, teste marcado e sem contexto na P1", () => {
    const body = callBody({ name: "buscar_cardapio", bot_id: "b1" }, "call_x", { params: { categoria: "pizzas" }, mode: "test", conversation: { id: "c1", channel: "whatsapp" } });
    expect(body).toMatchObject({ call_id: "call_x", action: "buscar_cardapio", params: { categoria: "pizzas" }, confirmed: false, test: true, bot: { id: "bot_b1" }, conversation: { id: "conv_c1", channel: "whatsapp" }, context: null });
  });

  it("lê a resposta: 200 ok, 404 não encontrado, o resto falha", () => {
    expect(readResponse(200, JSON.stringify({ data: { itens: [1] }, reply: "Temos pizza!", attachments: [{ url: "https://x/a.pdf" }, { nada: 1 }], outcome: "sem_debito" }))).toEqual({
      status: "ok",
      data: { itens: [1] },
      reply: "Temos pizza!",
      attachments: [{ url: "https://x/a.pdf" }],
      outcome: "sem_debito",
    });
    expect(readResponse(404, JSON.stringify({ error: "pedido 123 não existe" }))).toEqual({ status: "not_found", error: "pedido 123 não existe" });
    expect(readResponse(500, "{}")).toMatchObject({ status: "error", error: "HTTP 500" });
    expect(readResponse(200, "<html>")).toMatchObject({ status: "error" });
    expect(readResponse(200, "")).toMatchObject({ status: "error", error: "resposta vazia" });
  });
});
