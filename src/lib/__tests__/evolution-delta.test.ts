import { describe, expect, it } from "vitest";
import { deltaLabel } from "@/components/evolution-table";

describe("a diferença para o mês anterior", () => {
  it("mais, menos, igual e sem o anterior", () => {
    expect(deltaLabel(120, 100, "", "Set/26")).toBe("+20 que Set/26");
    expect(deltaLabel(80, 90, " p.p.", "Set/26")).toBe("−10 p.p. que Set/26");
    expect(deltaLabel(5, 5, "", "Set/26")).toBe("igual a Set/26");
    expect(deltaLabel(5, null)).toBeNull();
    expect(deltaLabel(null, 5)).toBeNull();
  });
});
