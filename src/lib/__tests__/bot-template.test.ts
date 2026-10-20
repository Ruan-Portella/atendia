import { describe, expect, it } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { applyTemplate, asBotAction, configBotId, createDerivedBot, derivedColumns, derivedPatch, searchBots, setDerivedOverride, setTemplateUnlocked, type DerivedRow, type TemplateRow } from "../bot-template";
import type { ActionRow } from "../actions";

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T = "11111111-1111-4111-8111-111111111111";
const D = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";

const template = (over: Partial<TemplateRow> = {}): TemplateRow => ({
  id: T,
  name: "Duda",
  persona: { tone: "simpático", instructions: "Fale do cardápio do dia.", welcome: "Olá! Sou {assistente}, da {empresa}." },
  appearance: { color: "#c0392b", suggested_questions: ["Qual o cardápio?"] },
  human_handoff: { entry_notice: "Oi, sou {atendente}, da equipe." },
  business_topics: "delivery de comida",
  template_unlocked: ["nome", "saudacao", "aparencia", "anuncio", "instrucoes", "base"],
  ...over,
});
const derived = (over: Partial<DerivedRow> = {}): DerivedRow => ({
  id: D,
  name: "Duda",
  client_name: "Pizzaria do Zé",
  own_base: true,
  persona: {},
  appearance: {},
  human_handoff: { widget_button: true, hours: { mon: ["18:00", "23:00"] } },
  business_topics: null,
  overrides: {},
  extra_instructions: null,
  ...over,
});

