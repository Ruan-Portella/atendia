import { describe, expect, it } from "vitest";
import { asButtons, componentsNote, hostsIn, instagramLinkText, instagramPlan, joinShownText, normalizeLink, normalizeOptions, parseComponents, shortTitle, whatsappPlan } from "../components";
import { gateComponent } from "../gate/components";
import { withoutToolParts } from "../chat";
import type { UIMessageChunk } from "ai";

describe("opções da IA", () => {
  it("limpa, tira repetidas e numeração; precisa de 2 a 10", () => {
    expect(normalizeOptions(["1. Calabresa", "2) Marguerita", "calabresa", "  Frango  "])).toEqual([
      { id: "op_1", title: "Calabresa" },
      { id: "op_2", title: "Marguerita" },
      { id: "op_3", title: "Frango" },
    ]);
    expect(normalizeOptions(["Só uma"])).toBeNull();
    expect(normalizeOptions(Array.from({ length: 14 }, (_, i) => `Opção ${i + 1}`))!.length).toBe(10);
  });

  it("até 3 curtas viram botões; mais (ou título longo), lista", () => {
    expect(asButtons(normalizeOptions(["Sim", "Não"])!)).toBe(true);
    expect(asButtons(normalizeOptions(["A", "B", "C", "D"])!)).toBe(false);
    expect(asButtons(normalizeOptions(["Consulta de avaliação odonto", "Limpeza"])!)).toBe(false);
  });

  it("título cortado no fim de uma palavra", () => {
    expect(shortTitle("Consulta de avaliação odontológica", 24)).toBe("Consulta de avaliação");
    expect(shortTitle("Curto", 20)).toBe("Curto");
  });
});

describe("link da IA", () => {
  const hosts = hostsIn("Agende em https://www.clinica.com.br/agenda ou veja agenda.clinica.com.br. Cardápio: bardoze.com.br/cardapio");
  it("só https, de um site que está na base, nunca de WhatsApp", () => {
    expect([...hosts].sort()).toEqual(["agenda.clinica.com.br", "bardoze.com.br", "clinica.com.br"]);
    expect(normalizeLink("https://clinica.com.br/agenda", "Agendar online", hosts)).toEqual({ type: "link", url: "https://clinica.com.br/agenda", label: "Agendar online" });
    expect(normalizeLink("https://sub.clinica.com.br/x", "Abrir", hosts)?.url).toBe("https://sub.clinica.com.br/x");
    expect(normalizeLink("http://clinica.com.br/agenda", "Agendar", hosts)).toBeNull();
    expect(normalizeLink("https://golpe.com/agenda", "Agendar", hosts)).toBeNull();
    expect(normalizeLink("https://wa.me/5521999999999", "WhatsApp", new Set(["wa.me"]))).toBeNull();
    expect(normalizeLink("https://clinica.com.br", "Um rótulo grande demais para botão", hosts)?.label).toBe("Um rótulo grande dem");
  });
});

describe("texto e histórico", () => {
  it("junta o texto da IA e o da ferramenta sem repetir", () => {
    expect(joinShownText("", "Qual sabor?")).toBe("Qual sabor?");
    expect(joinShownText("Qual sabor?", "qual sabor?")).toBe("Qual sabor?");
    expect(joinShownText("Temos 3 sabores.", "Qual você quer?")).toBe("Temos 3 sabores.\n\nQual você quer?");
  });

  it("a IA vê as opções no histórico; o guardado volta conferido", () => {
    const c = { type: "options" as const, options: normalizeOptions(["Calabresa", "Frango"])! };
    expect(componentsNote(c)).toBe("\n[opções mostradas: 1) Calabresa; 2) Frango]");
    expect(parseComponents(JSON.stringify(c))).toEqual(c);
    expect(parseComponents('{"type":"link","url":"javascript:alert(1)","label":"x"}')).toBeNull();
    expect(parseComponents("não é json")).toBeNull();
  });
});

