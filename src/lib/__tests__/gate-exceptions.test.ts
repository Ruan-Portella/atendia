import { describe, expect, it, vi } from "vitest";
import { dictionaryHits } from "../gate/match";
import { visibleText } from "../gate/base";
import { gatedContext } from "../gate/context";
import { decideEntrance } from "../gate/entrance";
import { checkExit } from "../gate/exit";
import { isGateCategory } from "../gate/exceptions";

/*
 * "Isto não é {categoria}" aprovado pelo BoaVoz: a categoria deixa de ser tratada pelo portão só
 * naquele chatbot, em todas as etapas (dicionário, base classificada, contexto, entrada e saída).
 */
describe("exceção do portão por chatbot", () => {
  it("o dicionário não acusa a categoria liberada (as outras continuam)", () => {
    expect(dictionaryHits("tem vodka e cigarro?").map((h) => h.category).sort()).toEqual(["bebida", "tabaco"]);
    expect(dictionaryHits("tem vodka e cigarro?", { exempt: ["bebida"] }).map((h) => h.category)).toEqual(["tabaco"]);
  });

  it("a base classificada e o contexto mostram o item liberado", () => {
    const hit = { content: "Vodka R$ 30. Pão R$ 5.", gate_version: "v", gate_segments: [{ t: "Vodka R$ 30.", l: 0, c: ["bebida" as const] }, { t: "Pão R$ 5.", l: 0, c: [] }] };
    expect(visibleText(hit, { channel: "whatsapp", age: null }).text).not.toContain("Vodka");
    expect(visibleText(hit, { channel: "whatsapp", age: null, exempt: ["bebida"] }).text).toContain("Vodka");
    expect(gatedContext("Vodka R$ 30.", { channel: "whatsapp", age: null, exempt: ["bebida"] }).context).toContain("Vodka");
  });

  it("entrada: com a categoria liberada, a IA responde direto (sem pergunta de 18+ nem classificador)", async () => {
    const classify = vi.fn(async () => ({ pedidas: ["bebida" as const], tem_outro_assunto: false }));
    const input = { text: "tem vodka?", channel: "whatsapp" as const, age: null, context: "Vodka R$ 30.", companyName: "Loja", classify };
    expect((await decideEntrance(input)).kind).toBe("pede_18");
    classify.mockClear();
    expect(await decideEntrance({ ...input, exempt: ["bebida"] })).toEqual({ kind: "ia", regulated: [], prohibited: [] });
    expect(classify).not.toHaveBeenCalled();
  });

  it("saída: a frase com o item liberado fica", () => {
    const base = { text: "Temos vodka por R$ 30.", channel: "whatsapp" as const, age: null, regulatedConversation: false, destination: null };
    expect(checkExit(base).text).not.toContain("vodka");
    expect(checkExit({ ...base, exempt: ["bebida"] }).text).toBe("Temos vodka por R$ 30.");
  });

  it("só categorias do portão viram exceção", () => {
    expect(isGateCategory("bebida")).toBe(true);
    expect(isGateCategory("qualquer")).toBe(false);
  });
});
