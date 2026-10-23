import { describe, expect, it } from "vitest";
import { suggestedSummary, widgetPositionSummary } from "../widget-appearance";

describe("resumos da aparência do chat do site", () => {
  it("perguntas sugeridas: nenhuma, uma e várias", () => {
    expect(suggestedSummary([])).toBe("Nenhuma: o chat abre só com a saudação");
    expect(suggestedSummary(["Quanto custa?"])).toBe("1 pergunta: Quanto custa?");
    expect(suggestedSummary(["A?", "B?", "C?"])).toBe("3 perguntas: A? · B? · …");
  });

  it("balão: o canto e a distância, com o padrão de 20 px", () => {
    expect(widgetPositionSummary("left", 40)).toBe("No canto esquerdo, a 40 px da borda");
    expect(widgetPositionSummary(undefined, undefined)).toBe("No canto direito, a 20 px da borda");
    expect(widgetPositionSummary("right", 900)).toBe("No canto direito, a 200 px da borda");
  });
});
