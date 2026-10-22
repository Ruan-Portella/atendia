import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import type { Attendant } from "../authors";

/*
 * Pedir o telefone (leva de 21/10/2026): para quem conversa pelo nome de usuário do WhatsApp (só o
 * BSUID, o número não aparece), o botão da Meta para compartilhar o número (request_contact_info);
 * o número que volta (contato compartilhado com origin contact_request) vale para a IA e o lead.
 */

const calls: Array<{ fn: string; args: unknown[] }> = [];
vi.mock("../whatsapp", async (orig) => ({
  ...(await orig<typeof import("../whatsapp")>()),
  sendContactRequest: vi.fn(async (...args: unknown[]) => {
    calls.push({ fn: "sendContactRequest", args });
    return { messages: [{ id: "wamid.PEDIDO" }] };
  }),
}));
vi.mock("../conversation-mode", async (orig) => ({
  ...(await orig<typeof import("../conversation-mode")>()),
  resolveMode: vi.fn(async () => ({ step: 0, canSend: true, aiResponds: false, reason: "", facts: {} })),
}));
vi.mock("../learning", () => ({ learnLater: vi.fn() }));

const { PHONE_REQUEST_TEXT, needsPhone, requestPhoneAsAgent } = await import("../handoff");
const { sharedPhoneOf, inboundText } = await import("../whatsapp-inbound");
const { channelNoteFor, waPhoneOf } = await import("../chat");
const { componentsNote, parseComponents, whatsappPlan, SHORT_BODY } = await import("../components");
const { sendPlan } = await vi.importActual<typeof import("../whatsapp")>("../whatsapp");

const VIVI = "a1000000-0000-4000-8000-000000000001";
const vivi: Attendant = { type: "agency_member", id: VIVI, name: "Viviane", legacy: "agência" };
const BSUID = "BR.1234567890123456789";

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-mestra-dos-testes-0123456789");
});
afterEach(() => vi.unstubAllGlobals());

describe("o número que a pessoa compartilhou", () => {
  it("só o do botão (origin contact_request); o contato de outra pessoa encaminhado não vale", () => {
    const shared = { id: "w1", type: "contacts", from_user_id: BSUID, contacts: [{ origin: "contact_request", phones: [{ phone: "+55 21 99999-0000", wa_id: "5521999990000", type: "CELL" }] }] };
    expect(sharedPhoneOf(shared)).toBe("5521999990000");
    expect(inboundText(shared)).toBe("📞 Número compartilhado: +5521999990000");
    // sem o wa_id, o telefone escrito
    expect(sharedPhoneOf({ ...shared, contacts: [{ origin: "contact_request", phones: [{ phone: "+55 (21) 98888-1111" }] }] })).toBe("5521988881111");
    expect(sharedPhoneOf({ ...shared, contacts: [{ origin: "other", phones: [{ wa_id: "5511977776666" }] }] })).toBeNull();
    expect(inboundText({ ...shared, contacts: [{ origin: "other", phones: [{ wa_id: "5511977776666" }] }] })).toBeNull();
    expect(sharedPhoneOf({ id: "w2", type: "text", text: { body: "5521999990000" } })).toBeNull();
  });

  it("a IA vê o número compartilhado como o da pessoa; sem ele, usa pedir_telefone", () => {
    expect(waPhoneOf({ waId: "5521999990000" })).toBe("5521999990000");
    expect(waPhoneOf({ waId: BSUID, phone: "5521988881111" })).toBe("5521988881111");
    expect(waPhoneOf({ waId: BSUID })).toBeNull();
    expect(channelNoteFor({ whatsapp: { waId: BSUID } })).toContain("use pedir_telefone");
    expect(channelNoteFor({ whatsapp: { waId: BSUID, phone: "5521988881111" } })).toContain("você já tem o número da pessoa (5521988881111)");
  });
});

describe("o botão de compartilhar o número", () => {
  it("o componente: guardado, no painel, para a IA e no WhatsApp (o corpo curto quando o texto é longo)", () => {
    expect(parseComponents(JSON.stringify({ type: "contact_request" }))).toEqual({ type: "contact_request" });
    expect(componentsNote({ type: "contact_request" })).toContain("compartilhar o número");
    expect(whatsappPlan({ type: "contact_request" })).toEqual({ kind: "contact_request" });
    expect(SHORT_BODY.contact_request).toBe("Toque no botão para compartilhar o seu número:");
  });

  it("sai como mensagem interativa request_contact_info para o BSUID", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "tok");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] })));
    vi.stubGlobal("fetch", fetchMock);
    await sendPlan({ phone_number_id: "123" }, BSUID, "Pode compartilhar o seu número?", { kind: "contact_request" });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toMatchObject({ messaging_product: "whatsapp", recipient: BSUID, type: "interactive", interactive: { type: "request_contact_info", body: { text: "Pode compartilhar o seu número?" }, action: { name: "request_contact_info" } } });
    expect(body.to).toBeUndefined();
  });
});

function setup(waId: string, contact: MemRow = { id: "ct1", phone_hash: null }, holder = VIVI) {
  const t: Record<string, MemRow[]> = {
    bots: [{ id: "b1", agency_id: "ag1", client_name: "Loja", human_handoff: null, paused_at: null, pause_notify: null }],
    whatsapp_channels: [{ bot_id: "b1", phone_number_id: "pn-1", access_token_enc: "tok", disconnected_at: null, payment_issue_at: null, waba_id: "waba-1", coexistence: false }],
    contacts: [contact],
    conversations: [{ id: "c1", bot_id: "b1", channel: "whatsapp", wa_id: waId, ig_id: null, contact_id: contact.id, takeover_at: "2026-10-21T10:00:00Z", handled_at: null, assigned_to_id: holder, assigned_to_name: "Viviane", ai_paused_until: null }],
    messages: [],
  };
  return { t, db: memoryDb(t) };
}

describe("a equipe pede o telefone pelo painel", () => {
  it("manda o botão com o texto fixo e grava a mensagem com o componente", async () => {
    const { t, db } = setup(BSUID);
    expect(await needsPhone(db, t.conversations[0])).toBe(true);
    expect(await requestPhoneAsAgent(db, "c1", vivi)).toMatchObject({ ok: true });
    expect(calls).toEqual([{ fn: "sendContactRequest", args: [expect.anything(), BSUID, PHONE_REQUEST_TEXT] }]);
    expect(t.messages[0]).toMatchObject({ role: "agent", content: PHONE_REQUEST_TEXT, components_enc: JSON.stringify({ type: "contact_request" }) });
  });

  it("não pede quando o número já aparece (telefone ou compartilhado), nem para quem não está com a conversa", async () => {
    const phone = setup("5521999990000");
    expect(await needsPhone(phone.db, phone.t.conversations[0])).toBe(false);
    expect(await requestPhoneAsAgent(phone.db, "c1", vivi)).toMatchObject({ ok: false, message: "O número desta pessoa já aparece na conversa." });
    const shared = setup(BSUID, { id: "ct1", phone_hash: "hash-do-telefone" });
    expect(await needsPhone(shared.db, shared.t.conversations[0])).toBe(false);
    const other = setup(BSUID, { id: "ct1", phone_hash: null }, "outra-pessoa");
    expect(await requestPhoneAsAgent(other.db, "c1", vivi)).toMatchObject({ ok: false, message: expect.stringContaining("está atendendo") });
    expect(calls).toEqual([]);
  });
});
