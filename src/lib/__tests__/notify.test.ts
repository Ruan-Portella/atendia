import { describe, expect, it } from "vitest";
import { usageAlertLevel } from "../notify";

describe("usageAlertLevel (avisos de cota uma vez por mês)", () => {
  it("avisa exatamente ao chegar em 80%", () => {
    expect(usageAlertLevel(1600, 2000)).toBe(80);
    expect(usageAlertLevel(1599, 2000)).toBeNull();
    expect(usageAlertLevel(1601, 2000)).toBeNull();
  });
  it("avisa na primeira conversa acima do limite, e só nela", () => {
    expect(usageAlertLevel(2000, 2000)).toBeNull();
    expect(usageAlertLevel(2001, 2000)).toBe(100);
    expect(usageAlertLevel(2002, 2000)).toBeNull();
  });
  it("arredonda para cima em limites quebrados", () => {
    expect(usageAlertLevel(160, 200)).toBe(80);
    expect(usageAlertLevel(3, 3)).toBe(80); // 80% de 3 = 2,4 → avisa no 3º
    expect(usageAlertLevel(4, 3)).toBe(100);
  });
  it("plano cancelado (limite 0) não manda e-mail todo mês", () => {
    expect(usageAlertLevel(1, 0)).toBeNull();
  });
});
