import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";
import { REGUA_CATEGORY, REGUA_KINDS, reguaTemplateBody, reguaTemplateName, reguaTemplateProblem, reguaTemplateState } from "../regua-kinds";
import type { Template } from "../template-text";

/*
 * Réguas, partes 3 e 4: o modelo pronto de cada régua (o texto sugerido, as regras da Meta, as
 * variáveis, o portão, o nome novo a cada texto novo e o estado na Meta) e o painel (criar a régua
 * desligada, o prazo e a hora, ligar só com o modelo aprovado, desligar). A Meta é simulada.
 */

const meta = vi.hoisted(() => ({ templates: [] as Template[], created: [] as Array<{ name: string; category: string; body: string; examples: string[] }> }));
vi.mock("../whatsapp-templates", async (orig) => ({
  ...(await orig<typeof import("../whatsapp-templates")>()),
  listTemplates: vi.fn(async () => meta.templates),
  createTemplate: vi.fn(async (_ch: unknown, t: { name: string; category: string; body: string; examples: string[] }) => {
    meta.created.push(t);
    return { id: "t1", status: "PENDING" };
  }),
}));

import { ensureRegua, estimateRegua, saveReguaSettings, setReguaActive, submitReguaTemplate } from "../reguas";

const BOT = "aaaaaaaa-0000-4000-8000-0000000000b1";
const bot = { id: BOT, agency_id: "ag1", client_id: "cl1" };
const ch = { bot_id: BOT, phone_number_id: "pn1", waba_id: "waba1", access_token_enc: "selado" } as never;
const template = (name: string, status: string, category: string, text: string): Template => ({ id: name, name, status, category, language: "pt_BR", components: [{ type: "BODY", text }] });

describe("o modelo pronto de cada régua", () => {
  it("o texto sugerido passa nas regras da Meta e usa as variáveis certas", () => {
    for (const kind of REGUA_KINDS) expect(reguaTemplateProblem(kind, reguaTemplateBody(kind, "Loja da Ana")), kind).toBeNull();
    expect(reguaTemplateBody("lembrete", "Loja da Ana")).toContain("equipe de Loja da Ana");
    // o nome do negócio não leva marcação nem chaves
    expect(reguaTemplateBody("aniversario", "*Loja* {da} Ana")).toContain("equipe de Loja da Ana");
  });

  it("o texto editado: variáveis que o planejador manda, nada no começo ou no fim", () => {
    expect(reguaTemplateProblem("lembrete", "Olá, {{1}}! Seu horário é amanhã.")).toContain("3 variáveis");
    expect(reguaTemplateProblem("aniversario", "{{1}}, feliz aniversário!")).toContain("começo ou no fim");
    expect(reguaTemplateProblem("aniversario", "Feliz aniversário, {{2}}!")).toContain("em ordem");
  });

  it("o nome: regua_<tipo>, e um número novo a cada texto novo", () => {
    expect(reguaTemplateName("aniversario", [])).toBe("regua_aniversario");
    expect(reguaTemplateName("aniversario", ["regua_aniversario", "regua_aniversario_2"])).toBe("regua_aniversario_3");
  });

  it("o estado na Meta, e a utilidade que virou marketing", () => {
    const list = [template("regua_lembrete", "APPROVED", "MARKETING", "Olá, {{1}}! A equipe lembra: {{2}}, às {{3}}. Responda para remarcar."), template("regua_sumido", "REJECTED", "MARKETING", "x")];
    expect(reguaTemplateState("lembrete", list, "regua_lembrete")).toMatchObject({ status: "aprovado", category: "MARKETING", reclassified: true });
    expect(reguaTemplateState("sumido", list, "regua_sumido")).toMatchObject({ status: "recusado", reclassified: false });
    expect(reguaTemplateState("aniversario", list, null)).toMatchObject({ status: "ausente", label: "sem modelo" });
    expect(REGUA_CATEGORY.lembrete).toBe("UTILITY");
  });
});

