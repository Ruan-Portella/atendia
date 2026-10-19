import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.CONTACT_HASH_KEY ??= "chave-de-teste-com-mais-de-16-caracteres";

// a Meta fica de fora: a lista de modelos, o envio e a camada de envio
const sent: Array<{ to: string; template: string; vars: string[]; urlSuffix?: string }> = [];
let approved = new Set(["boavoz_aviso_urgente", "boavoz_aviso_atendente", "boavoz_aviso_lead", "boavoz_aviso_canal", "boavoz_aviso_pagamento", "boavoz_aviso_cota"]);
vi.mock("../whatsapp-templates", async (orig) => ({
  ...(await orig<typeof import("../whatsapp-templates")>()),
  listTemplates: vi.fn(async () => [...approved].map((name, i) => ({ id: String(i), name, language: "pt_BR", status: "APPROVED", category: "UTILITY", components: [] }))),
  sendTemplate: vi.fn(async (_ch: unknown, to: string, t: { name: string }, vars: string[], o: { urlSuffix?: string }) => {
    sent.push({ to, template: t.name, vars, urlSuffix: o.urlSuffix });
    return { messages: [{ id: `wamid.${sent.length}` }] };
  }),
}));
vi.mock("../send", () => ({ deliver: vi.fn(async (_db: unknown, o: { transport: () => Promise<string | null> }) => ({ status: "sent", messageId: 1, channelMessageId: await o.transport() })) }));
// o limite de verdade é uma função do banco: aqui, um contador por chave
const hits = new Map<string, number>();
vi.mock("../rate-limit", () => ({
  firstExceeded: vi.fn(async (_db: unknown, rules: Array<{ key: string; max: number }>) => {
    for (const r of rules) hits.set(r.key, (hits.get(r.key) ?? 0) + 1);
    return rules.find((r) => (hits.get(r.key) ?? 0) > r.max) ?? null;
  }),
}));

import { memoryDb, type MemRow } from "../memory-db";
import { NOTICE_KINDS, botTitle, forgetNoticeTemplates, kindsForRole, noticeKindStatuses, noticeOn, sendTeamNotice } from "../team-notices";
import { forgetAssistantCache } from "../team-whatsapp";
import { phoneHash } from "../contacts";
import { suppress } from "../suppression";

const ASSISTANT = "11111111-1111-4111-8111-111111111111";
const AGENCY = "33333333-3333-4333-8333-333333333333";
const BOT = "77777777-7777-4777-8777-777777777777";
const CLIENT = "88888888-8888-4888-8888-888888888888";
const OWNER = "44444444-4444-4444-8444-444444444444";
const AGENT_IN = "55555555-5555-4555-8555-555555555555";
const AGENT_OUT = "66666666-6666-4666-8666-666666666666";
const ADMIN = "99999999-9999-4999-8999-999999999999";
const phoneOf: Record<string, string> = { [OWNER]: "5541999990001", [AGENT_IN]: "5541999990002", [AGENT_OUT]: "5541999990003", [ADMIN]: "5541999990004" };

function tables(): Record<string, MemRow[]> {
  const member = (id: string, role: string, scope = "all") => ({ id, agency_id: AGENCY, role, scope, accepted_at: "2026-10-01T00:00:00.000Z", removed_at: null });
  return {
    platform_flags: [{ id: 1, assistant_bot_id: ASSISTANT }],
    bots: [{ id: ASSISTANT, agency_id: "22222222-2222-4222-8222-222222222222" }],
    whatsapp_channels: [{ bot_id: ASSISTANT, phone_number_id: "pn-1", waba_id: "waba-1", access_token_enc: "tok", disconnected_at: null }],
    agency_members: [member(OWNER, "owner"), member(AGENT_IN, "agent", "selected"), member(AGENT_OUT, "agent", "selected"), member(ADMIN, "admin")],
    agency_member_scopes: [
      { member_id: AGENT_IN, bot_id: BOT, client_id: null },
      { member_id: AGENT_OUT, bot_id: "00000000-0000-4000-8000-000000000000", client_id: null },
    ],
    team_whatsapp: Object.entries(phoneOf).map(([memberId, phone]) => ({ member_id: memberId, agency_id: AGENCY, phone_enc: phone, phone_hash: phoneHash(phone), status: "confirmed", prefs: {}, identity_changed_at: null })),
    clients: [{ id: CLIENT, allow_handoff: false, handoff_notify: "agency" }],
    client_members: [],
    suppressions: [],
    contacts: [],
    conversations: [],
  };
}

const handoff = (kind: "urgente" | "atendente" = "atendente", ref = "conv-1") => ({ kind, agencyId: AGENCY, botId: BOT, clientId: CLIENT, vars: ["Bar do Zé (Zé)"], path: `painel/bots/${BOT}/conversas/${ref}`, ref });
const to = () => sent.map((s) => s.to).sort();

beforeEach(() => {
  forgetAssistantCache();
  forgetNoticeTemplates();
  sent.length = 0;
  hits.clear();
  approved = new Set(Object.values(NOTICE_KINDS).map((k) => k.template));
});

