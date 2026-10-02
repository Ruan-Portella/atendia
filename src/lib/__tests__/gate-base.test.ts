import { describe, expect, it } from "vitest";
import { BASE_GATE_VERSION, itemCategory, joinSegments, parseBaseItems, splitSegments, visibleText, type Segment } from "../gate/base";
import { RULES_VERSION } from "../gate/rules";
import { gatePrompt, type ContextHit } from "../chat";

describe("frases do trecho", () => {
  it("corta por linha e por frase e remonta igual", () => {
    const text = "Bar do Zé - Cardápio\nPizzas: calabresa R$ 45. Marguerita R$ 42.\nDrinks: Moscow Mule R$ 28.";
    const segs = splitSegments(text);
    expect(segs.map((s) => [s.l, s.t])).toEqual([
      [0, "Bar do Zé - Cardápio"],
      [1, "Pizzas: calabresa R$ 45."],
      [1, "Marguerita R$ 42."],
      [2, "Drinks: Moscow Mule R$ 28."],
    ]);
    expect(joinSegments(segs)).toBe(text);
    expect(joinSegments(segs.filter((s) => !s.t.includes("Moscow")))).toBe("Bar do Zé - Cardápio\nPizzas: calabresa R$ 45. Marguerita R$ 42.");
  });

  it("a versão muda junto com as regras", () => {
    expect(BASE_GATE_VERSION.startsWith(RULES_VERSION)).toBe(true);
  });
});

describe("resposta da IA na classificação", () => {
  it("só itens com número e categoria válidos; resposta quebrada é erro (tenta de novo depois)", () => {
    const raw = '```json\n{"itens": [{"n": 2, "categoria": "bebida"}, {"n": 9, "categoria": "bebida"}, {"n": 1, "categoria": "inventada"}, {"n": 1, "categoria": "remedio_receita"}]}\n```';
    expect(parseBaseItems(raw, 3)).toEqual([{ n: 2, categoria: "bebida" }]);
    expect(() => parseBaseItems("não sei", 3)).toThrow();
  });

  it("remédio passa pela lista da Anvisa; sem o fármaco, conta como isento (18+)", () => {
    expect(itemCategory({ n: 1, categoria: "medicamento", farmaco: "amoxicilina", forma: "cápsula", concentracao: "500 mg" })).toBe("remedio_receita");
    expect(itemCategory({ n: 1, categoria: "medicamento", farmaco: "ibuprofeno", forma: "comprimido", concentracao: "400 mg" })).toBe("medicamento");
    expect(itemCategory({ n: 1, categoria: "medicamento", farmaco: "ibuprofeno", forma: "comprimido", concentracao: "600 mg" })).toBe("remedio_receita");
    expect(itemCategory({ n: 1, categoria: "medicamento" })).toBe("medicamento");
    expect(itemCategory({ n: 1, categoria: "bebida" })).toBe("bebida");
  });
});

describe("texto que cada pessoa vê (trecho classificado)", () => {
  const segments: Segment[] = [
    { t: "Pizzas: calabresa R$ 45.", l: 0 },
    { t: "Drinks: Moscow Mule R$ 28.", l: 1, c: ["bebida"] },
    { t: "Essência de narguilé R$ 50.", l: 2, c: ["tabaco"] },
  ];
  const hit = { content: "(original)", gate_version: BASE_GATE_VERSION, gate_segments: segments };
  const br = "5521999990000";

  it("sem o Sim do 18+: só o que não é restrito", () => {
    expect(visibleText(hit, { channel: "whatsapp", contactPhone: br, age: null })).toEqual({ text: "Pizzas: calabresa R$ 45.", hidden: ["bebida", "tabaco"] });
  });

  it("com o Sim: a bebida volta; o proibido nunca", () => {
    expect(visibleText(hit, { channel: "instagram", age: "sim" }).text).toBe("Pizzas: calabresa R$ 45.\nDrinks: Moscow Mule R$ 28.");
  });

  it("WhatsApp de fora do Brasil: bebida não aparece nem com o Sim", () => {
    expect(visibleText(hit, { channel: "whatsapp", contactPhone: "14155550123", age: "sim" }).text).toBe("Pizzas: calabresa R$ 45.");
  });

  it("trecho sem classificação ou sem nada restrito: inteiro", () => {
    expect(visibleText({ content: "texto", gate_version: null }, { channel: "whatsapp", age: null })).toEqual({ text: "texto", hidden: [] });
    expect(visibleText({ content: "texto", gate_version: BASE_GATE_VERSION, gate_segments: null }, { channel: "whatsapp", age: null })).toEqual({ text: "texto", hidden: [] });
  });

  it("no prompt: o item que só a IA conhecia some e a instrução de 18+ entra", () => {
    const hits: ContextHit[] = [{ content: "Pizzas: calabresa R$ 45.\nDrinks: Moscow Mule R$ 28.", metadata: { title: "Cardápio" }, similarity: 0.8, gate_version: BASE_GATE_VERSION, gate_segments: segments.slice(0, 2), gate_categories: ["bebida"] }];
    const g = gatePrompt({ regulated_channel: null, human_handoff: null }, { context: "", hits }, { channel: "whatsapp", contactPhone: br, gate: { age: null } });
    expect(g.context).toBe("[1] Cardápio\nPizzas: calabresa R$ 45.");
    expect(g.gateNotes.join(" ")).toContain("pedir_confirmacao_18");
  });
});
