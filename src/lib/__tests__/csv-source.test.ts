import { describe, expect, it } from "vitest";
import { csvToText } from "../csv-source";

describe("csvToText", () => {
  it("cada linha sai com o nome das colunas, sem as células vazias", () => {
    expect(csvToText("Produto;Preço;Obs\nPizza;R$ 40;\n\"Suco; laranja\";R$ 8;gelado\n")).toEqual({ text: "Produto: Pizza; Preço: R$ 40\nProduto: Suco; laranja; Preço: R$ 8; Obs: gelado", rows: 2 });
  });
  it("recusa planilha só com cabeçalho", () => {
    expect(csvToText("a,b\n")).toHaveProperty("error");
  });
});
