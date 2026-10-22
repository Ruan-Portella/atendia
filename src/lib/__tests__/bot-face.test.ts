import { describe, expect, it } from "vitest";
import { DEFAULT_FACE, faceOf, parseFace } from "@/lib/bot-face";

describe("rosto do chatbot", () => {
  it("sem rosto guardado, o padrão (pílula, sem acessório)", () => {
    expect(faceOf(null)).toEqual(DEFAULT_FACE);
    expect(faceOf({})).toEqual({ eyes: "pilula", acc: "nenhum" });
  });

  it("o que vier errado volta para o padrão, o resto fica", () => {
    expect(faceOf({ eyes: "feliz", acc: "laser" })).toEqual({ eyes: "feliz", acc: "nenhum" });
    expect(faceOf({ eyes: "x", acc: "chef" })).toEqual({ eyes: "pilula", acc: "chef" });
  });

  it("do formulário, só as opções do editor", () => {
    expect(parseFace("piscadinha", "fone")).toEqual({ eyes: "piscadinha", acc: "fone" });
    expect(parseFace("piscadinha", "coroa")).toBeNull();
    expect(parseFace(undefined, "chef")).toBeNull();
  });
});
