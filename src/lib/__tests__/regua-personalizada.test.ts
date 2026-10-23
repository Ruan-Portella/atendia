import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";
import { byImportance, dateLabelOf, estimateCustomRegua, localDay, monthDaysOf, planReguas } from "../reguas";
import { customReguaProblem, customTemplateBody, customTemplateName, customTemplateProblem, customTiming, dateFieldKey, type CustomRegua } from "../regua-kinds";
import { customDatesOf, mergeCustomDates, setContactCustomDates } from "../contacts";
import { ensureDateField } from "../contact-date-fields";
import { setCipherIdentityForTests, setScopeResolver } from "../field-cipher";

/*
 * Régua personalizada (23/10/2026): a data que dispara (aniversário, última visita, horário
 * marcado ou uma data nova do contato), quantos dias antes ou depois, uma vez ou todo ano, só com
 * a etiqueta, e o modelo com o primeiro nome e a data.
 */

const SP = "America/Sao_Paulo";
const at = (s: string) => Date.parse(s);

const base: CustomRegua = { name: "Renovação do plano", trigger: "data", dateLabel: "Renovação do plano", repeatYearly: false, offsetDays: -10, hoursBefore: null, sendHour: 9, tag: null, category: "UTILITY" };

describe("régua personalizada: o que ela guarda", () => {
  it("a chave da data nova sai do nome, sem acento", () => {
    expect(dateFieldKey("Renovação do plano")).toBe("renovacao_do_plano");
    expect(dateFieldKey("  Vacina do pet!! ")).toBe("vacina_do_pet");
    expect(dateFieldKey("2ª dose")).toBe("data_2a_dose");
    expect(dateFieldKey("?")).toBe("data_nova");
  });

  it("o nome do modelo na Meta não repete", () => {
    expect(customTemplateName("Renovação do plano", [])).toBe("regua_p_renovacao_do_plano");
    expect(customTemplateName("Renovação do plano", ["regua_p_renovacao_do_plano"])).toBe("regua_p_renovacao_do_plano_2");
  });

  it("o texto usa o primeiro nome e a data (e a hora no horário marcado)", () => {
    expect(customTemplateProblem("data", false, customTemplateBody({ trigger: "data", dateLabel: "Renovação do plano", company: "Academia Fit" }))).toBeNull();
    expect(customTemplateProblem("horario", false, customTemplateBody({ trigger: "horario", dateLabel: null, company: "Clínica" }))).toBeNull();
    expect(customTemplateProblem("data", false, "Olá, {{1}}! Seu plano vence logo.")).toContain("2 etiquetas");
    expect(customTemplateProblem("data", false, "{{1}}, seu plano vence em {{2}}")).toContain("começo ou no fim");
  });

  it("confere o nome, o prazo e a hora", () => {
    expect(customReguaProblem(base)).toBeNull();
    expect(customReguaProblem({ ...base, name: "x" })).toContain("nome");
    expect(customReguaProblem({ ...base, dateLabel: null })).toContain("data nova");
    expect(customReguaProblem({ ...base, offsetDays: -400 })).toContain("365 dias");
    expect(customReguaProblem({ ...base, trigger: "ultima_visita", offsetDays: -3 })).toContain("Depois da última visita");
    expect(customReguaProblem({ ...base, trigger: "horario", hoursBefore: 100, offsetDays: null })).toContain("72 horas");
    expect(customReguaProblem({ ...base, sendHour: 21 })).toContain("8h às 19h");
  });

  it("quando sai, numa frase", () => {
    expect(customTiming(base)).toBe("10 dias antes de Renovação do plano, às 9h");
    expect(customTiming({ ...base, trigger: "data", dateLabel: "Vacina do pet", repeatYearly: true, offsetDays: 0 })).toBe("No dia de Vacina do pet (todo ano), às 9h");
    expect(customTiming({ ...base, trigger: "aniversario", offsetDays: -5 })).toBe("5 dias antes do aniversário, às 9h");
    expect(customTiming({ ...base, trigger: "ultima_visita", offsetDays: 30, sendHour: 10 })).toBe("30 dias depois da última visita, às 10h");
    expect(customTiming({ ...base, trigger: "horario", hoursBefore: 2 })).toBe("2 horas antes do horário marcado");
  });

  it("os dias no fuso do cliente", () => {
    // 1h da manhã do dia 21 em UTC ainda é dia 20 em São Paulo
    expect(localDay(at("2026-10-21T01:00:00Z"), SP, 0)).toEqual({ year: 2026, month: 10, day: 20 });
    expect(localDay(at("2026-12-25T12:00:00Z"), SP, 10)).toEqual({ year: 2027, month: 1, day: 4 });
    expect(monthDaysOf({ year: 2027, month: 2, day: 28 })).toEqual(["02-28", "02-29"]);
    expect(monthDaysOf({ year: 2028, month: 2, day: 28 })).toEqual(["02-28"]);
    expect(dateLabelOf("2027-03-10", true)).toBe("10/03/2027");
    expect(dateLabelOf("2027-03-10", false)).toBe("10/03");
  });

  it("a ordem de importância: o lembrete pronto, as personalizadas e as outras", () => {
    const r = (kind: string, created_at = "2026-10-01") => ({ kind, created_at }) as Parameters<typeof byImportance>[0];
    const list = [r("sumido"), r("personalizada", "2026-10-05"), r("aniversario"), r("lembrete"), r("personalizada", "2026-10-02")].sort(byImportance);
    expect(list.map((x) => `${x.kind}${x.kind === "personalizada" ? x.created_at.slice(-2) : ""}`)).toEqual(["lembrete", "personalizada02", "personalizada05", "aniversario", "sumido"]);
  });

  it("as datas novas do contato: só as válidas, e a troca junta com as que já existem", () => {
    expect(customDatesOf({ renovacao: "2027-03-10", Ruim: "2027-01-01", vacina: "10/03", x: 3 })).toEqual({ renovacao: "2027-03-10" });
    expect(customDatesOf(null)).toEqual({});
    expect(mergeCustomDates({ renovacao: "2027-03-10", vacina: "2026-01-01" }, { vacina: null, aniversario_casamento: "2020-05-02" })).toEqual({ aniversario_casamento: "2020-05-02", renovacao: "2027-03-10" });
  });
});

