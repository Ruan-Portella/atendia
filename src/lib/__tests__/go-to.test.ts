import { describe, expect, it } from "vitest";
import { BOT_TABS, buildGroups, fold, innerTabs, matches, staticGroups, type GoToItem } from "@/lib/go-to";

const clients: GoToItem[] = [
  { id: "c1", kind: "client", title: "Bar do Zé", href: "/painel/clientes/c1" },
  { id: "c2", kind: "client", title: "Clínica Vale Verde", href: "/painel/clientes/c2" },
];

describe("Ir para", () => {
  it("acha sem acento e por palavra", () => {
    expect(fold("Configurações")).toBe("configuracoes");
    expect(matches({ title: "Clínica Vale Verde" }, "clinica verde")).toBe(true);
    expect(matches({ title: "Clínica Vale Verde" }, "clinica azul")).toBe(false);
    expect(matches({ title: "Ações, webhooks e API", keywords: "chave api" }, "chave")).toBe(true);
  });

  it("cada papel vê só o que pode abrir", () => {
    const agent = staticGroups("agent", []);
    expect(agent.pages.map((p) => p.href)).toEqual(["/painel/caixa", "/painel/clientes"]);
    expect(agent.settings.map((s) => s.href)).toEqual(["/painel/perfil", "/painel/roadmap", "/ajuda"]);
    expect(agent.actions.some((a) => a.id === "novo-cliente")).toBe(false);
    const owner = staticGroups("owner", ["plataforma"]);
    expect(owner.settings.some((s) => s.href === "/painel/cobranca/credito")).toBe(true);
    expect(owner.actions.map((a) => a.id)).toContain("convidar");
  });

  it("sem busca mostra as telas, os primeiros clientes e as ações de criar", () => {
    const groups = buildGroups({ query: "", role: "owner", packs: [], clients, remote: [] });
    expect(groups.map((g) => g.title)).toEqual(["Ir para", "Clientes", "Ações"]);
    expect(groups[2].items.every((i) => !i.run)).toBe(true);
  });

  it("com busca: contatos e conversas primeiro, clientes sem repetir", () => {
    const remote = [
      { title: "Contatos", items: [{ id: "k1", kind: "contact" as const, title: "Ana Souza" }] },
      { title: "Clientes", items: [{ id: "c2", kind: "client" as const, title: "Clínica Vale Verde" }, { id: "c9", kind: "client" as const, title: "Clínica Nova" }] },
    ];
    const groups = buildGroups({ query: "clinica", role: "owner", packs: [], clients, remote });
    expect(groups[0].title).toBe("Contatos");
    expect(groups.find((g) => g.title === "Clientes")?.items.map((i) => i.id)).toEqual(["c2", "c9"]);
  });

  it("ajuste pelo nome que a pessoa lembra", () => {
    const groups = buildGroups({ query: "webhook", role: "owner", packs: [], clients, remote: [] });
    expect(groups.find((g) => g.title === "Ajustes")?.items.map((i) => i.href).slice(0, 2)).toEqual(["/painel/integracoes", "/painel/integracoes?aba=webhooks"]);
    const theme = buildGroups({ query: "tema claro", role: "agent", packs: [], clients: [], remote: [] });
    expect(theme.find((g) => g.title === "Ações")?.items.map((i) => i.run)).toEqual(["tema-claro"]);
  });

  it("as abas de dentro dos ajustes, com a mesma permissão da tela", () => {
    const owner = buildGroups({ query: "auditoria", role: "owner", packs: [], clients, remote: [] });
    expect(owner.find((g) => g.title === "Ajustes")?.items.map((i) => i.href)).toContain("/painel/seguranca?aba=auditoria");
    const agent = buildGroups({ query: "auditoria", role: "agent", packs: [], clients: [], remote: [] });
    expect(agent.find((g) => g.title === "Ajustes")).toBeUndefined();
    const leads = buildGroups({ query: "leads", role: "owner", packs: [], clients, remote: [] });
    expect(leads.find((g) => g.title === "Ajustes")?.items.map((i) => i.href)).toContain("/painel/contatos?aba=leads");
  });

  it("\"sorriso roteiros\" leva à aba do chatbot; só o nome não traz as abas", () => {
    const bot: GoToItem = { id: "bot-b1", kind: "bot", title: "Sofia", sub: "Clínica Sorriso · no ar", href: "/painel/bots/b1" };
    const remote = [{ title: "Chatbots", items: [bot] }];
    const groups = buildGroups({ query: "sorriso roteiros", role: "owner", packs: [], clients: [], remote });
    expect(groups.find((g) => g.title === "Abas")?.items.map((i) => [i.title, i.sub, i.href])).toEqual([["Roteiros", "Sofia", "/painel/bots/b1?tab=roteiros"]]);
    expect(groups.find((g) => g.title === "Chatbots")).toBeUndefined();
    const plain = buildGroups({ query: "sofia", role: "owner", packs: [], clients: [], remote });
    expect(plain.find((g) => g.title === "Abas")).toBeUndefined();
    expect(plain.find((g) => g.title === "Chatbots")?.items).toHaveLength(1);
    expect(innerTabs([bot], BOT_TABS, "sofia perguntas sugeridas").map((i) => i.href)).toEqual(["/painel/bots/b1?tab=aparencia"]);
  });

  it("as abas do cliente: \"sorriso setores\"", () => {
    const groups = buildGroups({ query: "sorriso setores", role: "owner", packs: [], clients: [{ id: "c1", kind: "client", title: "Clínica Sorriso", sub: "Cliente", href: "/painel/clientes/c1" }], remote: [] });
    expect(groups.find((g) => g.title === "Abas")?.items.map((i) => i.href)).toEqual(["/painel/clientes/c1?tab=setores"]);
  });
});
