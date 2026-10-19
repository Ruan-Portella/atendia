import { describe, expect, it } from "vitest";
import { groupHelp, helpArticles, helpBlocks, helpSummary, parseHelpGuide } from "../help-center";
import { clientGuide } from "../client-guide";

describe("central de ajuda", () => {
  it("lê parágrafos e listas do guia", () => {
    expect(helpBlocks("Um texto\nem duas linhas.\n\n- um\n- dois\n\n1. primeiro\n2. segundo")).toEqual([
      { kind: "p", text: "Um texto em duas linhas." },
      { kind: "ul", items: ["um", "dois"] },
      { kind: "ol", items: ["primeiro", "segundo"] },
    ]);
  });

  it("cada seção vira uma página com endereço próprio; a do próprio assistente fica de fora", () => {
    const pages = parseHelpGuide("# Guia\n\nIntro\n\n## Conta grátis\n\nTexto.\n\n## Sobre este assistente\n\nNão vira página.");
    expect(pages.map((p) => [p.slug, p.title])).toEqual([["conta-gratis", "Conta grátis"]]);
  });

  it("o guia de verdade: toda seção cai num grupo (nada sobra em Mais) e os endereços não se repetem", () => {
    const articles = helpArticles();
    expect(articles.length).toBeGreaterThan(30);
    const groups = groupHelp(articles);
    expect(groups.map((g) => g.title)).not.toContain("Mais");
    expect(groups.flatMap((g) => g.articles).length).toBe(articles.length);
    expect(new Set(articles.map((a) => a.slug)).size).toBe(articles.length);
    expect(articles.find((a) => a.title === "Problemas comuns na conexão")?.blocks[0]).toMatchObject({ kind: "ul" });
  });

  it("o resumo corta na palavra", () => {
    expect(helpSummary({ plain: "curto" })).toBe("curto");
    expect(helpSummary({ plain: "a ".repeat(100) }, 20).endsWith("…")).toBe(true);
  });
});

describe("guias do cliente no portal", () => {
  const names = { agency: "Norte Marketing", client: "Clínica Sorriso" };

  it("o gestor vê o que a agência liberou; o atendente, as conversas e o perfil", () => {
    const all = clientGuide({ manager: true, handoff: true, knowledge: true, hours: true }, names).map((s) => s.id);
    expect(all).toEqual(["entrar", "relatorio", "atendimento", "ensinar", "horario", "equipe", "canais", "privacidade", "perfil"]);
    expect(clientGuide({ manager: true, handoff: false, knowledge: false, hours: false }, names).map((s) => s.id)).toEqual(["entrar", "relatorio", "conversas", "equipe", "canais", "privacidade", "perfil"]);
    expect(clientGuide({ manager: false, handoff: true, knowledge: true, hours: true }, names).map((s) => s.id)).toEqual(["entrar", "atendimento", "perfil"]);
  });

  it("nunca cita a plataforma: só a agência e o negócio", () => {
    const text = JSON.stringify(clientGuide({ manager: true, handoff: true, knowledge: true, hours: true }, names));
    expect(text).not.toMatch(/boavoz/i);
    expect(text).toContain("Norte Marketing");
    expect(text).toContain("Clínica Sorriso");
  });
});
