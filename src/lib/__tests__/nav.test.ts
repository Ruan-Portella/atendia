import { describe, expect, it } from "vitest";
import { DAY_TO_DAY, activeSettingsHref, allowed, firstSettingsHref, settingsFor } from "@/lib/nav";

describe("mapa do painel", () => {
  it("cada papel vê só os ajustes que pode abrir", () => {
    expect(settingsFor("owner", []).map((g) => g.group)).toEqual(["Conta", "Cobrança", "Integrações", "Biblioteca"]);
    // os modelos saíram das Configurações (foram para o menu)
    expect(settingsFor("owner", ["plataforma"]).find((g) => g.group === "Biblioteca")?.items.map((i) => i.href)).toEqual(["/painel/demos"]);
    // administrador: tudo menos cobrança
    expect(settingsFor("admin", []).map((g) => g.group)).toEqual(["Conta", "Integrações", "Biblioteca"]);
    // editor: só a biblioteca; atendente: nada
    expect(settingsFor("editor", []).map((g) => g.group)).toEqual(["Biblioteca"]);
    expect(settingsFor("agent", [])).toEqual([]);
  });

  it("Modelos no menu: com o Plataforma, para quem configura e vê a conta inteira", () => {
    const menu = (role: "owner" | "editor" | "agent", packs: string[], whole = true) => DAY_TO_DAY.filter((i) => allowed(i, role, packs, whole)).map((i) => i.href);
    expect(menu("owner", ["plataforma"])).toEqual(["/painel/caixa", "/painel/contatos", "/painel/campanhas", "/painel/relatorios", "/painel/clientes", "/painel/modelos"]);
    expect(menu("owner", [])).not.toContain("/painel/modelos");
    expect(menu("editor", ["plataforma"], false)).not.toContain("/painel/modelos");
    expect(menu("agent", ["plataforma"])).not.toContain("/painel/modelos");
  });

  it("Configurações abre o primeiro ajuste permitido", () => {
    expect(firstSettingsHref("owner", [])).toBe("/painel/marca");
    expect(firstSettingsHref("editor", [])).toBe("/painel/demos");
    expect(firstSettingsHref("agent", [])).toBeNull();
  });

  it("acende o ajuste de caminho mais longo", () => {
    expect(activeSettingsHref("/painel/cobranca/uso", "owner", [])).toBe("/painel/cobranca/uso");
    expect(activeSettingsHref("/painel/cobranca", "owner", [])).toBe("/painel/cobranca");
    expect(activeSettingsHref("/painel/cobrancas", "owner", [])).toBeNull();
    expect(activeSettingsHref("/painel/clientes", "owner", [])).toBeNull();
  });
});