describe("avisos da equipe: puras", () => {
  it("quem recebe cada aviso, pelo papel", () => {
    expect(kindsForRole("agent")).toEqual(["urgente", "atendente", "lead"]);
    expect(kindsForRole("editor")).toEqual(["urgente", "atendente", "lead", "canal"]);
    expect(kindsForRole("admin")).toEqual(["urgente", "atendente", "lead", "canal"]);
    expect(kindsForRole("owner")).toEqual(["urgente", "atendente", "lead", "canal", "pagamento", "cota"]);
  });

  it("ligado por padrão, o título do chatbot e o estado dos modelos", () => {
    expect(noticeOn({}, "lead")).toBe(true);
    expect(noticeOn({ lead: false }, "lead")).toBe(false);
    expect(botTitle({ name: "Bar do Zé", client_name: "Zé Lanches" })).toBe("Bar do Zé (Zé Lanches)");
    expect(botTitle({ name: "Bar do Zé", client_name: "Bar do Zé" })).toBe("Bar do Zé");
    const s = noticeKindStatuses([{ id: "1", name: "boavoz_aviso_lead", language: "pt_BR", status: "APPROVED", category: "UTILITY", components: [] }]);
    expect(s.lead).toBe("aprovado");
    expect(s.urgente).toBe("ausente");
  });
});

describe("avisos da equipe: quem recebe", () => {
  it("pedido de atendente: quem atende o chatbot (escopo), com o botão para a conversa", async () => {
    const t = tables();
    expect(await sendTeamNotice(memoryDb(t), handoff())).toBe(3);
    expect(to()).toEqual([phoneOf[OWNER], phoneOf[AGENT_IN], phoneOf[ADMIN]].sort());
    expect(sent[0]).toMatchObject({ template: "boavoz_aviso_atendente", vars: ["Bar do Zé (Zé)"], urlSuffix: `painel/bots/${BOT}/conversas/conv-1` });
    // os avisos ficam na conversa de cada pessoa com o assistente
    expect(t.conversations.every((c) => c.bot_id === ASSISTANT)).toBe(true);
  });

  it("o mesmo acontecimento não avisa duas vezes; outro acontecimento, sim", async () => {
    const t = tables();
    await sendTeamNotice(memoryDb(t), handoff());
    expect(await sendTeamNotice(memoryDb(t), handoff())).toBe(0);
    expect(await sendTeamNotice(memoryDb(t), handoff("urgente"))).toBe(3);
    expect(await sendTeamNotice(memoryDb(t), handoff("atendente", "conv-2"))).toBe(3);
  });

  it("pula quem desligou o aviso, quem trocou de aparelho e quem mandou SAIR", async () => {
    const t = tables();
    t.team_whatsapp.find((r) => r.member_id === OWNER)!.prefs = { atendente: false };
    t.team_whatsapp.find((r) => r.member_id === ADMIN)!.identity_changed_at = "2026-10-19T12:00:00.000Z";
    await suppress(memoryDb(t), { channel: "whatsapp", scope: "waba:waba-1", contact: phoneOf[AGENT_IN], kind: "utility", reason: "opt_out", source: "chat" });
    expect(await sendTeamNotice(memoryDb(t), handoff())).toBe(0);
  });

  it("pagamento só para o dono; sem modelo aprovado, nada", async () => {
    const t = tables();
    expect(await sendTeamNotice(memoryDb(t), { kind: "pagamento", agencyId: AGENCY, vars: ["Norte Marketing"], path: "painel/cobranca", ref: AGENCY })).toBe(1);
    expect(to()).toEqual([phoneOf[OWNER]]);
    approved = new Set();
    forgetNoticeTemplates();
    expect(await sendTeamNotice(memoryDb(t), { kind: "lead", agencyId: AGENCY, botId: BOT, clientId: CLIENT, vars: ["Bar do Zé"], path: "painel/clientes", ref: "lead-1" })).toBe(0);
  });

  it("atendimento delegado ao cliente: pedido de atendente não vai para a agência; o urgente vai", async () => {
    const t = tables();
    t.clients[0] = { id: CLIENT, allow_handoff: true, handoff_notify: "client" };
    t.client_members = [{ id: "cm-1", client_id: CLIENT, email: "dono@cliente.com" }];
    expect(await sendTeamNotice(memoryDb(t), handoff())).toBe(0);
    expect(await sendTeamNotice(memoryDb(t), handoff("urgente"))).toBe(3);
  });
});

describe("modelos com botão de link", () => {
  it("cria com a variável no fim da URL e manda com o caminho do painel", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    vi.resetModules();
    vi.doMock("../whatsapp", async (orig) => ({ ...(await orig<typeof import("../whatsapp")>()), graphFor: vi.fn(async (_ch: unknown, path: string, o?: { body?: unknown }) => (calls.push({ path, body: o?.body }), { id: "t1", messages: [{ id: "w1" }] })) }));
    const real = await vi.importActual<typeof import("../whatsapp-templates")>("../whatsapp-templates");
    await real.createTemplate({ phone_number_id: "pn", waba_id: "waba", access_token_enc: "tok" } as never, { name: "boavoz_aviso_lead", category: "UTILITY", body: "Lead novo no chatbot {{1}}. Veja no painel.", examples: ["Bar"], urlButton: { text: "Abrir no painel", baseUrl: "https://dev.boavoz.com/", example: "https://dev.boavoz.com/painel/clientes" } });
    await real.sendTemplate({ phone_number_id: "pn", access_token_enc: "tok" } as never, "5541999990001", { name: "boavoz_aviso_lead", language: "pt_BR" }, ["Bar"], { urlSuffix: "painel/bots/x/conversas/y" });
    vi.doUnmock("../whatsapp");
    expect(calls[0].body).toMatchObject({ components: [{ type: "BODY" }, { type: "BUTTONS", buttons: [{ type: "URL", text: "Abrir no painel", url: "https://dev.boavoz.com/{{1}}", example: ["https://dev.boavoz.com/painel/clientes"] }] }] });
    expect(calls[1].body).toMatchObject({ template: { components: [{ type: "body" }, { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "painel/bots/x/conversas/y" }] }] } });
  });
});
