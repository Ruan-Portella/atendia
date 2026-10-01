import { describe, expect, it } from "vitest";
import { CATEGORIES, CHANNEL_MATRIX, DICTIONARY, EXCEPTIONS, GATE_TEXTS, RULES_VERSION, effectiveLevel, type GateCategory } from "../gate/rules";
import { dictionaryHits, hitSummary, normalizeGateText } from "../gate/match";
import { LMIP_FITOTERAPICOS, LMIP_SINTETICOS } from "../gate/lmip";

const cats = (text: string, opts?: Parameters<typeof dictionaryHits>[1]) => [...new Set(dictionaryHits(text, opts).map((h) => h.category))].sort();

describe("regras do próprio dicionário", () => {
  const all = Object.entries(DICTIONARY) as Array<[GateCategory, string[]]>;

  it("termos já normalizados (sem acento, minúsculas), sem repetição na categoria", () => {
    for (const [cat, terms] of all) {
      for (const t of terms) expect(normalizeGateText(t).trim(), `${cat}: ${t}`).toBe(t);
      expect(new Set(terms).size, cat).toBe(terms.length);
    }
  });

  it("\"real\" e \"reais\" nunca são termo (\"gastei 20 reais\" não é câmbio)", () => {
    for (const [cat, terms] of all) {
      for (const t of terms) {
        expect(t.split(" "), `${cat}: ${t}`).not.toContain("real");
        expect(t.split(" "), `${cat}: ${t}`).not.toContain("reais");
      }
    }
  });

  it("nenhum termo em duas categorias de níveis diferentes", () => {
    const levelOf = new Map<string, string>();
    for (const [cat, terms] of all) {
      for (const t of terms) {
        const prev = levelOf.get(t);
        if (prev) expect(prev, `"${t}" em níveis diferentes`).toBe(CATEGORIES[cat].level);
        levelOf.set(t, CATEGORIES[cat].level);
      }
    }
  });

  it("exceção tem 2+ palavras, contém um termo da categoria e nunca é igual a um termo", () => {
    for (const [cat, list] of Object.entries(EXCEPTIONS) as Array<[GateCategory, string[]]>) {
      for (const e of list) {
        expect(e.split(" ").length, `${cat}: ${e}`).toBeGreaterThanOrEqual(2);
        expect(normalizeGateText(e).trim(), `${cat}: ${e}`).toBe(e);
        expect(DICTIONARY[cat].includes(e), `${cat}: "${e}" é igual a um termo`).toBe(false);
        expect(DICTIONARY[cat].some((t) => ` ${e} `.includes(` ${t} `)), `${cat}: "${e}" não contém termo da categoria`).toBe(true);
      }
    }
  });

  it("versão das regras e textos fixos definidos; botão dentro do limite da Meta", () => {
    expect(RULES_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(GATE_TEXTS.showAdultOptions.length).toBeLessThanOrEqual(20);
    expect(GATE_TEXTS.prohibited).toBe("Desculpe, não conseguimos atender esse pedido por aqui. Posso ajudar com outra coisa?");
  });
});

describe("dicionário: o que acusa", () => {
  it("casos positivos do documento", () => {
    expect(cats("tem Heineken?")).toEqual(["bebida"]);
    expect(cats("vende pod?")).toEqual(["tabaco"]);
    expect(cats("vodka")).toEqual(["bebida"]);
    expect(cats("pão, leite e um maço de cigarro")).toEqual(["tabaco"]);
    expect(cats("tem amoxicilina?")).toEqual(["remedio_receita"]);
    expect(cats("quanto custa o Botox?")).toEqual(["estetica_injetavel"]);
    expect(cats("vocês têm CERVEJAS geladas")).toEqual(["bebida"]);
    expect(cats("fralda e uma lata de NAN Supreme")).toEqual(["produto_saude"]);
  });

  it("casos negativos do documento (exceções e palavras que não são termo)", () => {
    expect(cats("frango na cerveja")).toEqual([]);
    expect(cats("bolo de rum")).toEqual([]);
    expect(cats("vinagre de vinho")).toEqual([]);
    expect(cats("gastei 20 reais")).toEqual([]);
    expect(cats("risoto ao vinho e uma vitamina de banana")).toEqual([]);
    expect(cats("o carro tem câmbio automático?")).toEqual([]);
    expect(cats("pode me ajudar?")).toEqual([]); // "pode" não é "pod"
    expect(cats("quero agendar uma avaliação")).toEqual([]);
  });

  it("exceção de uma categoria não esconde outra no mesmo texto", () => {
    expect(cats("frango na cerveja e uma vodka")).toEqual(["bebida"]);
  });

  it("nomes classificados no bot entram como termo daquele bot", () => {
    expect(cats("tem neosaldina?", { extraTerms: [{ category: "medicamento", term: "Neosaldina" }] })).toEqual(["medicamento"]);
  });

  it("resumo por nível para a etapa da IA", () => {
    expect(hitSummary(dictionaryHits("2 Heineken e um maço de cigarro"))).toEqual({ proibidos: ["tabaco"], regulamentados: ["bebida"] });
  });
});

describe("canal e país", () => {
  it("no widget do site não há portão", () => {
    expect(cats("tem Heineken?", { channel: "widget" })).toEqual([]);
    expect(effectiveLevel("tabaco", "widget")).toBe("permitido");
  });

  it("no WhatsApp, regulamentado só para +55; fora do Brasil vira proibido", () => {
    expect(effectiveLevel("bebida", "whatsapp", "5521999998888")).toBe("regulamentado");
    expect(effectiveLevel("bebida", "whatsapp", "14155550123")).toBe("proibido");
    expect(effectiveLevel("bebida", "instagram", "14155550123")).toBe("regulamentado");
  });

  it("votação só é proibida no WhatsApp", () => {
    expect(effectiveLevel("votacao", "whatsapp")).toBe("proibido");
    expect(effectiveLevel("votacao", "instagram")).toBe("permitido");
  });

  it("quadro canal × categoria: regulamentados travados nos canais da Meta, livres no widget", () => {
    for (const cat of ["bebida", "medicamento"] as const) {
      expect(CHANNEL_MATRIX[cat].whatsapp).toBe("18_sem_venda");
      expect(CHANNEL_MATRIX[cat].widget).toBe("livre");
    }
  });
});

describe("lista de MIP (Anvisa, IN 285/2024)", () => {
  it("tem os dois anexos completos", () => {
    expect(LMIP_SINTETICOS.length).toBeGreaterThan(250);
    expect(LMIP_FITOTERAPICOS.length).toBeGreaterThan(50);
  });

  it("ibuprofeno: comprimido comum e revestido só até 400 mg; 600 mg só na liberação prolongada (a forma importa)", () => {
    const ibu = LMIP_SINTETICOS.filter((m) => m.farmaco === "Ibuprofeno" && /comprimido/i.test(m.forma));
    const comum = ibu.filter((m) => !/libera[cç][aã]o prolongada/i.test(m.forma));
    expect(comum.length).toBeGreaterThan(0);
    for (const m of comum) expect(m.concentracaoMaxima).toBe("400 mg");
    expect(ibu.some((m) => /libera[cç][aã]o prolongada/i.test(m.forma) && m.concentracaoMaxima.startsWith("600 mg"))).toBe(true);
  });
});
