import { describe, expect, it } from "vitest";
import { exclusionOf, templateGate } from "../campaign-audience";
import { renderVariables, variablesProblem } from "../campaign-text";
import { isQuietHour, localHour, localInputToIso, nextEightAm } from "../timezone";
import { isOptOutKeyword } from "../suppression";
import { campaignsInPlan } from "../plan-limits";
import { decideSend } from "../campaigns";

const ok = { phone: "5521999990000", suppressed: [], consent: "granted", regulated: false, age: null } as Parameters<typeof exclusionOf>[0];

describe("público de marketing: quem fica de fora e por quê", () => {
  it("entra quem aceitou novidades, não pediu para sair e não é menor", () => {
    expect(exclusionOf(ok)).toBeNull();
    expect(exclusionOf({ ...ok, age: "sim" })).toBeNull();
  });

  it("motivos, na ordem da tela", () => {
    expect(exclusionOf({ ...ok, phone: null })).toBe("no_phone");
    expect(exclusionOf({ ...ok, suppressed: ["marketing"] })).toBe("suppressed");
    expect(exclusionOf({ ...ok, suppressed: ["all"] })).toBe("suppressed");
    // SAIR só dos lembretes não tira do marketing
    expect(exclusionOf({ ...ok, suppressed: ["utility"] })).toBeNull();
    expect(exclusionOf({ ...ok, consent: "none" })).toBe("no_consent");
    expect(exclusionOf({ ...ok, consent: "revoked" })).toBe("no_consent");
    expect(exclusionOf({ ...ok, age: "nao" })).toBe("minor");
    expect(exclusionOf({ ...ok, regulated: true, age: null })).toBe("no_age");
    expect(exclusionOf({ ...ok, phone: "15550001111" })).toBe("country");
  });

  it("no envio, quem disse não ao 18+ fica fora do marketing, mas recebe lembrete", () => {
    const base = { suppressed: [], consent: "granted" as const, regulated: false, age: "nao" as const, contactGone: false };
    expect(decideSend({ ...base, templateCategory: "MARKETING" })).toBe("skipped_no_age");
    expect(decideSend({ ...base, templateCategory: "UTILITY", consent: "none" })).toBe("send");
  });
});

describe("modelo da campanha pelo portão", () => {
  it("bebida é regulamentada (só 18+); item proibido barra", () => {
    expect(templateGate("Happy hour: chopp em dobro até as 20h!").regulated).toContain("bebida alcoólica");
    expect(templateGate("Pizza grande com 20% de desconto hoje").regulated).toEqual([]);
    expect(templateGate("Cigarro eletrônico com desconto").prohibited.length).toBeGreaterThan(0);
  });
});

describe("variáveis", () => {
  it("primeiro nome do contato, ou o texto para quem não tem nome", () => {
    expect(renderVariables([{ mode: "name", value: "cliente" }, { mode: "fixed", value: " sexta " }], "Ana Souza")).toEqual(["Ana", "sexta"]);
    expect(renderVariables([{ mode: "name", value: "cliente" }], null)).toEqual(["cliente"]);
    expect(renderVariables([{ mode: "name", value: "cliente" }], "   ")).toEqual(["cliente"]);
  });

  it("todas preenchidas e no formato que a Meta aceita", () => {
    expect(variablesProblem([{ mode: "fixed", value: "x" }], 1)).toBeNull();
    expect(variablesProblem([], 1)).toMatch(/preencha todas/);
    expect(variablesProblem([{ mode: "name", value: "" }], 1)).toMatch(/quem não tem nome/);
    expect(variablesProblem([{ mode: "fixed", value: "a\nb" }], 1)).toMatch(/quebra de linha/);
  });
});

describe("fuso do cliente", () => {
  // 23:30 em Brasília = 02:30 UTC do dia seguinte
  const night = new Date("2026-10-09T02:30:00Z");

  it("hora local e as 20h às 8h", () => {
    expect(localHour("America/Sao_Paulo", night)).toBe(23);
    expect(localHour("America/Manaus", night)).toBe(22);
    expect(localHour("America/Noronha", night)).toBe(0);
    expect(localHour("Europe/Lisbon", night)).toBe(23); // fora da lista: Brasília
    expect([7, 20, 23].map(isQuietHour)).toEqual([true, true, true]);
    expect([8, 12, 19].map(isQuietHour)).toEqual([false, false, false]);
  });

  it("próximas 8h: amanhã de noite, hoje de madrugada", () => {
    expect(nextEightAm("America/Sao_Paulo", night)).toBe("2026-10-09T11:00:00.000Z");
    expect(nextEightAm("America/Sao_Paulo", new Date("2026-10-09T08:00:00Z"))).toBe("2026-10-09T11:00:00.000Z"); // 05h local
    expect(nextEightAm("America/Rio_Branco", night)).toBe("2026-10-09T13:00:00.000Z");
  });

  it("data digitada lida no fuso do cliente", () => {
    expect(localInputToIso("2026-10-09T14:30", "America/Sao_Paulo")).toBe("2026-10-09T17:30:00.000Z");
    expect(localInputToIso("2026-10-09T14:30", "America/Manaus")).toBe("2026-10-09T18:30:00.000Z");
    expect(localInputToIso("09/10/2026", "America/Sao_Paulo")).toBeNull();
  });
});

describe("regras da tela", () => {
  it("botão Parar promoções do modelo de marketing descadastra", () => {
    expect(isOptOutKeyword("Parar promoções")).toBe(true);
    expect(isOptOutKeyword("parar promocoes")).toBe(true);
    expect(isOptOutKeyword("parar de receber")).toBe(false);
  });

  it("campanhas só nos planos pagos", () => {
    expect(["freelancer", "agencia", "escala"].map(campaignsInPlan)).toEqual([true, true, true]);
    expect(["trial", "cancelado", "qualquer"].map(campaignsInPlan)).toEqual([false, false, false]);
  });
});
