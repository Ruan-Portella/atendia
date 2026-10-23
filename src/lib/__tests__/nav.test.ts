import { describe, expect, it } from "vitest";
import { DAY_TO_DAY, activeSettingsHref, allowed, firstSettingsHref, settingsFor } from "@/lib/nav";

describe("mapa do painel", () => {
  it("cada papel vê só os ajustes que pode abrir", () => {
    expect(settingsFor("owner", []).map((g) => g.group)).toEqual(["Conta", "Cobrança", "Integrações"]);
    // os modelos e as demos saíram das Configurações (foram para o menu)
    expect(settingsFor("owner", ["plataforma"]).flatMap((g) => g.items.map((i) => i.href))).not.toContain("/painel/demos");
    // administrador: tudo menos cobrança
    expect(settingsFor("admin", []).map((g) => g.group)).toEqual(["Conta", "Integrações"]);
    // editor: só a biblioteca; atendente: nada
    expect(settingsFor("editor", [])).toEqual([]);
    expect(settingsFor("agent", [])).toEqual([]);
  });

  it("Modelos no menu: com o Plataforma, para quem configura e vê a conta inteira", () => {
    const menu = (role: "owner" | "editor" | "agent", packs: string[], whole = true) => DAY_TO_DAY.filter((i) => allowed(i, role, packs, whole)).map((i) => i.href);
    expect(menu("owner", ["plataforma"])).toEqual(["/painel/caixa", "/painel/contatos", "/painel/campanhas", "/painel/relatorios", "/painel/clientes", "/painel/modelos", "/painel/demos"]);
    // as demos: quem configura, com ou sem o pacote
    expect(menu("editor", [], false)).toContain("/painel/demos");
    expect(menu("agent", [])).not.toContain("/painel/demos");
    expect(menu("owner", [])).not.toContain("/painel/modelos");
    expect(menu("editor", ["plataforma"], false)).not.toContain("/painel/modelos");
    expect(menu("agent", ["plataforma"])).not.toContain("/painel/modelos");
  });

  it("Configurações abre o primeiro ajuste permitido", () => {
    expect(firstSettingsHref("owner", [])).toBe("/painel/marca");
    // o editor não tem ajustes da conta (as demos foram para o menu)
    expect(firstSettingsHref("editor", [])).toBeNull();
    expect(firstSettingsHref("agent", [])).toBeNull();
  });

  it("acende o ajuste de caminho mais longo", () => {
    expect(activeSettingsHref("/painel/cobranca/uso", "owner", [])).toBe("/painel/cobranca/uso");
    expect(activeSettingsHref("/painel/cobranca", "owner", [])).toBe("/painel/cobranca");
    expect(activeSettingsHref("/painel/cobrancas", "owner", [])).toBeNull();
    expect(activeSettingsHref("/painel/clientes", "owner", [])).toBeNull();
  });
});
