import { describe, expect, it } from "vitest";
import { BUSINESS_MAX_CLIENTS, businessProfileProblem, isBusinessMode } from "@/lib/first-access";
import { DAY_TO_DAY, dayToDay } from "@/lib/nav";
import { staticGroups } from "@/lib/go-to";

/*
 * Perfil "Para o meu negócio" (23/10/2026): o painel sem a parte de agência. Chatbots no lugar de
 * Clientes (a página do próprio negócio), sem demos nem "Novo cliente"; vale com até um cliente.
 */

describe("perfil do negócio", () => {
  it("vale com nenhum ou um cliente; com mais, a conta segue como agência", () => {
    expect(BUSINESS_MAX_CLIENTS).toBe(1);
    expect(isBusinessMode("business", 0)).toBe(true);
    expect(isBusinessMode("business", 1)).toBe(true);
    expect(isBusinessMode("business", 2)).toBe(false);
    expect(isBusinessMode("agency", 0)).toBe(false);
    expect(isBusinessMode(null, 0)).toBe(false);
    expect(businessProfileProblem(1)).toBeNull();
    expect(businessProfileProblem(3)).toContain("3 clientes");
  });

  it("o menu: Chatbots abre a página do negócio, e as demos saem", () => {
    const menu = dayToDay({ clientId: "c1" });
    expect(menu.find((i) => i.icon === "bot")).toMatchObject({ href: "/painel/clientes/c1", label: "Chatbots" });
    expect(menu.some((i) => i.href === "/painel/demos" || i.href === "/painel/clientes")).toBe(false);
    // sem o cadastro do negócio ainda (antes do primeiro chatbot), Chatbots leva à tela de criar
    expect(dayToDay({ clientId: null }).find((i) => i.icon === "bot")?.href).toBe("/painel/clientes");
    // a agência continua igual
    expect(dayToDay(null)).toBe(DAY_TO_DAY);
  });

  it("o Ir para: Chatbots, sem Demos nem Novo cliente", () => {
    const business = staticGroups("owner", [], true, { clientId: "c1" });
    expect(business.pages.map((p) => p.title)).toContain("Chatbots");
    expect(business.pages.map((p) => p.title)).not.toContain("Demos");
    expect(business.actions.map((a) => a.id)).not.toContain("novo-cliente");
    expect(business.actions.find((a) => a.id === "novo-chatbot")?.sub).toBe("Um assistente do seu negócio");
    const agency = staticGroups("owner", []);
    expect(agency.actions.map((a) => a.id)).toContain("novo-cliente");
    expect(agency.pages.map((p) => p.title)).toContain("Clientes");
  });
});
