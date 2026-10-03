import { describe, expect, it } from "vitest";
import type { UIMessageChunk } from "ai";
import { gateActionData } from "../action-gate";
import { contactLevel, reaches } from "../action-tools";
import { actionsNote, withoutToolParts } from "../chat";
import { checkActionReply } from "../gate/exit";

const cardapio = {
  itens: [
    { id: "p1", nome: "Pizza calabresa", preco: 45 },
    { id: "b7", nome: "Heineken long neck", preco: 12 },
    { sku: "c9", nome: "Maço de cigarro", preco: 15 },
  ],
};

describe("portão no retorno das ações", () => {
  it("widget: o data passa igual", () => {
    const r = gateActionData(cardapio, { channel: "widget", age: null });
    expect(r.data).toEqual(cardapio);
    expect(r.hidden).toEqual([]);
  });

  it("WhatsApp sem o Sim: tira o proibido e o 18+, e anota os ids", () => {
    const r = gateActionData(cardapio, { channel: "whatsapp", contactPhone: "5521999999999", age: null });
    expect(r.data).toEqual({ itens: [{ id: "p1", nome: "Pizza calabresa", preco: 45 }] });
    expect(r.hidden.sort()).toEqual(["bebida", "tabaco"]);
    expect(r.ids.b7).toEqual({ categoria: "bebida", rotulo: "Heineken long neck" });
    expect(r.ids.c9).toEqual({ categoria: "tabaco", rotulo: "Maço de cigarro" });
    expect(r.ids.p1).toBeUndefined();
  });

  it("com o Sim: o 18+ fica e o proibido sai", () => {
    const r = gateActionData(cardapio, { channel: "instagram", age: "sim" });
    expect((r.data as typeof cardapio).itens.map((i) => i.nome)).toEqual(["Pizza calabresa", "Heineken long neck"]);
    expect(r.hidden).toEqual(["tabaco"]);
  });

  it("regulated: true do dev vale como 18+, e o pedido que continha o item entra no mapa", () => {
    const pedido = { pedido: { id: "ped_55", status: "a caminho", itens: [{ id: "x1", nome: "Kit especial", regulated: true }, { id: "x2", nome: "Coxinha" }] } };
    const r = gateActionData(pedido, { channel: "whatsapp", age: "nao" });
    expect(r.data).toEqual({ pedido: { id: "ped_55", status: "a caminho", itens: [{ id: "x2", nome: "Coxinha" }] } });
    expect(Object.keys(r.ids).sort()).toEqual(["ped_55", "x1"]);
  });

  it("categoria liberada pelo BoaVoz não sai", () => {
    const r = gateActionData(cardapio, { channel: "whatsapp", age: null, exempt: ["bebida"] });
    expect((r.data as typeof cardapio).itens.map((i) => i.id ?? (i as { sku?: string }).sku)).toEqual(["p1", "b7"]);
  });
});

describe("nível do contato", () => {
  it("canal quando a Meta garante quem é", () => {
    expect(contactLevel("whatsapp", "5521999999999")).toBe("canal");
    expect(contactLevel("whatsapp", null)).toBe("anonimo");
    expect(contactLevel("instagram", null)).toBe("canal");
    expect(contactLevel("widget", null)).toBe("anonimo");
  });

  it("alcança o mínimo da ação", () => {
    expect(reaches("canal", "anonimo")).toBe(true);
    expect(reaches("canal", "canal")).toBe(true);
    expect(reaches("anonimo", "canal")).toBe(false);
    expect(reaches("canal", "usuario")).toBe(false);
  });
});

describe("ações no histórico", () => {
  it("só a última chamada de cada ação leva o data", () => {
    const seen = new Set<string>();
    // da mais nova para a mais antiga, como o conversationHistory lê
    const newest = actionsNote([{ name: "acao_extrato", input: { mes: "09" }, output: { ok: true, data: { total: 120 } } }], seen);
    const older = actionsNote([{ name: "acao_extrato", input: { mes: "08" }, output: { ok: true, data: { total: 90 } } }], seen);
    expect(newest).toBe('(ações desta resposta: acao_extrato({"mes":"09"}) → ok: {"total":120})');
    expect(older).toBe('(ações desta resposta: acao_extrato({"mes":"08"}) → ok)');
  });

  it("falha mostra o motivo e não conta como a última", () => {
    const seen = new Set<string>();
    expect(actionsNote([{ name: "acao_pedido", input: { id: "9" }, output: { ok: false, motivo: "nao_encontrado" } }], seen)).toBe('(ações desta resposta: acao_pedido({"id":"9"}) → falhou (nao_encontrado))');
    expect(actionsNote([{ name: "acao_pedido", input: { id: "8" }, output: { ok: true, data: { status: "entregue" } } }], seen)).toContain('"status":"entregue"');
  });
});

describe("reply das ações", () => {
  const base = { channel: "whatsapp" as const, contactPhone: "5521999999999", regulatedConversation: false };

  it("texto comum passa", () => {
    expect(checkActionReply({ ...base, text: "Seu pedido 123 saiu para entrega.", age: null }).ok).toBe(true);
  });

  it("18+ sem o Sim barra (mesmo sem oferta), com o Sim passa", () => {
    const r = checkActionReply({ ...base, text: "Seu pedido: 2 Heineken.", age: null });
    expect(r).toMatchObject({ ok: false, regulated: ["bebida"], prohibited: [] });
    expect(checkActionReply({ ...base, text: "Seu pedido: 2 Heineken.", age: "sim" }).ok).toBe(true);
  });

  it("proibido barra sempre, inclusive com negação", () => {
    expect(checkActionReply({ ...base, text: "Não temos cigarro hoje.", age: "sim" })).toMatchObject({ ok: false, prohibited: ["tabaco"] });
  });

  it("widget recebe o reply como texto e só o primeiro", async () => {
    const chunks: UIMessageChunk[] = [
      { type: "start" },
      { type: "tool-input-available", toolCallId: "1", toolName: "acao_pedido", input: { id: "123" } },
      { type: "tool-output-available", toolCallId: "1", output: { ok: true, data: { cpf: "123.456.789-00" }, resposta_exata: "Pedido 123: saiu para entrega." } },
      { type: "tool-output-available", toolCallId: "2", output: { ok: true, resposta_exata: "Outro texto" } },
      { type: "finish" },
    ];
    const out: UIMessageChunk[] = [];
    const reader = new ReadableStream<UIMessageChunk>({
      start(c) {
        chunks.forEach((ch) => c.enqueue(ch));
        c.close();
      },
    })
      .pipeThrough(withoutToolParts())
      .getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) out.push(r.value);
    expect(out.map((c) => c.type)).toEqual(["start", "text-start", "text-delta", "text-end", "finish"]);
    expect(JSON.stringify(out)).toContain("Pedido 123: saiu para entrega.");
    expect(JSON.stringify(out)).not.toMatch(/123\.456|Outro texto/);
  });
});
