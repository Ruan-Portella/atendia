import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ComponentProblem, componentTexts, materializeComponent, parseComponentInput } from "../component-input";
import { carouselClickText, choicesOf, componentsNote, instagramCarouselText, instagramPlan, instagramTemplate, parseComponents, waCardText, whatsappPlan, type MessageComponent } from "../components";
import { gateComponent } from "../gate/components";
import { componentNote, offeredMatch } from "../action-tools";
import { shortcutTarget } from "../action-confirm";

/* Carrossel (C pública, parte 5d-1): formato, conversão por canal, portão card a card e clique. */

const IMG = "https://placehold.co/600x400.png";
const card = (title: string, extra: Record<string, unknown> = {}) => ({ image: IMG, title, text: "Molho de tomate e queijo.", buttons: [{ title: "Pedir esta" }], ...extra });
const problem = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as ComponentProblem;
  }
  throw new Error("não lançou");
};

describe("formato do carrossel", () => {
  it("aceita de 1 a 10 cards com imagem ou vídeo, título ou texto e botões ou link", () => {
    const c = parseComponentInput({ type: "carousel", cards: [card("Calabresa"), { video: "https://loja.com/v.mp4", text: "Marguerita", buttons: [{ title: "Pedir esta", id: "p102" }] }] });
    expect(c).toMatchObject({ type: "carousel", cards: [{ media: { type: "image", url: IMG }, title: "Calabresa" }, { media: { type: "video" }, title: null, buttons: [{ id: "p102" }] }] });
    expect(componentTexts(c)).toEqual(["Calabresa", "Molho de tomate e queijo.", "Pedir esta", "Marguerita", "Pedir esta"]);
    expect(parseComponentInput({ type: "carousel", cards: [{ image: IMG, title: "Site", link: { title: "Ver no site", url: "https://loja.com/a" } }] })).toMatchObject({ cards: [{ link: { title: "Ver no site" } }] });
  });

  it("aponta o campo com problema", () => {
    expect(problem(() => parseComponentInput({ type: "carousel" })).field).toBe("components.cards");
    expect(problem(() => parseComponentInput({ type: "carousel", cards: Array.from({ length: 11 }, (_, i) => card(`P${i}`)) })).field).toBe("components.cards");
    expect(problem(() => parseComponentInput({ type: "carousel", cards: [{ title: "Sem foto", buttons: [{ title: "Ok" }] }] })).field).toBe("components.cards[0].image");
    expect(problem(() => parseComponentInput({ type: "carousel", cards: [card("A", { video: "https://loja.com/v.mp4" })] })).field).toBe("components.cards[0].image");
    expect(problem(() => parseComponentInput({ type: "carousel", cards: [card("A", { image: "http://loja.com/a.png" })] })).field).toBe("components.cards[0].image");
    expect(problem(() => parseComponentInput({ type: "carousel", cards: [{ image: IMG, buttons: [{ title: "Ok" }] }] })).field).toBe("components.cards[0].title");
    expect(problem(() => parseComponentInput({ type: "carousel", cards: [card("A", { link: { title: "Site", url: "https://a.com" } })] })).field).toBe("components.cards[0].buttons");
    expect(problem(() => parseComponentInput({ type: "carousel", cards: [card("A", { buttons: [{ title: "1" }, { title: "2" }, { title: "3" }] })] })).field).toBe("components.cards[0].buttons");
    // o WhatsApp recusa tipos ou quantidades diferentes entre os cards
    const odd = problem(() => parseComponentInput({ type: "carousel", cards: [card("A"), card("B", { buttons: [{ title: "Pedir" }, { title: "Ver" }] })] }));
    expect(odd.field).toBe("components.cards[1].buttons");
    expect(odd.message).toMatch(/mesmo tipo e na mesma quantidade/);
    expect(problem(() => parseComponentInput({ type: "carousel", cards: [card("A"), { image: IMG, title: "B", link: { title: "Site", url: "https://a.com" } }] })).field).toBe("components.cards[1].buttons");
  });
});

/** Banco mínimo para materializeComponent: as ações do chatbot e as referências dos botões. */
function fakeDb(actions: Array<Record<string, unknown>>) {
  const refs: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      let payload: Record<string, unknown> | null = null;
      const b = {
        select: () => b,
        eq: () => b,
        insert: (p: Record<string, unknown>) => ((payload = p), b),
        single: () => b,
        then(ok: (v: unknown) => unknown) {
          if (table === "button_refs" && payload) {
            const row = { id: randomUUID(), ...payload };
            refs.push(row);
            return Promise.resolve({ data: row, error: null }).then(ok);
          }
          return Promise.resolve({ data: table === "actions" ? actions : [], error: null }).then(ok);
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, refs };
}

const action = (name: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), name, active: true, paused_by_plan_at: null, creates_order: false, type: "query", params_schema: { type: "object", properties: { item: { type: "string" } }, required: ["item"] }, ...extra });