describe("bot modelo: a herança", () => {
  it("o derivado recebe o modelo, com {empresa} e {assistente} na saudação e as iniciais dele no avatar", () => {
    const c = derivedColumns(template(), derived());
    expect(c.name).toBe("Duda");
    expect(c.persona).toEqual({ tone: "simpático", instructions: "Fale do cardápio do dia.", welcome: "Olá! Sou Duda, da Pizzaria do Zé." });
    expect(c.appearance).toMatchObject({ color: "#c0392b", avatar_text: "PD" });
    // o horário e os outros contatos são do derivado; o anúncio vem do modelo
    expect(c.human_handoff).toEqual({ widget_button: true, hours: { mon: ["18:00", "23:00"] }, entry_notice: "Oi, sou {atendente}, da equipe." });
    expect(c.business_topics).toBe("delivery de comida");
    expect(c.own_base).toBe(true);
  });

  it("valor próprio vale só no campo liberado; travado, volta ao modelo e o valor fica guardado", () => {
    const d = derived({ overrides: { nome: "Zé Bot", saudacao: "E aí! Bora pedir?" }, extra_instructions: "Aos domingos, rodízio." });
    const open = derivedColumns(template(), d);
    expect(open.name).toBe("Zé Bot");
    expect(open.persona.welcome).toBe("E aí! Bora pedir?");
    expect(open.persona.instructions).toBe("Fale do cardápio do dia.\n\nAos domingos, rodízio.");
    const locked = derivedColumns(template({ template_unlocked: ["anuncio"] }), d);
    expect(locked.name).toBe("Duda");
    expect(locked.persona.welcome).toBe("Olá! Sou Duda, da Pizzaria do Zé.");
    expect(locked.persona.instructions).toBe("Fale do cardápio do dia.");
    expect(locked.own_base).toBe(false);
    expect(d.overrides).toEqual({ nome: "Zé Bot", saudacao: "E aí! Bora pedir?" });
  });

  it("as ações, os roteiros e a base do derivado vêm do modelo", () => {
    expect(configBotId({ id: D, template_id: T })).toBe(T);
    expect(configBotId({ id: D })).toBe(D);
    expect(searchBots({ id: D, template_id: T, own_base: true })).toEqual({ botId: D, alsoBotId: T });
    expect(searchBots({ id: D, template_id: T, own_base: false })).toEqual({ botId: T, alsoBotId: null });
    expect(searchBots({ id: D })).toEqual({ botId: D, alsoBotId: null });
    const action = { id: "act1", bot_id: T, name: "buscar_cardapio" } as ActionRow;
    expect(asBotAction(action, { id: D, template_id: T })).toMatchObject({ bot_id: D, signing_bot_id: T, name: "buscar_cardapio" });
    expect(asBotAction(action, { id: T })).toBe(action);
    expect(asBotAction(action, { id: D })).toBeNull();
  });

  it("criar o derivado, travar um campo e guardar ou desfazer o valor próprio propagam na hora", async () => {
    const t: Record<string, MemRow[]> = { bots: [{ ...template(), agency_id: AGENCY, is_template: true }] };
    const db = memoryDb(t);
    const id = await createDerivedBot(db, { agencyId: AGENCY, templateId: T, client: { id: CLIENT, name: "Pizzaria do Zé", site: null }, fixedContext: { loja_id: "42" } });
    const row = () => t.bots.find((b) => b.id === id)!;
    expect(row()).toMatchObject({ template_id: T, client_id: CLIENT, fixed_context: { loja_id: "42" }, name: "Duda" });
    expect((row().persona as { welcome: string }).welcome).toBe("Olá! Sou Duda, da Pizzaria do Zé.");

    await setDerivedOverride(db, { id, template_id: T, overrides: (row().overrides as Record<string, unknown>) ?? {} }, "nome", "Zé Bot");
    expect(row().name).toBe("Zé Bot");
    // o modelo muda: o nome próprio fica, a saudação acompanha
    t.bots[0].persona = { ...(t.bots[0].persona as object), welcome: "Bem-vindo à {empresa}!" };
    expect(await applyTemplate(db, T)).toBe(1);
    expect(row()).toMatchObject({ name: "Zé Bot", persona: { welcome: "Bem-vindo à Pizzaria do Zé!" } });
    // travar o nome: volta ao do modelo; liberar de novo: o próprio volta
    await setTemplateUnlocked(db, T, ["saudacao"]);
    expect(row().name).toBe("Duda");
    await setTemplateUnlocked(db, T, ["nome", "saudacao"]);
    expect(row().name).toBe("Zé Bot");
    // desfazer: segue o modelo
    await setDerivedOverride(db, { id, template_id: T, overrides: row().overrides as Record<string, unknown> }, "nome", undefined);
    expect(row()).toMatchObject({ name: "Duda", overrides: {} });
  });

  it("salvar a aba do derivado: só o que mudou vira valor próprio; o travado e o que vem do modelo saem", () => {
    const current = { name: "Duda", welcome: "Olá! Sou Duda, da Pizzaria do Zé.", appearance: { color: "#c0392b", avatar_text: "PD", suggested_questions: [], position: "right", offset: 20 }, entryNotice: null, overrides: {} };
    // nada mudou (só o site): nada vira próprio
    expect(derivedPatch({ name: "Duda", client_site: "zepizza.com.br" }, { welcome: "Olá! Sou Duda, da Pizzaria do Zé." }, ["nome", "saudacao"], current)).toEqual({ client_site: "zepizza.com.br", overrides: {} });
    // mudou o nome e a saudação; o tom e os assuntos do modelo saem do patch
    const changed = derivedPatch({ name: "Zé Bot", persona: { tone: "sério" }, business_topics: "x" }, { welcome: "E aí!", extra_instructions: " Aos domingos, rodízio. " }, ["nome", "saudacao", "instrucoes"], current);
    expect(changed).toEqual({ overrides: { nome: "Zé Bot", saudacao: "E aí!" }, extra_instructions: "Aos domingos, rodízio." });
    // travado: ignorado
    expect(derivedPatch({ name: "Zé Bot" }, {}, ["saudacao"], current)).toEqual({ overrides: {} });
    // aparência igual não vira própria; o anúncio sai do atendimento (a propagação grava) e o resto fica
    expect(derivedPatch({ appearance: { ...current.appearance }, human_handoff: { entry_notice: null, hours: { mon: ["9:00", "18:00"] } } }, { handoff: "1" }, ["aparencia", "anuncio"], current)).toEqual({
      human_handoff: { hours: { mon: ["9:00", "18:00"] } },
      overrides: {},
    });
    // já próprio: o valor novo substitui, mesmo igual ao atual
    expect(derivedPatch({ name: "Zé Bot" }, {}, ["nome"], { ...current, name: "Zé Bot", overrides: { nome: "Zé Bot" } })).toEqual({ overrides: { nome: "Zé Bot" } });
  });
});