describe("conversão por canal", () => {
  it("WhatsApp: botões, lista (título inteiro na descrição) ou botão com link", () => {
    expect(whatsappPlan({ type: "options", options: normalizeOptions(["Sim", "Não"])! })).toEqual({ kind: "buttons", buttons: [{ id: "op_1", title: "Sim" }, { id: "op_2", title: "Não" }] });
    const list = whatsappPlan({ type: "options", options: normalizeOptions(["Consulta de avaliação odontológica", "Limpeza", "Clareamento", "Canal"])! });
    expect(list.kind).toBe("list");
    if (list.kind === "list") expect(list.rows[0]).toEqual({ id: "op_1", title: "Consulta de avaliação", description: "Consulta de avaliação odontológica" });
    expect(whatsappPlan({ type: "link", url: "https://x.com.br", label: "Abrir" })).toEqual({ kind: "link", label: "Abrir", url: "https://x.com.br" });
  });

  it("Instagram: resumo numerado e respostas rápidas; link no texto", () => {
    const plan = instagramPlan({ type: "options", options: normalizeOptions(["Calabresa", "Marguerita"])! });
    expect(plan.summary).toBe("Responda com o número ou toque numa opção:\n1. Calabresa\n2. Marguerita");
    expect(plan.quickReplies).toEqual([{ title: "Calabresa", payload: "op_1" }, { title: "Marguerita", payload: "op_2" }]);
    expect(instagramLinkText("Veja aqui.", { type: "link", url: "https://x.com.br", label: "Cardápio" })).toBe("Veja aqui.\n\nCardápio: https://x.com.br");
  });
});

describe("portão nos componentes", () => {
  const base = { channel: "whatsapp" as const, contactPhone: "5521999999999", regulatedConversation: false };
  it("tira opção proibida e, sem o 18+, a de bebida (pedindo o botão de 18+)", () => {
    const c = { type: "options" as const, options: normalizeOptions(["Pizza calabresa", "Cigarro", "Heineken long neck"])! };
    const g = gateComponent(c, { ...base, age: null });
    expect(g.component).toEqual({ type: "options", options: [{ id: "op_1", title: "Pizza calabresa" }] });
    expect(g.prohibited.length).toBeGreaterThan(0);
    expect(g.offerAdult).toBe(true);
    // com o "Sim", a bebida fica
    const adult = gateComponent(c, { ...base, age: "sim" });
    expect(adult.component?.type === "options" && adult.component.options.map((o) => o.title)).toEqual(["Pizza calabresa", "Heineken long neck"]);
  });

  it("link com item barrado sai", () => {
    expect(gateComponent({ type: "link", url: "https://x.com.br/cigarro", label: "Comprar cigarro" }, { ...base, age: "sim" }).component).toBeNull();
    expect(gateComponent({ type: "link", url: "https://x.com.br/cardapio", label: "Cardápio" }, { ...base, age: null }).component).not.toBeNull();
  });
});

describe("widget: o texto da ferramenta e o componente entram no stream", () => {
  it("manda o texto (sem repetir) e o data-components", async () => {
    const componente = { type: "options", options: [{ id: "op_1", title: "Sim" }, { id: "op_2", title: "Não" }] };
    const chunks: UIMessageChunk[] = [
      { type: "start" },
      { type: "tool-input-available", toolCallId: "t1", toolName: "mostrar_opcoes", input: {} },
      { type: "tool-output-available", toolCallId: "t1", output: { ok: true, componente, texto: "Quer confirmar?" } },
      { type: "finish" },
    ];
    const out: UIMessageChunk[] = [];
    const stream = new ReadableStream<UIMessageChunk>({ start: (c) => (chunks.forEach((x) => c.enqueue(x)), c.close()) }).pipeThrough(withoutToolParts());
    for await (const c of stream as unknown as AsyncIterable<UIMessageChunk>) out.push(c);
    expect(out.filter((c) => c.type === "text-delta").map((c) => (c as { delta: string }).delta).join("")).toBe("Quer confirmar?");
    expect(out.find((c) => c.type === "data-components")).toEqual({ type: "data-components", data: componente });
    expect(out.some((c) => c.type.startsWith("tool-"))).toBe(false);
  });
});
