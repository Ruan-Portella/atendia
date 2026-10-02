import { describe, expect, it } from "vitest";
import { lmipCheck, parseConcentration } from "../gate/lmip-check";

describe("concentração", () => {
  it("lê os formatos da lista e do texto das empresas", () => {
    expect(parseConcentration("400 + 200 mg")).toEqual({ values: [400, 200], unit: "mg" });
    expect(parseConcentration("11,5 mg/mL")).toEqual({ values: [11.5], unit: "mg/ml" });
    expect(parseConcentration("1 g")).toEqual({ values: [1000], unit: "mg" });
    expect(parseConcentration("200mg/5mL")).toEqual({ values: [40], unit: "mg/ml" });
    expect(parseConcentration("600 mg (200 mg liberação imediata + 400 mg liberação prolongada)")).toEqual({ values: [600], unit: "mg" });
    expect(parseConcentration("2%")).toEqual({ values: [2], unit: "%" });
    expect(parseConcentration("caixa com 10")).toBeNull();
  });
});

describe("remédio isento (MIP) ou com receita, pela lista da Anvisa", () => {
  it("dentro da lista: isento", () => {
    expect(lmipCheck("Dipirona", "comprimido", "500 mg").status).toBe("mip");
    expect(lmipCheck("dipirona sódica", "comprimidos", "1 g").status).toBe("mip");
    expect(lmipCheck("Paracetamol", "comprimido revestido", "750 mg").status).toBe("mip");
    expect(lmipCheck("Loratadina", null, null).status).toBe("mip");
  });

  it("acima da concentração máxima: com receita", () => {
    expect(lmipCheck("Ibuprofeno", "comprimido", "600 mg")).toEqual({ status: "receita", reason: "600 mg acima do máximo isento" });
    expect(lmipCheck("Paracetamol", "comprimido revestido", "1 g").status).toBe("receita");
  });

  it("a forma importa: ibuprofeno 600 mg só é isento de liberação prolongada", () => {
    expect(lmipCheck("Ibuprofeno", "comprimido revestido de liberação prolongada", "600 mg").status).toBe("mip");
    expect(lmipCheck("Ibuprofeno", "injetável", "400 mg")).toEqual({ status: "receita", reason: 'forma "injetável" fora da lista de isentos' });
  });

  it("fora da lista: com receita", () => {
    expect(lmipCheck("Amoxicilina", "cápsula", "500 mg")).toEqual({ status: "receita", reason: "fora da lista de isentos da Anvisa" });
    expect(lmipCheck("Clonazepam").status).toBe("receita");
  });

  it("associação precisa de todos os componentes", () => {
    expect(lmipCheck("Ácido acetilsalicílico + cafeína", "comprimido", "650 + 65 mg").status).toBe("mip");
    expect(lmipCheck("cafeína + ácido acetilsalicílico", "comprimido", null).status).toBe("mip");
    expect(lmipCheck("Ácido acetilsalicílico + codeína").status).toBe("receita");
  });

  it("fitoterápico da lista: isento", () => {
    expect(lmipCheck("Aesculus hippocastanum").status).toBe("mip");
  });
});
