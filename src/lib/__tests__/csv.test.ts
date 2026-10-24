import { describe, expect, it } from "vitest";
import { csvCell } from "../csv";

/* Exportações sem fórmula (relatório de segurança de 23/10/2026, M8): leads, conversas e auditoria. */

describe("célula de CSV", () => {
  it("texto que começa com fórmula vira texto", () => {
    expect(csvCell('=HYPERLINK("http://x","clique")')).toBe('"\'=HYPERLINK(""http://x"",""clique"")"');
    expect(csvCell("@SUM(1+1)")).toBe("'@SUM(1+1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("\tx")).toBe("'\tx");
  });

  it("o resto fica como veio", () => {
    expect(csvCell("Ana Souza")).toBe("Ana Souza");
    expect(csvCell("Bar; Restaurante")).toBe('"Bar; Restaurante"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(true)).toBe("true");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});
