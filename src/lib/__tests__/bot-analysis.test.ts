import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateCategories, analysisPrompt, flagNewProhibited, parseAnalysis, reviewNeeded } from "../bot-analysis";

describe("análise do bot", () => {
  it("agrega a classificação dos trechos: trechos por categoria, com até 3 exemplos", () => {
    const found = aggregateCategories([
      { gate_segments: [{ t: "Heineken R$ 12", c: ["bebida"] }, { t: "Brahma R$ 8", c: ["bebida"] }, { t: "Pão R$ 2" }] },
      { gate_segments: [{ t: "Vodka R$ 30", c: ["bebida"] }, { t: "Cigarro R$ 15", c: ["tabaco"] }] },
      { gate_segments: [{ t: "Gin R$ 40", c: ["bebida", "categoria_que_nao_existe"] }] },
      { gate_segments: null },
    ]);
    expect(found).toEqual([
      { categoria: "bebida", nivel: "regulamentado", trechos: 3, exemplos: ["Heineken R$ 12", "Brahma R$ 8", "Vodka R$ 30"] },
      { categoria: "tabaco", nivel: "proibido", trechos: 1, exemplos: ["Cigarro R$ 15"] },
    ]);
  });

  it("o texto analisado traz instruções, assuntos, fontes e os itens achados", () => {
    const p = analysisPrompt({ company: "Bar do Zé", instructions: "Atenda com simpatia", topics: "petiscos", sources: ["Cardápio"], found: [{ categoria: "bebida", nivel: "regulamentado", trechos: 2, exemplos: ["Heineken"] }], sample: "Chopp R$ 10" });
    expect(p).toContain("Bar do Zé");
    expect(p).toContain("Atenda com simpatia");
    expect(p).toContain("bebida alcoólica (regulamentado, 2 trecho(s)): Heineken");
    expect(p).toContain("ia_como_produto");
  });

  it("lê a resposta da IA; fora do formato conta como incerto (vai para revisão)", () => {
    expect(parseAnalysis('{"ia_como_produto":"nao","motivo_ia":"vende comida","modelo_proibido":"nao","categoria_principal":null,"resumo":"Bar"}')).toEqual({ ia_como_produto: "nao", motivo_ia: "vende comida", modelo_proibido: "nao", categoria_principal: null, resumo: "Bar", area_saude: "incerto" });
    expect(parseAnalysis('{"ia_como_produto":"nao","modelo_proibido":"nao","area_saude":"sim"}').area_saude).toBe("sim");
    expect(parseAnalysis('```json\n{"ia_como_produto":"sim","modelo_proibido":"talvez","categoria_principal":"tabaco"}\n```')).toMatchObject({ ia_como_produto: "sim", modelo_proibido: "incerto", categoria_principal: "tabaco" });
    expect(parseAnalysis("não sei responder")).toMatchObject({ ia_como_produto: "incerto", modelo_proibido: "incerto" });
  });

  it("pendência só com sim ou incerto em uma das perguntas", () => {
    expect(reviewNeeded({ ia_como_produto: "nao", modelo_proibido: "nao" })).toBe(false);
    expect(reviewNeeded({ ia_como_produto: "sim", modelo_proibido: "nao" })).toBe(true);
    expect(reviewNeeded({ ia_como_produto: "nao", modelo_proibido: "incerto" })).toBe(true);
  });

  it("fonte nova: reagenda só se aparecer categoria proibida que a última análise não tinha", async () => {
    const update = vi.fn(() => ({ eq: () => ({ eq: async () => ({ error: null }) }) }));
    const db = (labels: unknown) =>
      ({
        from: (t: string) =>
          t === "bots"
            ? { update }
            : { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { labels } }) }) }) }) }) }) },
      }) as unknown as SupabaseClient;
    const known = { categorias: [{ categoria: "tabaco" }] };
    await flagNewProhibited(db(known), "b1", ["bebida"]); // regulamentado não reagenda
    await flagNewProhibited(db(known), "b1", ["tabaco"]); // já conhecida
    expect(update).not.toHaveBeenCalled();
    await flagNewProhibited(db(known), "b1", ["armas"]);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