describe("régua personalizada: o planejador", () => {
  const BOT = "aaaaaaaa-0000-4000-8000-0000000000b1";
  const NOW = at("2026-10-20T12:00:00Z"); // terça, 9h em São Paulo
  const H = 3_600_000;
  const D = 24 * H;
  let tables: Record<string, MemRow[]>;
  let db: SupabaseClient;
  const ready = (id: string, kind: string, delay: number | null) => ({ id, agency_id: "ag1", client_id: "cl1", bot_id: BOT, kind, active: true, delay_value: delay, send_hour: 9, planned_at: null, created_at: "2026-09-01T00:00:00Z" });
  const custom = (id: string, o: MemRow) => ({ id, agency_id: "ag1", client_id: "cl1", bot_id: BOT, kind: "personalizada", active: true, delay_value: null, send_hour: 9, planned_at: null, repeat_yearly: false, offset_days: 0, tag: null, category: "UTILITY", date_field_id: null, created_at: "2026-10-01T00:00:00Z", ...o });
  const campaign = (id: string, reguaId: string, category: string) => ({ id, regua_id: reguaId, bot_id: BOT, status: "sending", template_category: category, pause_reason: null });
  const contact = (id: string, o: MemRow) => ({ id, bot_id: BOT, channel: "whatsapp", name: null, phone_enc: `55219999900${id.slice(-2)}`, first_inbound_at: "2026-09-01T12:00:00Z", last_inbound_at: null, birthday: null, last_visit_at: null, appointment_at: null, tags: [], custom_dates: {}, ...o });
  const sends = (campaignId: string) => tables.campaign_sends.filter((s) => s.campaign_id === campaignId);
  const vars = (s: MemRow) => JSON.parse(s.variables_enc as string);

  beforeEach(() => {
    vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16");
    setCipherIdentityForTests(true);
    setScopeResolver({ bot: async () => ({ clientId: null }), conversation: async () => ({ clientId: null }) });
    tables = {
      clients: [{ id: "cl1", timezone: SP, utility_consent_at: "2026-10-01T12:00:00Z" }],
      contact_date_fields: [
        { id: "f1", bot_id: BOT, key: "renovacao_do_plano", label: "Renovação do plano", created_at: "2026-10-01T00:00:00Z" },
        { id: "f2", bot_id: BOT, key: "vacina", label: "Vacina do pet", created_at: "2026-10-01T00:00:01Z" },
      ],
      reguas: [
        ready("r-lemb", "lembrete", 24),
        ready("r-aniv", "aniversario", null),
        custom("r-renov", { name: "Renovação", trigger: "data", date_field_id: "f1", offset_days: -10, created_at: "2026-10-02T00:00:00Z" }),
        custom("r-vacina", { name: "Vacina anual", trigger: "data", date_field_id: "f2", repeat_yearly: true, offset_days: 0, category: "MARKETING", created_at: "2026-10-03T00:00:00Z" }),
        custom("r-aniv5", { name: "Cupom de aniversário", trigger: "aniversario", offset_days: -5, tag: "vip", category: "MARKETING", created_at: "2026-10-04T00:00:00Z" }),
        custom("r-pos30", { name: "Pós-venda 30 dias", trigger: "ultima_visita", offset_days: 30, created_at: "2026-10-05T00:00:00Z" }),
        custom("r-vesp", { name: "Véspera", trigger: "horario", delay_value: 24, offset_days: null, created_at: "2026-10-06T00:00:00Z" }),
      ],
      campaigns: [
        campaign("c-lemb", "r-lemb", "UTILITY"),
        campaign("c-aniv", "r-aniv", "MARKETING"),
        campaign("c-renov", "r-renov", "UTILITY"),
        campaign("c-vacina", "r-vacina", "MARKETING"),
        campaign("c-aniv5", "r-aniv5", "MARKETING"),
        campaign("c-pos30", "r-pos30", "UTILITY"),
        campaign("c-vesp", "r-vesp", "UTILITY"),
      ],
      contacts: [
        // renovação daqui a 10 dias (uma vez); a do dia seguinte fica para amanhã
        contact("ct01", { name: "Ana Lima", custom_dates: { renovacao_do_plano: "2026-10-30" } }),
        contact("ct02", { name: "Bruno", custom_dates: { renovacao_do_plano: "2026-10-31" } }),
        // a vacina de todo ano: vale o dia e o mês de qualquer ano
        contact("ct03", { name: "Carla", custom_dates: { vacina: "2024-10-20" } }),
        // aniversário daqui a 5 dias: só com a etiqueta vip
        contact("ct04", { name: "Davi", birthday: "10-25", tags: ["vip"] }),
        contact("ct05", { name: "Eva", birthday: "10-25", tags: [] }),
        // a última visita faz 30 dias (meio-dia de 20/09 em São Paulo)
        contact("ct06", { name: "Fábio", last_visit_at: "2026-09-20T15:00:00.000Z" }),
        // horário amanhã: a pronta (lembrete) e a personalizada (véspera) acham; só uma régua no dia
        contact("ct07", { name: "Gabi", appointment_at: "2026-10-21T12:30:00.000Z" }),
        // aniversário hoje e renovação daqui a 10 dias: a personalizada vem antes do aniversário pronto
        contact("ct08", { name: "Hugo", birthday: "10-20", custom_dates: { renovacao_do_plano: "2026-10-30" } }),
        // outro chatbot: fora
        contact("ct09", { name: "Iara", bot_id: "outro-bot", custom_dates: { renovacao_do_plano: "2026-10-30" } }),
      ],
      campaign_sends: [],
    };
    db = memoryDb(tables);
  });

  it("põe na fila cada data que vence hoje, com o primeiro nome e a data", async () => {
    await planReguas(db, { hasTime: () => true, now: NOW });
    expect(sends("c-renov").map((s) => s.dedupe_key).sort()).toEqual(["c:r-renov:ct01:2026-10-30", "c:r-renov:ct08:2026-10-30"]);
    expect(vars(sends("c-renov")[0])).toEqual(["Ana", "30/10/2026"]);
    expect(sends("c-renov")[0]).toMatchObject({ send_at: "2026-10-20T12:00:00.000Z", expires_at: "2026-10-20T23:00:00.000Z" });
    expect(sends("c-vacina").map((s) => [s.dedupe_key, vars(s)])).toEqual([["c:r-vacina:ct03:2026", ["Carla", "20/10"]]]);
    expect(sends("c-aniv5").map((s) => [s.dedupe_key, vars(s)])).toEqual([["c:r-aniv5:ct04:2026", ["Davi", "25/10"]]]);
    expect(sends("c-pos30").map((s) => [s.dedupe_key, vars(s)])).toEqual([["c:r-pos30:ct06:2026-09-20T15:00:00.000Z", ["Fábio", "20/09/2026"]]]);
  });

  it("uma régua por pessoa no dia: o lembrete pronto primeiro, depois as personalizadas, depois as outras prontas", async () => {
    await planReguas(db, { hasTime: () => true, now: NOW });
    // o horário da Gabi: o lembrete pronto ganha da véspera personalizada
    expect(sends("c-lemb").map((s) => s.dedupe_key)).toEqual(["l:ct07:2026-10-21T12:30:00.000Z"]);
    expect(sends("c-vesp")).toEqual([]);
    // o Hugo: a renovação (personalizada) ganha do aniversário pronto
    expect(sends("c-aniv")).toEqual([]);
  });

  it("sem o lembrete pronto, o horário marcado da personalizada sai como o lembrete (com a chave que confere o horário)", async () => {
    tables.reguas = tables.reguas.filter((r) => r.id !== "r-lemb");
    await planReguas(db, { hasTime: () => true, now: NOW });
    expect(sends("c-vesp").map((s) => [s.dedupe_key, vars(s)])).toEqual([["l:ct07:2026-10-21T12:30:00.000Z", ["Gabi", "21/10", "09:30"]]]);
    expect(sends("c-vesp")[0]).toMatchObject({ send_at: "2026-10-20T12:30:00.000Z" });
  });

  it("não repete a mesma ocasião nas rodadas seguintes; amanhã vale a data seguinte", async () => {
    await planReguas(db, { hasTime: () => true, now: NOW });
    const first = tables.campaign_sends.length;
    await planReguas(db, { hasTime: () => true, now: NOW + 2 * H });
    expect(tables.campaign_sends).toHaveLength(first);
    await planReguas(db, { hasTime: () => true, now: NOW + D });
    expect(sends("c-renov").map((s) => s.dedupe_key)).toContain("c:r-renov:ct02:2026-10-31");
  });

  it("depois das 20h, nada sai até o dia seguinte", async () => {
    const r = await planReguas(db, { hasTime: () => true, now: at("2026-10-20T23:30:00Z") });
    expect(r.reguas).toBe(7);
    expect(sends("c-renov")).toEqual([]);
  });

  it("a estimativa dos próximos 30 dias, com a etiqueta", async () => {
    const regua = (id: string) => tables.reguas.find((r) => r.id === id) as never;
    expect(await estimateCustomRegua(db, regua("r-renov"), "renovacao_do_plano", SP, NOW)).toBe(3);
    expect(await estimateCustomRegua(db, regua("r-aniv5"), null, SP, NOW)).toBe(1);
    expect(await estimateCustomRegua(db, regua("r-vacina"), "vacina", SP, NOW)).toBe(1);
  });

  it("a data nova do chatbot é criada uma vez, e a do contato junta com as outras", async () => {
    const f = await ensureDateField(db, BOT, "  Aniversário de casamento ");
    expect(f).toMatchObject({ key: "aniversario_de_casamento", label: "Aniversário de casamento" });
    expect((await ensureDateField(db, BOT, "Aniversário de casamento")).id).toBe(f.id);
    expect(await setContactCustomDates(db, ["ct01"], [BOT], { aniversario_de_casamento: "2015-06-12" })).toEqual(["ct01"]);
    expect(tables.contacts[0].custom_dates).toEqual({ aniversario_de_casamento: "2015-06-12", renovacao_do_plano: "2026-10-30" });
    // nada muda: não grava de novo; outro chatbot: não mexe
    expect(await setContactCustomDates(db, ["ct01"], [BOT], { aniversario_de_casamento: "2015-06-12" })).toEqual([]);
    expect(await setContactCustomDates(db, ["ct01"], ["outro-bot"], { renovacao_do_plano: null })).toEqual([]);
  });
});