describe("carrossel pronto para os canais", () => {
  it("botão com ação vira referência; sem ação, op_N pela mensagem inteira", async () => {
    const { db, refs } = fakeDb([action("adicionar_ao_carrinho")]);
    const input = parseComponentInput({ type: "carousel", cards: [card("Calabresa", { buttons: [{ title: "Pedir esta", action: { name: "adicionar_ao_carrinho", params: { item: "101" } } }] }), card("Marguerita"), card("Frango")] });
    const { component } = await materializeComponent(db, input, { bot: { id: "b" }, conversationId: randomUUID(), gate: null, strict: true });
    expect(component?.type).toBe("carousel");
    const ids = component?.type === "carousel" ? component.cards.map((c) => c.buttons![0].id) : [];
    expect(ids[0]).toMatch(/^bvc:[0-9a-f-]{36}:acao$/);
    expect(ids.slice(1)).toEqual(["op_2", "op_3"]);
    expect(refs).toHaveLength(1);
  });

  it("ação que cria pedido não vai no carrossel: erro na API, card fora no retorno de ação", async () => {
    const { db } = fakeDb([action("criar_pedido", { creates_order: true, type: "execute" })]);
    const input = parseComponentInput({ type: "carousel", cards: [card("Calabresa", { buttons: [{ title: "Comprar", action: { name: "criar_pedido", params: { item: "101" } } }] }), card("Marguerita")] });
    const base = { bot: { id: "b" }, conversationId: randomUUID(), gate: null };
    await expect(materializeComponent(db, input, { ...base, strict: true })).rejects.toThrow(/num carrossel/);
    const loose = await materializeComponent(db, input, { ...base, strict: false });
    expect(loose.component?.type === "carousel" ? loose.component.cards.map((c) => c.title) : []).toEqual(["Marguerita"]);
    expect(loose.dropped).toHaveLength(1);
  });
});

const carousel = (titles: string[], buttons = 1): Extract<MessageComponent, { type: "carousel" }> => ({
  type: "carousel",
  cards: titles.map((t, i) => ({ media: { type: "image", url: IMG }, title: t, text: "Molho de tomate e queijo.", buttons: Array.from({ length: buttons }, (_, j) => ({ id: `op_${i * buttons + j + 1}`, title: j ? "Detalhes" : "Pedir esta" })) })),
});

describe("conversão por canal", () => {
  it("WhatsApp: carrossel com o título no texto do card (até 160); 1 card vira mensagem com imagem", () => {
    const plan = whatsappPlan(carousel(["Calabresa", "Marguerita"]));
    expect(plan).toMatchObject({ kind: "carousel", cards: [{ media: { type: "image", url: IMG }, text: "Calabresa\nMolho de tomate e queijo.", buttons: [{ id: "op_1", title: "Pedir esta" }] }, { text: "Marguerita\nMolho de tomate e queijo." }] });
    expect(whatsappPlan(carousel(["Calabresa"]))).toMatchObject({ kind: "media", card: { text: "Calabresa\nMolho de tomate e queijo." } });
    const long = waCardText({ media: { type: "image", url: IMG }, title: "Pizza", text: `${"palavra ".repeat(40)}\nlinha 2\nlinha 3\nlinha 4` });
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.split("\n").length).toBeLessThanOrEqual(3);
  });

  it("Instagram: cards no generic template (postback com o id; link; vídeo sem imagem)", () => {
    expect(instagramTemplate(carousel(["Calabresa", "Marguerita"]))).toEqual([
      { title: "Calabresa", subtitle: "Molho de tomate e queijo.", image_url: IMG, buttons: [{ type: "postback", title: "Pedir esta", payload: "op_1" }] },
      { title: "Marguerita", subtitle: "Molho de tomate e queijo.", image_url: IMG, buttons: [{ type: "postback", title: "Pedir esta", payload: "op_2" }] },
    ]);
    const mixed: Extract<MessageComponent, { type: "carousel" }> = {
      type: "carousel",
      cards: [
        { media: { type: "video", url: "https://loja.com/v.mp4" }, text: `${"Uma descrição bem comprida do produto ".repeat(4)}\ncom quebra`, link: { url: "https://loja.com/1", label: "Ver no site" } },
        { media: { type: "image", url: IMG }, title: "Outro", link: { url: "https://loja.com/2", label: "Ver no site" } },
      ],
    };
    const [video, image] = instagramTemplate(mixed);
    expect(video.image_url).toBeUndefined();
    expect(video.subtitle).toBeUndefined();
    expect(video.title.length).toBeLessThanOrEqual(80);
    expect(video.title).not.toContain("\n");
    expect(video.buttons).toEqual([{ type: "web_url", title: "Ver no site", url: "https://loja.com/1" }]);
    expect(image).toEqual({ title: "Outro", image_url: IMG, buttons: [{ type: "web_url", title: "Ver no site", url: "https://loja.com/2" }] });
  });

  it("Instagram pelo computador: o resumo numerado com o nome do card; carrossel de links no texto", () => {
    expect(instagramPlan(carousel(["Calabresa", "Marguerita"]))).toEqual({
      summary: "Responda com o número ou toque numa opção:\n1. Calabresa\n2. Marguerita",
      quickReplies: [{ title: "Calabresa", payload: "op_1" }, { title: "Marguerita", payload: "op_2" }],
    });
    expect(choicesOf(carousel(["Calabresa"], 2)).map((o) => o.title)).toEqual(["Calabresa: Pedir esta", "Calabresa: Detalhes"]);
    const links: MessageComponent = { type: "carousel", cards: [{ media: { type: "image", url: IMG }, title: "Calabresa", link: { url: "https://loja.com/101", label: "Ver" } }] };
    expect(instagramCarouselText("Veja:", links)).toBe("Veja:\n\nCalabresa: https://loja.com/101");
  });

  it("guardado e lido de volta; a IA vê os cards no histórico e o clique leva o nome do card", () => {
    const c = carousel(["Calabresa", "Marguerita"]);
    expect(parseComponents(JSON.stringify(c))).toEqual(c);
    expect(parseComponents(JSON.stringify({ type: "carousel", cards: [{ media: { type: "image", url: "http://x.com/a.png" }, title: "A" }] }))).toBeNull();
    expect(componentsNote(c)).toBe("\n[carrossel mostrado: 1) Calabresa (botões: Pedir esta); 2) Marguerita (botões: Pedir esta)]");
    expect(carouselClickText(c, "op_2")).toBe("Pedir esta: Marguerita");
    expect(carouselClickText(c, "op_9")).toBeNull();
    expect(carouselClickText({ type: "options", options: [{ id: "op_1", title: "A" }] }, "op_1")).toBeNull();
  });

  it("atalho digitado: o número vale pelo botão do card", () => {
    const c: MessageComponent = { type: "carousel", cards: [{ media: { type: "image", url: IMG }, title: "A", buttons: [{ id: "op_1", title: "Pedir" }] }, { media: { type: "image", url: IMG }, title: "B", buttons: [{ id: "bvc:0b6d5c1e-2f4a-4c3b-9d8e-7f6a5b4c3d2e:acao", title: "Pedir" }] }] };
    expect(shortcutTarget({ pos: 2, number: true }, c)).toEqual({ refId: "0b6d5c1e-2f4a-4c3b-9d8e-7f6a5b4c3d2e", verb: "acao" });
    expect(shortcutTarget({ pos: 1, number: true }, c)).toBeNull();
  });
});