describe("o painel das réguas", () => {
  let tables: Record<string, MemRow[]>;
  let db: SupabaseClient;

  beforeEach(() => {
    meta.templates = [];
    meta.created = [];
    tables = { reguas: [], campaigns: [], contacts: [] };
    db = memoryDb(tables);
  });

  it("a régua nasce desligada, com o prazo padrão, uma vez só", async () => {
    const r = await ensureRegua(db, bot, "sumido", "ana@loja.com");
    expect(r).toMatchObject({ kind: "sumido", active: false, delay_value: 30, send_hour: 9 });
    await ensureRegua(db, bot, "sumido", "ana@loja.com");
    expect(tables.reguas).toHaveLength(1);
  });

  it("o modelo vai para a Meta com a categoria da régua e fica guardado; item proibido ou só para maiores não vai", async () => {
    const r = await ensureRegua(db, bot, "lembrete", null);
    meta.templates = [template("regua_lembrete", "REJECTED", "UTILITY", "x")];
    const body = reguaTemplateBody("lembrete", "Loja da Ana");
    expect(await submitReguaTemplate(db, { regua: r, ch, body })).toEqual({ ok: true, name: "regua_lembrete_2" });
    expect(meta.created[0]).toMatchObject({ name: "regua_lembrete_2", category: "UTILITY", body, examples: ["Ana", "20/12", "14:30"] });
    expect(tables.reguas[0].template_name).toBe("regua_lembrete_2");
    expect(await submitReguaTemplate(db, { regua: r, ch, body: "Oi, {{1}}! Cigarro eletrônico com desconto: {{2}}, às {{3}}, na loja." })).toMatchObject({ ok: false, message: expect.stringContaining("não pode ser oferecido") });
    const a = await ensureRegua(db, bot, "aniversario", null);
    expect(await submitReguaTemplate(db, { regua: a, ch, body: "Feliz aniversário, {{1}}! Hoje tem chopp em dobro para você." })).toMatchObject({ ok: false, message: expect.stringContaining("idade") });
    expect(meta.created).toHaveLength(1);
  });

  it("o prazo e a hora dentro dos limites", async () => {
    const r = await ensureRegua(db, bot, "lembrete", null);
    expect(await saveReguaSettings(db, r, { delay: 100, sendHour: null })).toBe("O prazo vai de 1 a 72 horas.");
    expect(await saveReguaSettings(db, r, { delay: 2, sendHour: null })).toBeNull();
    expect(tables.reguas[0].delay_value).toBe(2);
    const s = await ensureRegua(db, bot, "sem_resposta", null);
    expect(await saveReguaSettings(db, s, { delay: 3, sendHour: 21 })).toBe("A hora do envio vai das 8h às 19h.");
  });

  it("liga só com o modelo aprovado; ligada, a campanha da régua envia; desligada, para", async () => {
    let r = await ensureRegua(db, bot, "aniversario", null);
    expect(await setReguaActive(db, { regua: r, on: true, ch, by: null })).toBe("Crie o modelo da régua antes de ligar.");
    tables.reguas[0].template_name = "regua_aniversario";
    meta.templates = [template("regua_aniversario", "PENDING", "MARKETING", "x")];
    r = await ensureRegua(db, bot, "aniversario", null);
    expect(await setReguaActive(db, { regua: r, on: true, ch, by: null })).toContain("ainda não está aprovado");
    meta.templates = [template("regua_aniversario", "APPROVED", "MARKETING", "x")];
    expect(await setReguaActive(db, { regua: r, on: true, ch, by: "ana@loja.com" })).toBeNull();
    expect(tables.reguas[0]).toMatchObject({ active: true, planned_at: null });
    expect(tables.campaigns[0]).toMatchObject({ regua_id: r.id, status: "sending", kind: "marketing", template_name: "regua_aniversario", template_category: "MARKETING", name: "Régua Aniversário" });
    expect(await setReguaActive(db, { regua: r, on: false, ch, by: null })).toBeNull();
    expect(tables.reguas[0].active).toBe(false);
    expect(tables.campaigns[0].status).toBe("paused");
    // ligar de novo usa a mesma campanha
    await setReguaActive(db, { regua: r, on: true, ch, by: null });
    expect(tables.campaigns).toHaveLength(1);
    expect(tables.campaigns[0].status).toBe("sending");
  });

  it("a estimativa do aniversário: quem faz anos nos próximos 30 dias", async () => {
    tables.contacts.push(
      { id: "c1", bot_id: BOT, channel: "whatsapp", phone_enc: "5521999990001", birthday: "10-25" },
      { id: "c2", bot_id: BOT, channel: "whatsapp", phone_enc: "5521999990002", birthday: "12-25" },
      { id: "c3", bot_id: BOT, channel: "whatsapp", phone_enc: null, birthday: "10-26" },
    );
    expect(await estimateRegua(db, BOT, "aniversario", null, "America/Sao_Paulo", Date.parse("2026-10-20T15:00:00Z"))).toBe(1);
  });
});
