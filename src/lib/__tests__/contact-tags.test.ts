import { describe, expect, it } from "vitest";
import { normalizeTags } from "../contacts";

describe("etiquetas do contato", () => {
  it("separa por vírgula, tira o # e os espaços sobrando", () => {
    expect(normalizeTags("cliente vip, #pizza ,  zona   sul")).toEqual(["cliente vip", "pizza", "zona sul"]);
    expect(normalizeTags("a;b\nc")).toEqual(["a", "b", "c"]);
  });

  it("sem repetir (maiúscula e minúscula contam como a mesma) e sem vazias", () => {
    expect(normalizeTags("VIP, vip, , Vip")).toEqual(["VIP"]);
    expect(normalizeTags("  ,  ")).toEqual([]);
  });

  it("até 20 etiquetas de até 30 caracteres", () => {
    expect(normalizeTags(Array.from({ length: 25 }, (_, i) => `t${i}`).join(","))).toHaveLength(20);
    expect(normalizeTags("x".repeat(50))[0]).toHaveLength(30);
  });
});
