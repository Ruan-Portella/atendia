import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { chunkRows } from "../ingest";
import { searchQuestion } from "../chat";
import { parseSheet, sheetToText } from "../csv-source";

/* Bug do Loki (24/10/2026): a planilha virava trechos de vários produtos e o "quero sim" perdia o assunto. */

const user = (text: string): UIMessage => ({ id: text, role: "user", parts: [{ type: "text", text }] });
const ai = (text: string): UIMessage => ({ id: text, role: "assistant", parts: [{ type: "text", text }] });

describe("busca na planilha", () => {
  it("cada linha da planilha vira um trecho, inteiro", () => {
    const text = ["Descrição: QUADRO MEDIO; Preço: 30", "Descrição: LOKI; Unidade: UN; Preço: 149,9", "", "  ", "Descrição: ACTION FIGURA QPOSKET - ERIN; Preço: 180"].join("\n");
    expect(chunkRows(text)).toEqual(["Descrição: QUADRO MEDIO; Preço: 30", "Descrição: LOKI; Unidade: UN; Preço: 149,9", "Descrição: ACTION FIGURA QPOSKET - ERIN; Preço: 180"]);
  });

  it("a mensagem curta leva junto a anterior da pessoa; a longa vai sozinha", () => {
    const history = [user("Vocês tem o loki?"), ai("Esse produto faz parte do nosso catálogo e custa R$ 149,90."), user("quero sim")];
    expect(searchQuestion("quero sim", history)).toBe("Vocês tem o loki?\nquero sim");
    expect(searchQuestion("Vocês têm a caixa de som SM23 na cor preta?", history)).toBe("Vocês têm a caixa de som SM23 na cor preta?");
    expect(searchQuestion("oi", [user("oi")])).toBe("oi");
  });
});

describe("ver e editar a planilha", () => {
  it("o texto guardado volta em colunas e linhas, e de volta ao texto", () => {
    const text = ["ID: 1; Descrição: LOKI; Preço: 149,9", "ID: 2; Código: SM23; Descrição: CAIXA DE SOM; Preço: 180", "ID: 3; Descrição: CAPA; COR AZUL; Preço: 30"].join("\n");
    const s = parseSheet(text);
    expect(s.cols).toEqual(["ID", "Descrição", "Preço", "Código"]);
    expect(s.rows[0]).toEqual(["1", "LOKI", "149,9", ""]);
    expect(s.rows[1]).toEqual(["2", "CAIXA DE SOM", "180", "SM23"]);
    // o "; " dentro do valor volta junto
    expect(s.rows[2][1]).toBe("CAPA; COR AZUL");
    const edited = s.rows.map((r) => [...r]);
    edited[0][2] = "139,9";
    expect(sheetToText(s.cols, [...edited, ["", "", "", ""]])).toBe(["ID: 1; Descrição: LOKI; Preço: 139,9", "ID: 2; Descrição: CAIXA DE SOM; Preço: 180; Código: SM23", "ID: 3; Descrição: CAPA; COR AZUL; Preço: 30"].join("\n"));
  });
});
