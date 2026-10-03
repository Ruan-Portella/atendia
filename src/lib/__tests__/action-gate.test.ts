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
    const newest = actionsNote([{ name: "acao_extrato", input: { mes: "09" }, output: { ok: true, data: { total: 120 } } }], seen, "2026-10-03T14:31:12Z");
    const older = actionsNote([{ name: "acao_extrato", input: { mes: "08" }, output: { ok: true, data: { total: 90 } } }], seen, "2026-10-03T14:20:00Z");
    // a hora (São Paulo) e o aviso de que o dado pode ter mudado: a IA consulta de novo
    expect(newest).toBe('(ações desta resposta: acao_extrato({"mes":"09"}) → ok às 11:31: {"total":120} Esses dados são da hora da consulta e podem ter mudado: se a pessoa perguntar de novo, chame a ação de novo.)');
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

describe("reply esperando o 18+", () => {
  it("sai depois do Sim só se a pergunta foi feita há até 15 minutos", async () => {
    const { pendingReplyOf, PENDING_REPLY_MS } = await import("../gate/flow");
    const askedAt = "2026-10-03T14:44:52Z";
    const at = Date.parse(askedAt);
    const p = { question: "status do pedido 123?", askedAt, reply: "Seu pedido: 1 pizza e 2 Heineken." };
    expect(pendingReplyOf(p, at + 60_000)).toBe(p.reply);
    expect(pendingReplyOf(p, at + PENDING_REPLY_MS + 1)).toBeNull();
    expect(pendingReplyOf({ ...p, reply: null }, at)).toBeNull();
    expect(pendingReplyOf(null, at)).toBeNull();
  });

  it("reply barrado vira texto fixo, nunca editado", async () => {
    const { replyFallback } = await import("../gate/exit");
    const { GATE_TEXTS } = await import("../gate/rules");
    expect(replyFallback({ prohibited: ["tabaco"], regulated: [] }, null)).toBe(GATE_TEXTS.prohibited);
    expect(replyFallback({ prohibited: [], regulated: ["bebida"] }, null)).toBe(GATE_TEXTS.under18);
    expect(replyFallback({ prohibited: [], regulated: [] }, { destino: "o site" })).toBe(`${GATE_TEXTS.paymentNotHere} ${GATE_TEXTS.finishOrder("o site")}`);
  });
});

describe("pedido com bebida e cigarro", () => {
  const pedido = { pedido: { id: "ped_123", status: "saiu para entrega", url: "https://loja.com/pedido/123", itens: [{ id: "p1", nome: "Pizza calabresa" }, { id: "b7", nome: "Heineken long neck" }, { id: "c9", nome: "Maço de cigarro" }] } };

  it("ver não é vender: com o Sim a bebida aparece no pedido; o cigarro sai sempre, e o link do pedido fica", () => {
    const r = gateActionData(pedido, { channel: "instagram", age: "sim" });
    expect((r.data as typeof pedido).pedido.itens.map((i) => i.id)).toEqual(["p1", "b7"]);
    expect(r.hidden).toEqual(["tabaco"]);
    expect(r.links).toEqual(["https://loja.com/pedido/123"]);
  });

  it("sem o Sim: a bebida também sai", () => {
    const r = gateActionData(pedido, { channel: "whatsapp", contactPhone: "5521999999999", age: null });
    expect((r.data as typeof pedido).pedido.itens.map((i) => i.id)).toEqual(["p1"]);
    expect(r.hidden.sort()).toEqual(["bebida", "tabaco"]);
  });

  it("a saída do proibido: link do pedido, senão o canal declarado, senão 'não dá por aqui'", async () => {
    const { prohibitedNote } = await import("../action-tools");
    expect(prohibitedNote(["https://loja.com/pedido/123"], { destino: "https://loja.com" })).toContain("a versão completa está em https://loja.com/pedido/123");
    expect(prohibitedNote([], { destino: "https://loja.com" })).toContain("ficam fora do chat: https://loja.com");
    expect(prohibitedNote([], null)).toContain("não podem ser mostrados por aqui");
  });

  it("o que fazer com o reply barrado", async () => {
    const { replyOutcome } = await import("../action-tools");
    type Cat = import("../gate/rules").GateCategory;
    const rc = (o: Partial<{ ok: boolean; prohibited: Cat[]; regulated: Cat[]; payment: boolean }>) => ({ ok: false, prohibited: [], regulated: [], payment: false, ...o });
    expect(replyOutcome(rc({ ok: true }), { age: null })).toBe("enviar");
    // só o 18+ sem resposta de idade espera a pergunta
    expect(replyOutcome(rc({ regulated: ["bebida"] }), { age: null })).toBe("esperar_idade");
    // proibido, pagamento ou depois do Não: a IA responde com o data filtrado
    expect(replyOutcome(rc({ prohibited: ["tabaco"] }), { age: "sim" })).toBe("descartar");
    expect(replyOutcome(rc({ payment: true }), { age: "sim" })).toBe("descartar");
    expect(replyOutcome(rc({ regulated: ["bebida"] }), { age: "nao" })).toBe("descartar");
  });
});
