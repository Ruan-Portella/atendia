import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";
import { appointmentLabels, birthdaySlot, birthdaysOn, daySlot, firstNameOf, hourSlot, nextAllowed, planReguas, reminderSlot } from "../reguas";
import { setCipherIdentityForTests, setScopeResolver } from "../field-cipher";
import { appointmentOfKey } from "../campaigns";

/*
 * Réguas, parte 2 (o motor): os horários (8h às 20h no fuso do cliente, a hora escolhida, o prazo
 * de cada envio) e o planejador, que põe na fila da campanha de cada régua ligada quem entrou nela,
 * uma vez por pessoa e ocasião, uma régua por pessoa a cada 24 h (o lembrete primeiro).
 */

const SP = "America/Sao_Paulo";
const H = 3_600_000;
const D = 24 * H;
const at = (s: string) => Date.parse(s);
const iso = (ms: number) => new Date(ms).toISOString();

describe("horários das réguas", () => {
  it("só das 8h às 20h no fuso do cliente", () => {
    expect(iso(nextAllowed(at("2026-10-20T09:30:00Z"), SP))).toBe("2026-10-20T11:00:00.000Z"); // 6h30 → 8h
    expect(iso(nextAllowed(at("2026-10-20T23:30:00Z"), SP))).toBe("2026-10-21T11:00:00.000Z"); // 20h30 → 8h do dia seguinte
    expect(iso(nextAllowed(at("2026-10-20T18:00:00Z"), SP))).toBe("2026-10-20T18:00:00.000Z"); // 15h fica
    expect(iso(nextAllowed(at("2026-10-20T23:30:00Z"), "America/Manaus"))).toBe("2026-10-20T23:30:00.000Z"); // 19h30 em Manaus fica
  });

  it("aniversário de hoje (o 29/02 no 28/02 de ano que não é bissexto)", () => {
    expect(birthdaysOn(at("2026-10-20T15:00:00Z"), SP)).toEqual(["10-20"]);
    expect(birthdaysOn(at("2027-02-28T15:00:00Z"), SP)).toEqual(["02-28", "02-29"]);
    expect(birthdaysOn(at("2028-02-28T15:00:00Z"), SP)).toEqual(["02-28"]);
    // 1h da manhã do dia 21 em São Paulo ainda é dia 20 em UTC-4? Não: é 23h do dia 20 em Manaus
    expect(birthdaysOn(at("2026-10-21T04:00:00Z"), "America/Manaus")).toEqual(["10-21"]);
  });

  it("aniversário: na hora escolhida, ou agora; depois das 20h, não sai mais", () => {
    expect(birthdaySlot(at("2026-10-20T09:00:00Z"), { tz: SP, sendHour: 9 })).toEqual({ sendAt: at("2026-10-20T12:00:00Z"), expiresAt: at("2026-10-20T23:00:00Z") });
    expect(birthdaySlot(at("2026-10-20T18:00:00Z"), { tz: SP, sendHour: 9 })?.sendAt).toBe(at("2026-10-20T18:00:00Z"));
    expect(birthdaySlot(at("2026-10-20T23:30:00Z"), { tz: SP, sendHour: 9 })).toBeNull();
  });

  it("régua por dia: no dia do prazo, na hora escolhida; à noite, na manhã seguinte", () => {
    const due = at("2026-10-20T05:00:00Z"); // 2h da manhã do dia 20
    expect(daySlot(due, { tz: SP, sendHour: 10, now: at("2026-10-20T06:00:00Z") })).toEqual({ sendAt: at("2026-10-20T13:00:00Z"), expiresAt: at("2026-10-21T13:00:00Z") });
    expect(daySlot(due, { tz: SP, sendHour: 10, now: at("2026-10-20T15:00:00Z") }).sendAt).toBe(at("2026-10-20T15:00:00Z"));
    expect(daySlot(due, { tz: SP, sendHour: 10, now: at("2026-10-20T23:30:00Z") }).sendAt).toBe(at("2026-10-21T13:00:00Z"));
  });

  it("régua por hora: quando o prazo vence, dentro da janela", () => {
    expect(hourSlot(at("2026-10-21T01:00:00Z"), { tz: SP, now: at("2026-10-20T15:00:00Z") }).sendAt).toBe(at("2026-10-21T11:00:00Z")); // 22h → 8h
    expect(hourSlot(at("2026-10-20T12:00:00Z"), { tz: SP, now: at("2026-10-20T15:00:00Z") }).sendAt).toBe(at("2026-10-20T15:00:00Z")); // venceu: agora
  });

  it("lembrete: N horas antes, nunca depois do horário", () => {
    const appt = at("2026-12-20T17:30:00Z"); // 14h30
    expect(reminderSlot(appt, 24, { tz: SP, now: at("2026-12-18T12:00:00Z") })).toEqual({ sendAt: at("2026-12-19T17:30:00Z"), expiresAt: appt - 15 * 60_000 });
    // marcado em cima da hora: agora
    expect(reminderSlot(appt, 24, { tz: SP, now: at("2026-12-20T13:00:00Z") })?.sendAt).toBe(at("2026-12-20T13:00:00Z"));
    // horário às 7h: 24 h antes cai às 7h da véspera, vai às 8h
    expect(reminderSlot(at("2026-12-20T10:00:00Z"), 24, { tz: SP, now: at("2026-12-18T12:00:00Z") })?.sendAt).toBe(at("2026-12-19T11:00:00Z"));
    // horário às 22h com 1 h: 21h é tarde; vai às 19h55
    expect(reminderSlot(at("2026-12-21T01:00:00Z"), 1, { tz: SP, now: at("2026-12-20T15:00:00Z") })?.sendAt).toBe(at("2026-12-20T22:55:00Z"));
    // horário às 8h15 com 1 h, agora 6h: não dá para avisar a tempo dentro da janela
    expect(reminderSlot(at("2026-12-20T11:15:00Z"), 1, { tz: SP, now: at("2026-12-20T09:00:00Z") })).toBeNull();
  });

  it("o lembrete na fila guarda o horário na chave: remarcado, o motor não envia", () => {
    expect(appointmentOfKey("l:ct03:2026-10-21T12:30:00.000Z")).toBe(at("2026-10-21T12:30:00Z"));
    // o formato que o Postgres devolve
    expect(appointmentOfKey("l:ct03:2026-10-21T12:30:00+00:00")).toBe(at("2026-10-21T12:30:00Z"));
  });

  it("as variáveis: o primeiro nome e o horário no fuso", () => {
    expect(appointmentLabels(at("2026-12-20T17:30:00Z"), SP)).toEqual({ date: "20/12", time: "14:30" });
    expect(firstNameOf("ana maria")).toBe("ana");
    expect(firstNameOf(null)).toBe("cliente");
  });
});

