import { describe, expect, it } from "vitest";
import type { UIMessageChunk } from "ai";
import { ComponentProblem, componentTexts, parseComponentInput } from "../component-input";
import { confirmButtonId, confirmComponent, confirmedNote, isConfirmComponent, parseConfirmButton, shortcutTarget, stillCallable } from "../action-confirm";
import { whatsappPlan, type MessageComponent } from "../components";
import { gateComponent } from "../gate/components";
import { devButtonId, waInboundExtra } from "../message-events";
import { componentNote } from "../action-tools";
import { appendActionComponent } from "../chat";
import { parseSendBody } from "../api-messages";
import { readResponse } from "../actions";
import { ApiError } from "../api-v1";

const REF = "0b6d5c1e-2f4a-4c3b-9d8e-7f6a5b4c3d2e";
const problem = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as ComponentProblem;
  }
  throw new Error("não lançou");
};

describe("formato dos components (C pública, parte 5b)", () => {
  it("botões com e sem ação, lista com descrição e link", () => {
    expect(parseComponentInput({ type: "buttons", buttons: [{ title: "Pedir esse!", action: { name: "adicionar_ao_carrinho", params: { item: "101" } } }, { title: "Ver cardápio", id: "ver" }] })).toEqual({
      type: "buttons",
      buttons: [
        { title: "Pedir esse!", id: null, description: null, action: { name: "adicionar_ao_carrinho", params: { item: "101" } } },
        { title: "Ver cardápio", id: "ver", description: null, action: null },
      ],
    });
    expect(parseComponentInput([{ type: "list", button: "Ver sabores", items: [{ title: "Calabresa", description: "R$ 49,90" }] }])).toMatchObject({ type: "list", button: "Ver sabores", items: [{ title: "Calabresa", description: "R$ 49,90" }] });
    expect(parseComponentInput({ type: "link", title: "Ver pedido", url: "https://loja.com/p/1" })).toEqual({ type: "link", title: "Ver pedido", url: "https://loja.com/p/1" });
  });

  it("aponta o campo com problema", () => {
    expect(problem(() => parseComponentInput({ type: "buttons", buttons: [1, 2, 3, 4].map((n) => ({ title: `B${n}` })) })).field).toBe("components.buttons");
    expect(problem(() => parseComponentInput({ type: "buttons", buttons: [{ title: "Um título grande demais aqui" }] })).field).toBe("components.buttons[0].title");
    expect(problem(() => parseComponentInput({ type: "buttons", buttons: [{ title: "Ok", action: { name: "Pedir Já" } }] })).field).toBe("components.buttons[0].action");
    expect(problem(() => parseComponentInput({ type: "link", title: "Zap", url: "https://wa.me/5521999999999" })).field).toBe("components.url");
    expect(problem(() => parseComponentInput({ type: "link", title: "Site", url: "http://loja.com" })).field).toBe("components.url");
    expect(problem(() => parseComponentInput([{ type: "link", title: "a", url: "https://a.com" }, { type: "link", title: "b", url: "https://b.com" }])).message).toMatch(/Um componente por mensagem/);
    expect(problem(() => parseComponentInput({ type: "carousel" })).field).toBe("components.type");
  });

  it("os títulos e descrições passam pelo portão de texto da API", () => {
    expect(componentTexts({ type: "list", button: null, items: [{ title: "Calabresa", description: "R$ 49,90", id: null, action: null }] })).toEqual(["Calabresa", "R$ 49,90"]);
  });

  it("POST /v1/messages aceita components só com texto (até 1.024 caracteres no texto)", () => {
    const base = { bot_id: "bot_x", to: "phone:5521999999999", type: "text", text: "Escolha:" };
    expect(parseSendBody({ ...base, components: { type: "buttons", buttons: [{ title: "Sim" }] } })).toMatchObject({ components: { type: "buttons" } });
    const err = (b: Record<string, unknown>) => {
      try {
        parseSendBody(b);
      } catch (e) {
        return (e as ApiError).details;
      }
      throw new Error("não lançou");
    };
    expect(err({ ...base, components: { type: "buttons", buttons: [] } })).toEqual({ field: "components.buttons" });
    expect(err({ ...base, text: "x".repeat(1025), components: { type: "buttons", buttons: [{ title: "Sim" }] } })).toEqual({ field: "text" });
    expect(err({ ...base, type: "image", image: { url: "https://x.com/a.png" }, components: { type: "buttons", buttons: [{ title: "Sim" }] } })).toEqual({ field: "components" });
  });

  it("o retorno da ação guarda components como veio (conferido depois)", () => {
    expect(readResponse(200, JSON.stringify({ data: {}, components: { type: "link", title: "x", url: "https://a.com" } })).components).toEqual({ type: "link", title: "x", url: "https://a.com" });
    expect(readResponse(200, JSON.stringify({ data: {} })).components).toBeUndefined();
  });
});