describe("portão card a card e ações", () => {
  const gate = { channel: "whatsapp" as const, contactPhone: "5521999990000", regulatedConversation: false };

  it("card com item proibido sai; com item 18+ sem o Sim, sai e pede o botão Ver opções 18+", () => {
    const c = carousel(["Pizza Calabresa", "Cerveja Heineken 600ml", "Cigarro Marlboro"]);
    const r = gateComponent(c, { ...gate, age: null });
    expect(r.component?.type === "carousel" ? r.component.cards.map((x) => x.title) : []).toEqual(["Pizza Calabresa"]);
    expect(r.offerAdult).toBe(true);
    const adult = gateComponent(c, { ...gate, age: "sim" });
    expect(adult.component?.type === "carousel" ? adult.component.cards.map((x) => x.title) : []).toEqual(["Pizza Calabresa", "Cerveja Heineken 600ml"]);
  });

  it("a lista continua lista depois do portão: rótulo do botão e descrições ficam", () => {
    const list: MessageComponent = {
      type: "options",
      list: true,
      button: "Ver sabores",
      options: [
        { id: "bvc:0b6d5c1e-2f4a-4c3b-9d8e-7f6a5b4c3d2e:acao", title: "Pizza Calabresa", description: "R$ 49,90" },
        { id: "u:marg", title: "Pizza Marguerita", description: "R$ 45,90" },
        { id: "u:coca", title: "Coca-Cola 2L", description: "R$ 12,00" },
        { id: "u:heine", title: "Cerveja Heineken 600ml", description: "R$ 14,00" },
      ],
    };
    const r = gateComponent(list, { ...gate, age: null });
    expect(r.component).toEqual({ ...list, options: list.options.slice(0, 3) });
    // 3 itens que vieram como lista não viram 3 botões
    expect(whatsappPlan(r.component!)).toMatchObject({ kind: "list", button: "Ver sabores", rows: [{ title: "Pizza Calabresa", description: "R$ 49,90" }, {}, {}] });
  });

  it("a IA vê os nomes dos cards e o carrossel só vai se ela mostra esses itens", () => {
    const c = carousel(["Pizza Calabresa", "Pizza Marguerita"]);
    expect(componentNote(c)).toMatchObject({ carrossel: ["Pizza Calabresa", "Pizza Marguerita"] });
    expect(offeredMatch(c, { opcoes: ["Calabresa", "Marguerita"] })).toBe(c);
    expect(offeredMatch(c, { opcoes: ["Entrega", "Retirada"] })).toBeNull();
  });
});