describe("o planejador", () => {
  const BOT = "aaaaaaaa-0000-4000-8000-0000000000b1";
  const NOW = at("2026-10-20T12:00:00Z"); // 9h em São Paulo
  let tables: Record<string, MemRow[]>;
  let db: SupabaseClient;
  const regua = (id: string, kind: string, delay: number | null) => ({ id, agency_id: "ag1", client_id: "cl1", bot_id: BOT, kind, active: true, delay_value: delay, send_hour: 9, planned_at: null });
  const campaign = (id: string, reguaId: string, category: string) => ({ id, regua_id: reguaId, bot_id: BOT, status: "sending", template_category: category, pause_reason: null });
  const contact = (id: string, o: MemRow) => ({ id, bot_id: BOT, channel: "whatsapp", name: null, phone_enc: `55219999900${id.slice(-2)}`, first_inbound_at: "2026-09-01T12:00:00Z", last_inbound_at: null, birthday: null, last_visit_at: null, appointment_at: null, ...o });
  const sends = (campaignId: string) => tables.campaign_sends.filter((s) => s.campaign_id === campaignId);

  beforeEach(() => {
    vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16");
    setCipherIdentityForTests(true);
    setScopeResolver({ bot: async () => ({ clientId: null }), conversation: async () => ({ clientId: null }) });
    tables = {
      clients: [{ id: "cl1", timezone: SP, utility_consent_at: null }],
      reguas: [regua("r-aniv", "aniversario", null), regua("r-lemb", "lembrete", 24), regua("r-sumido", "sumido", 30), regua("r-sem", "sem_resposta", 2), regua("r-pos", "pos_atendimento", 48)],
      campaigns: [campaign("c-aniv", "r-aniv", "MARKETING"), campaign("c-lemb", "r-lemb", "UTILITY"), campaign("c-sumido", "r-sumido", "MARKETING"), campaign("c-sem", "r-sem", "MARKETING"), campaign("c-pos", "r-pos", "MARKETING")],
      contacts: [
        contact("ct01", { name: "Ana Souza", birthday: "10-20" }),
        // nunca escreveu: o lembrete de utilidade sem a declaração do cliente não vai
        contact("ct02", { name: "Bruno", first_inbound_at: null, appointment_at: "2026-10-21T12:30:00.000Z" }),
        // aniversário hoje e horário amanhã: o lembrete vem primeiro, e só uma régua no dia
        contact("ct03", { name: "Carla", birthday: "10-20", appointment_at: "2026-10-21T12:30:00.000Z" }),
        contact("ct04", { name: "Davi", last_visit_at: iso(NOW - 30 * D - 2 * H), last_inbound_at: iso(NOW - 2 * D) }),
        contact("ct05", { name: "Eva", last_inbound_at: iso(NOW - 30 * D - 5 * H) }),
        contact("ct06", { name: "Fábio" }),
        contact("ct07", { name: "Gabi" }),
        contact("ct08", { name: "Hugo", last_visit_at: iso(NOW - 49 * H) }),
        // outro canal ou outro chatbot: fora
        contact("ct09", { name: "Iara", birthday: "10-20", channel: "instagram" }),
        contact("ct10", { name: "João", birthday: "10-20", bot_id: "outro-bot" }),
      ],
      conversations: [
        { id: "cv-fabio", bot_id: BOT, channel: "whatsapp", contact_id: "ct06", last_reply_at: iso(NOW - 2 * D - H), last_contact_at: iso(NOW - 2 * D - 2 * H), handled_at: null },
        // a última mensagem da loja foi uma campanha: não conta como conversa à espera
        { id: "cv-gabi", bot_id: BOT, channel: "whatsapp", contact_id: "ct07", last_reply_at: iso(NOW - 2 * D - H), last_contact_at: iso(NOW - 9 * D), handled_at: null },
      ],
      messages: [
        { id: 1, conversation_id: "cv-fabio", role: "assistant", author: "ia", created_at: iso(NOW - 2 * D - H) },
        { id: 2, conversation_id: "cv-gabi", role: "agent", author: "campanha", created_at: iso(NOW - 2 * D - H) },
      ],
      campaign_sends: [],
    };
    db = memoryDb(tables);
  });

  it("põe na fila quem entrou em cada régua, com a hora, o prazo e as variáveis", async () => {
    expect(await planReguas(db, { hasTime: () => true, now: NOW })).toEqual({ reguas: 5, queued: 6 });
    expect(sends("c-lemb").map((s) => s.dedupe_key)).toEqual(["l:ct03:2026-10-21T12:30:00.000Z"]);
    expect(sends("c-lemb")[0]).toMatchObject({ send_at: "2026-10-20T12:30:00.000Z", expires_at: "2026-10-21T12:15:00.000Z", status: "queued" });
    expect(JSON.parse(sends("c-lemb")[0].variables_enc as string)).toEqual(["Carla", "21/10", "09:30"]);
    expect(sends("c-aniv").map((s) => s.dedupe_key)).toEqual(["a:ct01:2026"]);
    expect(sends("c-aniv")[0]).toMatchObject({ send_at: "2026-10-20T12:00:00.000Z", expires_at: "2026-10-20T23:00:00.000Z" });
    expect(JSON.parse(sends("c-aniv")[0].variables_enc as string)).toEqual(["Ana"]);
    expect(sends("c-sumido").map((s) => s.dedupe_key).sort()).toEqual([`s:ct04:${iso(NOW - 30 * D - 2 * H).slice(0, 10)}`, `s:ct05:${iso(NOW - 30 * D - 5 * H).slice(0, 10)}`]);
    expect(sends("c-sem").map((s) => s.dedupe_key)).toEqual([`r:cv-fabio:${iso(NOW - 2 * D - H)}`]);
    expect(sends("c-pos").map((s) => s.dedupe_key)).toEqual([`p:v:ct08:${iso(NOW - 49 * H)}`]);
    expect(tables.reguas.every((r) => r.planned_at === iso(NOW))).toBe(true);
  });

  it("volta só depois de 1 hora, sem repetir a mesma ocasião nem a mesma pessoa no dia", async () => {
    await planReguas(db, { hasTime: () => true, now: NOW });
    expect(await planReguas(db, { hasTime: () => true, now: NOW + 10 * 60_000 })).toEqual({ reguas: 0, queued: 0 });
    expect(await planReguas(db, { hasTime: () => true, now: NOW + 2 * H })).toEqual({ reguas: 5, queued: 0 });
    expect(tables.campaign_sends).toHaveLength(6);
  });

  it("com a declaração do cliente, o lembrete vai também para quem nunca escreveu", async () => {
    tables.clients[0].utility_consent_at = "2026-10-01T12:00:00Z";
    await planReguas(db, { hasTime: () => true, now: NOW });
    expect(sends("c-lemb").map((s) => s.dedupe_key).sort()).toEqual(["l:ct02:2026-10-21T12:30:00.000Z", "l:ct03:2026-10-21T12:30:00.000Z"]);
  });

  it("régua desligada ou com a campanha pausada fica de fora", async () => {
    tables.reguas[0].active = false;
    tables.campaigns[1].status = "paused";
    const r = await planReguas(db, { hasTime: () => true, now: NOW });
    expect(r.reguas).toBe(3);
    expect(sends("c-aniv")).toEqual([]);
    expect(sends("c-lemb")).toEqual([]);
    // sem o lembrete, a Carla recebe a do aniversário? Não: a régua do aniversário está desligada
    expect(tables.campaign_sends.some((s) => String(s.dedupe_key).includes("ct03"))).toBe(false);
  });
});
