import { describe, expect, it } from "vitest";
import { faqText, parseFaq } from "@/lib/faq-text";

describe("parseFaq", () => {
  it("lê um par por parágrafo, com a resposta em mais de uma linha", () => {
    expect(parseFaq("P: Aceitam Unimed?\nR: Sim, para consultas.\n\nP: Tem estacionamento?\nR: Sim.\nGratuito no subsolo.")).toEqual([
      { q: "Aceitam Unimed?", a: "Sim, para consultas." },
      { q: "Tem estacionamento?", a: "Sim.\nGratuito no subsolo." },
    ]);
  });

  it("aceita CRLF, minúsculas e linhas em branco a mais", () => {
    expect(parseFaq("\r\np: Abre sábado?\r\nr: Até as 13h.\r\n\r\n\r\n")).toEqual([{ q: "Abre sábado?", a: "Até as 13h." }]);
  });

  it("devolve null quando um parágrafo foge do formato", () => {
    expect(parseFaq("P: Aceitam Unimed?\nR: Sim.\n\nTexto solto sem pergunta.")).toBeNull();
  });

  it("texto vazio vira lista vazia", () => {
    expect(parseFaq("  \n ")).toEqual([]);
  });
});

describe("faqText", () => {
  it("volta ao formato salvo e tira os pares vazios", () => {
    expect(faqText([{ q: " Abre sábado? ", a: "Até as 13h." }, { q: "", a: " " }, { q: "Tem Pix?", a: "Sim." }])).toBe("P: Abre sábado?\nR: Até as 13h.\n\nP: Tem Pix?\nR: Sim.");
  });

  it("ida e volta mantém os pares", () => {
    const pairs = [
      { q: "Aceitam Unimed?", a: "Sim." },
      { q: "Tem estacionamento?", a: "Sim, gratuito." },
    ];
    expect(parseFaq(faqText(pairs))).toEqual(pairs);
  });
});
