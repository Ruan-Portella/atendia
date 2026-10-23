import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";
import { appointmentFromSheet, birthdayFromSheet, birthdayLabel, contactDatesFromForm, validateImportRows, type RawImportRow } from "../contact-import";
import { birthdayFromApi, contactApiObject, parseContactDatesBody } from "../api-contacts";
import { importWhatsAppContacts, importedDatesPatch, phoneHash, setContactDates, type ApiContactRow } from "../contacts";
import { ApiError } from "../api-v1";
import { isoToLocalInput } from "../timezone";
import { setCipherIdentityForTests, setScopeResolver } from "../field-cipher";

/*
 * As datas das réguas no contato (leva Réguas, parte 1): o aniversário (só o dia e o mês), a
 * última visita ou compra e o próximo horário marcado, pela planilha (o horário no fuso do
 * cliente), pela ficha do painel e pela API (PATCH /v1/contacts/{contact}).
 */

const NOW = Date.parse("2026-10-20T15:00:00Z");
const today = new Date(NOW);
const row = (o: Partial<RawImportRow>): RawImportRow => ({ line: 2, phone: "21999990000", name: "", tags: "", consentOrigin: "", consentDate: "", consentText: "", age: "", ageOrigin: "", birth: "", birthday: "", lastVisit: "", appointment: "", ...o });
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("não lançou");
};

describe("as datas na planilha", () => {
  it("aniversário: dd/mm, com ano ou aaaa-mm-dd, sempre sem o ano; 29/02 vale", () => {
    expect(birthdayFromSheet("21/10")).toBe("10-21");
    expect(birthdayFromSheet("1/5")).toBe("05-01");
    expect(birthdayFromSheet("21/10/1990")).toBe("10-21");
    expect(birthdayFromSheet("1990-10-21")).toBe("10-21");
    expect(birthdayFromSheet("29/02")).toBe("02-29");
    expect(birthdayFromSheet("31/04")).toBeNull();
    expect(birthdayFromSheet("ontem")).toBeNull();
    expect(birthdayLabel("10-21")).toBe("21/10");
  });

  it("horário marcado no fuso do cliente, nos formatos da planilha e dos sistemas", () => {
    expect(appointmentFromSheet("20/12/2026 14:30", "America/Sao_Paulo")).toBe("2026-12-20T17:30:00.000Z");
    expect(appointmentFromSheet("20/12/2026 14:30", "America/Manaus")).toBe("2026-12-20T18:30:00.000Z");
    expect(appointmentFromSheet("20/12/2026 às 14h30", "America/Sao_Paulo")).toBe("2026-12-20T17:30:00.000Z");
    expect(appointmentFromSheet("2026-12-20T14:30:00", "America/Sao_Paulo")).toBe("2026-12-20T17:30:00.000Z");
    expect(appointmentFromSheet("20/12/2026 9h", "America/Sao_Paulo")).toBe("2026-12-20T12:00:00.000Z");
    expect(appointmentFromSheet("20/12/2026", "America/Sao_Paulo")).toBeNull();
    expect(appointmentFromSheet("amanhã cedo", "America/Sao_Paulo")).toBeNull();
  });

  it("a linha com as datas; o nascimento sem a origem só dá o aniversário", () => {
    const v = validateImportRows(
      [
        row({ line: 2, phone: "21999990001", birthday: "21/10", lastVisit: "05/10/2026", appointment: "20/12/2026 14:30" }),
        row({ line: 3, phone: "21999990002", birth: "15/03/1988" }),
        row({ line: 4, phone: "21999990003", birth: "15/03/1988", ageOrigin: "documento" }),
      ],
      today,
      "America/Sao_Paulo",
    );
    expect(v.errors).toEqual([]);
    expect(v.valid[0]).toMatchObject({ birthday: "10-21", lastVisitAt: "2026-10-05T15:00:00.000Z", appointmentAt: "2026-12-20T17:30:00.000Z" });
    expect(v.valid[1]).toMatchObject({ birthday: "03-15", age: null });
    expect(v.valid[2]).toMatchObject({ birthday: "03-15", age: { adult: true, origin: "documento" } });
    // o ano do nascimento não sai da conferência
    expect(JSON.stringify(v.valid)).not.toContain("1988");
  });

  it("datas com problema ficam de fora, com o motivo", () => {
    const v = validateImportRows(
      [
        row({ line: 2, phone: "21999990001", birthday: "31/02" }),
        row({ line: 3, phone: "21999990002", lastVisit: "30/10/2026" }),
        row({ line: 4, phone: "21999990003", appointment: "19/10/2026 10:00" }),
        row({ line: 5, phone: "21999990004", appointment: "20/12/2027 10:00" }),
        row({ line: 6, phone: "21999990005", appointment: "20/12" }),
        row({ line: 7, phone: "21999990006", birth: "ontem" }),
      ],
      today,
    );
    expect(v.valid).toEqual([]);
    expect(v.errors.map((e) => e.reason)).toEqual([
      "aniversário inválido (use dd/mm, ex.: 21/10)",
      "última visita no futuro",
      "horário marcado já passou",
      "horário marcado para mais de um ano à frente",
      "horário marcado inválido (use dd/mm/aaaa hh:mm, ex.: 21/10/2026 14:30)",
      "data de nascimento inválida (use dd/mm/aaaa)",
    ]);
  });
});

