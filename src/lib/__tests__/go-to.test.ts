import { describe, expect, it } from "vitest";
import { buildGroups, fold, matches, staticGroups, type GoToItem } from "@/lib/go-to";

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
    expect(groups.find((g) => g.title === "Ajustes")?.items.map((i) => i.href)).toEqual(["/painel/integracoes"]);
    const theme = buildGroups({ query: "tema claro", role: "agent", packs: [], clients: [], remote: [] });
    expect(theme.find((g) => g.title === "Ações")?.items.map((i) => i.run)).toEqual(["tema-claro"]);
  });
});
