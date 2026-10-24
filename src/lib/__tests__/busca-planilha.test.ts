import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { chunkRows } from "../ingest";
import { searchQuestion } from "../chat";

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