describe("as datas na ficha do painel", () => {
  it("dia e mês, a data da visita e o horário no fuso do cliente; vazio apaga", () => {
    expect(contactDatesFromForm({ birthday: "21/10", lastVisit: "2026-10-05", appointment: "2026-12-20T14:30" }, "America/Sao_Paulo", NOW)).toEqual({ birthday: "10-21", last_visit_at: "2026-10-05T15:00:00.000Z", appointment_at: "2026-12-20T17:30:00.000Z" });
    expect(contactDatesFromForm({ birthday: "", lastVisit: "", appointment: "" }, "America/Sao_Paulo", NOW)).toEqual({ birthday: null, last_visit_at: null, appointment_at: null });
    expect(contactDatesFromForm({ birthday: "32/10", lastVisit: "", appointment: "" }, "America/Sao_Paulo", NOW)).toEqual({ error: "Aniversário inválido: use dia e mês, como 21/10." });
    expect(contactDatesFromForm({ birthday: "", lastVisit: "", appointment: "2026-10-19T10:00" }, "America/Sao_Paulo", NOW)).toEqual({ error: "O horário marcado já passou." });
    // o campo do painel volta com o horário de parede do cliente
    expect(isoToLocalInput("2026-12-20T17:30:00.000Z", "America/Sao_Paulo")).toBe("2026-12-20T14:30");
    expect(isoToLocalInput("2026-12-20T17:30:00.000Z", "America/Manaus")).toBe("2026-12-20T13:30");
  });
});

