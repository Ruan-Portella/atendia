import { describe, expect, it } from "vitest";
import { backFrom, withFrom } from "../back-link";

describe("voltar para onde a pessoa estava", () => {
  it("o nome da tela de origem", () => {
    expect(backFrom("/painel/caixa?fila=minhas&c=abc")).toEqual({ href: "/painel/caixa?fila=minhas&c=abc", label: "Caixa de entrada" });
    expect(backFrom("/painel/contatos?aba=leads")?.label).toBe("Leads");
    expect(backFrom("/painel/contatos?cliente=x&aba=leads")?.label).toBe("Leads");
    expect(backFrom("/painel/contatos")?.label).toBe("Contatos e leads");
    expect(backFrom("/painel/relatorios")?.label).toBe("Relatórios");
    expect(backFrom("/painel/clientes/c1?tab=leads")?.label).toBe("Cliente");
  });

  it("só endereços do painel", () => {
    expect(backFrom(undefined)).toBeNull();
    expect(backFrom("https://outro.site/painel/caixa")).toBeNull();
    expect(backFrom("//outro.site/painel")).toBeNull();
    expect(backFrom("/painel//x")).toBeNull();
    expect(backFrom("/login")).toBeNull();
    expect(backFrom(["/painel/caixa"])).toBeNull();
  });

  it("o link leva a origem junto", () => {
    expect(withFrom("/painel/clientes/c1?tab=relatorio", "/painel/relatorios")).toBe("/painel/clientes/c1?tab=relatorio&de=%2Fpainel%2Frelatorios");
    expect(withFrom("/painel/bots/b1/conversas/k1", "/painel/contatos?aba=leads")).toBe("/painel/bots/b1/conversas/k1?de=%2Fpainel%2Fcontatos%3Faba%3Dleads");
    expect(withFrom("/x", null)).toBe("/x");
  });
});
