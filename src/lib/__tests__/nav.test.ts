import { describe, expect, it } from "vitest";
import { activeSettingsHref, firstSettingsHref, settingsFor } from "@/lib/nav";

describe("mapa do painel", () => {
  it("cada papel vê só os ajustes que pode abrir", () => {
    expect(settingsFor("owner", []).map((g) => g.group)).toEqual(["Conta", "Cobrança", "Integrações", "Biblioteca"]);
    // modelos só com o Plataforma
    expect(settingsFor("owner", []).find((g) => g.group === "Biblioteca")?.items.map((i) => i.href)).toEqual(["/painel/demos"]);
    expect(settingsFor("owner", ["plataforma"]).find((g) => g.group === "Biblioteca")?.items.map((i) => i.href)).toEqual(["/painel/modelos", "/painel/demos"]);
    // administrador: tudo menos cobrança
    expect(settingsFor("admin", []).map((g) => g.group)).toEqual(["Conta", "Integrações", "Biblioteca"]);
    // editor: só a biblioteca; atendente: nada
    expect(settingsFor("editor", []).map((g) => g.group)).toEqual(["Biblioteca"]);
    expect(settingsFor("agent", [])).toEqual([]);
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