describe("as datas pela API", () => {
  it("aniversário MM-DD ou a data inteira (sem o ano)", () => {
    expect(birthdayFromApi("10-21")).toBe("10-21");
    expect(birthdayFromApi("1990-10-21")).toBe("10-21");
    expect(birthdayFromApi("21/10")).toBeNull();
    expect(birthdayFromApi("02-30")).toBeNull();
  });

  it("o corpo do PATCH: o que não vem não muda, null apaga", () => {
    expect(parseContactDatesBody({ bot_id: "b1", birthday: "10-21" }, NOW)).toEqual({ birthday: "10-21" });
    expect(parseContactDatesBody({ last_visit_at: "2026-10-05", appointment_at: "2026-12-20T14:30:00-03:00" }, NOW)).toEqual({ last_visit_at: "2026-10-05T15:00:00.000Z", appointment_at: "2026-12-20T17:30:00.000Z" });
    expect(parseContactDatesBody({ birthday: null, appointment_at: null }, NOW)).toEqual({ birthday: null, appointment_at: null });
  });

  it("erros com o campo", () => {
    expect(err(() => parseContactDatesBody({ bot_id: "b1" }, NOW))).toMatchObject({ status: 400, message: expect.stringContaining("pelo menos um campo") });
    expect(err(() => parseContactDatesBody({ birthday: "21/10" }, NOW)).details).toEqual({ field: "birthday" });
    expect(err(() => parseContactDatesBody({ last_visit_at: "2026-11-01" }, NOW)).message).toContain("futuro");
    expect(err(() => parseContactDatesBody({ appointment_at: "2026-12-20" }, NOW)).details).toEqual({ field: "appointment_at" });
    expect(err(() => parseContactDatesBody({ appointment_at: "2026-10-19T10:00:00-03:00" }, NOW)).message).toContain("já passou");
    expect(err(() => parseContactDatesBody({ appointment_at: "2027-12-20T10:00:00-03:00" }, NOW)).message).toContain("um ano");
  });

  it("o contato da API traz as datas", () => {
    const c = { id: "c1", bot_id: "b1", channel: "whatsapp", name: "Ana", email: null, tags: [], phone: "5521999990000", bsuid: null, igsid: null, external_id: null, first_inbound_at: null, last_inbound_at: null, birthday: "10-21", last_visit_at: "2026-10-05T15:00:00.000Z", appointment_at: "2026-12-20T17:30:00.000Z", custom_dates: {}, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-20T00:00:00Z" } satisfies ApiContactRow;
    expect(contactApiObject(c, { consent: null, optedOut: [], age: null })).toMatchObject({ birthday: "10-21", last_visit_at: "2026-10-05T15:00:00.000Z", appointment_at: "2026-12-20T17:30:00.000Z" });
  });
});

describe("as datas no banco", () => {
  const BOT = "aaaaaaaa-0000-4000-8000-0000000000b1";
  let tables: Record<string, MemRow[]>;
  let db: SupabaseClient;

  beforeEach(() => {
    vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16");
    setCipherIdentityForTests(true);
    setScopeResolver({ bot: async () => ({ clientId: null }), conversation: async () => ({ clientId: null }) });
    tables = { contacts: [] };
    db = memoryDb(tables);
  });

  it("a planilha troca o aniversário e o horário, e a visita só avança", () => {
    const current = { birthday: "10-21", last_visit_at: "2026-10-10T15:00:00.000Z", appointment_at: "2026-12-20T17:30:00.000Z" };
    expect(importedDatesPatch(current, { birthday: "11-02", lastVisitAt: "2026-10-01T15:00:00.000Z", appointmentAt: "2026-12-21T17:30:00.000Z" })).toEqual({ birthday: "11-02", appointment_at: "2026-12-21T17:30:00.000Z" });
    expect(importedDatesPatch(current, { lastVisitAt: "2026-10-15T15:00:00.000Z" })).toEqual({ last_visit_at: "2026-10-15T15:00:00.000Z" });
    // sem data na linha, nada muda (a planilha não apaga)
    expect(importedDatesPatch(current, {})).toEqual({});
  });

  it("importar grava as datas de quem é novo e completa quem já existe", async () => {
    const owner = { id: BOT, agency_id: "ag1" };
    await importWhatsAppContacts(db, owner, [{ phone: "5521999990001", name: "Ana", tags: [], birthday: "10-21", appointmentAt: "2026-12-20T17:30:00.000Z" }]);
    expect(tables.contacts[0]).toMatchObject({ phone_hash: phoneHash("5521999990001"), birthday: "10-21", last_visit_at: null, appointment_at: "2026-12-20T17:30:00.000Z" });
    const r = await importWhatsAppContacts(db, owner, [{ phone: "5521999990001", name: null, tags: [], lastVisitAt: "2026-10-05T15:00:00.000Z" }]);
    expect(r.updated).toBe(1);
    expect(tables.contacts[0]).toMatchObject({ birthday: "10-21", last_visit_at: "2026-10-05T15:00:00.000Z" });
  });

  it("a ficha e a API trocam as datas só nos chatbots do escopo", async () => {
    tables.contacts.push({ id: "c1", bot_id: BOT, channel: "whatsapp", birthday: "10-21", last_visit_at: null, appointment_at: null });
    expect(await setContactDates(db, ["c1"], ["outro-bot"], { birthday: null })).toEqual([]);
    expect(tables.contacts[0].birthday).toBe("10-21");
    expect(await setContactDates(db, ["c1"], [BOT], { birthday: null, appointment_at: "2026-12-20T17:30:00.000Z" })).toEqual(["c1"]);
    expect(tables.contacts[0]).toMatchObject({ birthday: null, appointment_at: "2026-12-20T17:30:00.000Z" });
    // undefined não muda
    expect(await setContactDates(db, ["c1"], [BOT], { last_visit_at: undefined })).toEqual([]);
  });
});