describe("conversão por canal", () => {
  it("lista pedida vira lista no WhatsApp, com a descrição e o rótulo do botão", () => {
    const c: MessageComponent = { type: "options", list: true, button: "Ver sabores", options: [{ id: "op_1", title: "Calabresa", description: "R$ 49,90" }] };
    expect(whatsappPlan(c)).toEqual({ kind: "list", button: "Ver sabores", rows: [{ id: "op_1", title: "Calabresa", description: "R$ 49,90" }] });
    expect(whatsappPlan({ type: "options", options: [{ id: "op_1", title: "Sim" }] })).toEqual({ kind: "buttons", buttons: [{ id: "op_1", title: "Sim" }] });
  });

  it("o portão mantém o id do botão com ação e o do dev", () => {
    const c: MessageComponent = { type: "options", options: [{ id: confirmButtonId(REF, "acao"), title: "Pedir esse!" }, { id: "u:ver", title: "Ver cardápio" }] };
    expect(gateComponent(c, { channel: "whatsapp", contactPhone: "5521999999999", regulatedConversation: false, age: null }).component).toEqual(c);
  });

  it("o webhook devolve o id do dev sem o prefixo do BoaVoz", () => {
    expect(devButtonId("u:ver_cardapio")).toBe("ver_cardapio");
    expect(devButtonId("op_1")).toBe("op_1");
    expect(waInboundExtra({ type: "interactive", interactive: { button_reply: { id: "u:quero", title: "Sim, quero" } } }).interactive).toEqual({ type: "button_reply", id: "quero", title: "Sim, quero" });
  });
});

describe("clique no botão com ação", () => {
  it("lista com botões de ação não é o resumo do Confirmar (o portão filtra item a item)", () => {
    expect(isConfirmComponent({ type: "options", list: true, options: [{ id: confirmButtonId(REF, "acao"), title: "Pizza Calabresa" }] })).toBe(false);
    expect(isConfirmComponent(confirmComponent(REF))).toBe(true);
  });

  it("o id é uma referência opaca; o número digitado vale pela posição na mensagem", () => {
    expect(parseConfirmButton(confirmButtonId(REF, "acao"))).toEqual({ refId: REF, verb: "acao" });
    const msg: MessageComponent = { type: "options", options: [{ id: "u:ver", title: "Ver cardápio" }, { id: confirmButtonId(REF, "acao"), title: "Pedir esse!" }] };
    expect(shortcutTarget({ pos: 2, number: true }, msg)).toEqual({ refId: REF, verb: "acao" });
    // a opção 1 não tem ação: o "1" vai para a IA
    expect(shortcutTarget({ pos: 1, number: true }, msg)).toBeNull();
    // "sim" só confirma o Confirmar, nunca um botão com ação
    expect(shortcutTarget({ pos: 1, number: false }, { type: "options", options: [{ id: confirmButtonId(REF, "acao"), title: "Pedir" }] })).toBeNull();
    expect(shortcutTarget({ pos: 1, number: false }, confirmComponent(REF))).toEqual({ refId: REF, verb: "sim" });
  });

  it("botão com ação aceita consulta; o Confirmar só ação que pede confirmação", () => {
    const query = { active: true, paused_by_plan_at: null, min_level: "anonimo" as const, context_required: "none" as const, type: "query" as const, creates_order: false };
    expect(stillCallable(query, { level: "anonimo", hasContext: false }, "action")).toBe(true);
    expect(stillCallable(query, { level: "anonimo", hasContext: false }, "confirm")).toBe(false);
  });

  it("a IA sabe que foi um botão e que os botões da ação vão junto", () => {
    expect(confirmedNote("adicionar_ao_carrinho", { ok: true, data: {} }, "botao")).toMatch(/^A pessoa tocou num botão e a ação acao_adicionar_ao_carrinho foi chamada agora/);
    expect(componentNote({ type: "options", options: [{ id: "op_1", title: "Finalizar pedido" }] })).toMatchObject({ botoes: ["Finalizar pedido"] });
    expect(componentNote({ type: "link", url: "https://a.com", label: "Ver pedido" })).toMatchObject({ link: "Ver pedido" });
  });
});

describe("widget", () => {
  const run = async (chunks: UIMessageChunk[], c: MessageComponent | null) => {
    const out: UIMessageChunk[] = [];
    const stream = new ReadableStream<UIMessageChunk>({
      start(ctrl) {
        chunks.forEach((x) => ctrl.enqueue(x));
        ctrl.close();
      },
    }).pipeThrough(appendActionComponent(() => c));
    const reader = stream.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) out.push(r.value);
    return out.map((x) => x.type);
  };
  const button: MessageComponent = { type: "options", options: [{ id: "op_1", title: "Ok" }] };

  it("os botões da ação vão no fim da resposta, se nenhum outro saiu", async () => {
    expect(await run([{ type: "start" }, { type: "finish" }], button)).toEqual(["start", "data-components", "finish"]);
    expect(await run([{ type: "start" }, { type: "data-components", data: button }, { type: "finish" }], button)).toEqual(["start", "data-components", "finish"]);
    expect(await run([{ type: "start" }, { type: "finish" }], null)).toEqual(["start", "finish"]);
  });
});
