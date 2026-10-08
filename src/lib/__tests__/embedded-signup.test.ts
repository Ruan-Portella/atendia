import { describe, expect, it } from "vitest";
import { esVariantOf, signupExtras } from "../embedded-signup";

describe("pedido do cadastro incorporado", () => {
  it("número novo sempre no formato atual, sem o pedido de coexistência", () => {
    expect(signupExtras(false, "b")).toEqual({ setup: {}, version: "v4", sessionInfoVersion: "3" });
  });

  it("coexistência: o formato muda, o pedido continua", () => {
    const f = { featureType: "whatsapp_business_app_onboarding" };
    expect(signupExtras(true)).toEqual({ setup: {}, version: "v4", sessionInfoVersion: "3", ...f });
    expect(signupExtras(true, "b")).toEqual({ version: "v4", ...f });
    expect(signupExtras(true, "c")).toEqual({ setup: {}, ...f });
    expect(signupExtras(true, "d")).toEqual({ setup: {}, sessionInfoVersion: "3", ...f });
    expect(signupExtras(true, "e")).toEqual({ setup: {}, version: "v4-public-preview", sessionInfoVersion: "3", ...f });
  });

  it("formato do endereço: só os conhecidos", () => {
    expect(esVariantOf("c")).toBe("c");
    expect(esVariantOf("z")).toBe("a");
    expect(esVariantOf(undefined)).toBe("a");
    expect(esVariantOf(["b"])).toBe("a");
    expect(esVariantOf("toString")).toBe("a");
  });
});
