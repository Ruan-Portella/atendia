import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { channelMsgHash } from "../hash";
import type { Attendant } from "../authors";

/*
 * Conversa mais natural, parte 2: a equipe responde citando e reage (WhatsApp context.message_id e
 * type reaction; Instagram reply_to.mid e sender_action react, só o coração), só quem está com a
 * conversa; a reação feita pelo celular ou pela própria conta do Instagram fica como a da equipe.
 */

const calls: Array<{ fn: string; args: unknown[] }> = [];
vi.mock("../whatsapp", async (orig) => ({
  ...(await orig<typeof import("../whatsapp")>()),
  sendText: vi.fn(async (...args: unknown[]) => {
    calls.push({ fn: "sendText", args });
    return { messages: [{ id: "wamid.EQUIPE" }] };
  }),
  sendReaction: vi.fn(async (...args: unknown[]) => {
    calls.push({ fn: "sendReaction", args });
    return { messages: [{ id: "wamid.REACAO" }] };
  }),
}));
vi.mock("../instagram", async (orig) => ({
  ...(await orig<typeof import("../instagram")>()),
  sendInstagramText: vi.fn(async (...args: unknown[]) => {
    calls.push({ fn: "sendInstagramText", args });
    return "mid.EQUIPE";
  }),
  sendInstagramReaction: vi.fn(async (...args: unknown[]) => {
    calls.push({ fn: "sendInstagramReaction", args });
  }),
}));
// a regra de estado deixa sair (o modo tem os testes dele)
vi.mock("../conversation-mode", async (orig) => ({
  ...(await orig<typeof import("../conversation-mode")>()),
  resolveMode: vi.fn(async () => ({ step: 0, canSend: true, aiResponds: false, reason: "", facts: {} })),
}));
vi.mock("../learning", () => ({ learnLater: vi.fn() }));

const { postAgentMessage, reactAsAgent } = await import("../handoff");
const { agentReactionsFor, applyContactReaction } = await import("../message-links");
const { handleEcho } = await import("../whatsapp-inbound");

const VIVI = "a1000000-0000-4000-8000-000000000001";
const vivi: Attendant = { type: "agency_member", id: VIVI, name: "Viviane", legacy: "agência" };
const carlos: Attendant = { type: "agency_member", id: "a1000000-0000-4000-8000-000000000002", name: "Carlos", legacy: "agência" };

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-mestra-dos-testes-0123456789");
});

const msg = (id: number, conv: string, role: string, ref: string | null, extra: MemRow = {}): MemRow => ({ id, conversation_id: conv, role, content: `mensagem ${id}`, channel_msg_ref_enc: ref, channel_msg_hash: null, inbound_key: null, reply_to_id: null, contact_reaction: null, agent_reaction: null, deleted_at: null, blocked_reason: null, failed_at: null, created_at: `2026-10-21T10:0${id % 10}:00Z`, ...extra });

function setup(channel: "whatsapp" | "instagram") {
  const t: Record<string, MemRow[]> = {
    bots: [{ id: "b1", agency_id: "ag1", client_name: "Loja", human_handoff: null, paused_at: null, pause_notify: null }],
    agency_members: [{ id: VIVI, signature: null }],
    whatsapp_channels: [{ bot_id: "b1", phone_number_id: "pn-1", access_token_enc: "tok", disconnected_at: null, payment_issue_at: null, waba_id: "waba-1", coexistence: true }],
    instagram_channels: [{ bot_id: "b1", ig_user_id: "ig-conta", access_token_enc: "tok", disconnected_at: null }],
    conversations: [
      { id: "c1", bot_id: "b1", channel, wa_id: channel === "whatsapp" ? "5521999990000" : null, ig_id: channel === "instagram" ? "igsid-1" : null, contact_id: null, takeover_at: "2026-10-21T10:00:00Z", handled_at: null, assigned_to_id: VIVI, assigned_to_name: "Viviane", announce_pending: false, transfer_from_name: null, sector_id: null, ai_paused_until: null },
      { id: "outra", bot_id: "b1", channel, wa_id: "5521988880000", ig_id: null, contact_id: null, takeover_at: null, handled_at: null, assigned_to_id: null, assigned_to_name: null },
    ],
    messages: [msg(10, "c1", "user", channel === "whatsapp" ? "wamid.CONTATO" : "mid.CONTATO"), msg(11, "c1", "assistant", "wamid.IA"), msg(12, "outra", "user", "wamid.OUTRA"), msg(13, "c1", "user", null)],
  };
  return { t, db: memoryDb(t) };
}

describe("a equipe responde citando", () => {
  it("no WhatsApp: vai com context.message_id, a resposta guarda a citada e o id do envio", async () => {
    const { t, db } = setup("whatsapp");
    expect((await postAgentMessage(db, "c1", "Pode sim!", vivi, { replyToId: 10 })).ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("sendText");
    expect(calls[0].args[3]).toMatchObject({ replyTo: "wamid.CONTATO" });
    const sent = t.messages.find((m) => m.role === "agent")!;
    expect(sent).toMatchObject({ content: "Pode sim!", reply_to_id: 10, channel_msg_ref_enc: "wamid.EQUIPE", channel_msg_hash: channelMsgHash("whatsapp", "wamid.EQUIPE") });
  });

  it("a citada tem de ser desta conversa e ter o id do canal; sem citação, sai sem context", async () => {
    const { t, db } = setup("whatsapp");
    for (const id of [12, 13, 999]) {
      const r = await postAgentMessage(db, "c1", "Oi", vivi, { replyToId: id });
      expect(r).toMatchObject({ ok: false, message: expect.stringContaining("citada não está mais disponível") });
    }
    expect(calls).toHaveLength(0);
    expect((await postAgentMessage(db, "c1", "Sem citar", vivi)).ok).toBe(true);
    expect(calls[0].args[3]).toMatchObject({ replyTo: undefined });
    expect(t.messages.find((m) => m.content === "Sem citar")?.reply_to_id ?? null).toBeNull();
  });

  it("no Instagram: reply_to.mid vai na primeira DM", async () => {
    const { t, db } = setup("instagram");
    expect((await postAgentMessage(db, "c1", "Temos sim", vivi, { replyToId: 10 })).ok).toBe(true);
    expect(calls[0].fn).toBe("sendInstagramText");
    expect(calls[0].args[4]).toMatchObject({ replyTo: "mid.CONTATO" });
    expect(t.messages.find((m) => m.role === "agent")).toMatchObject({ reply_to_id: 10, channel_msg_ref_enc: "mid.EQUIPE" });
  });
});

describe("a equipe reage", () => {
  it("a paleta de cada canal", () => {
    expect(agentReactionsFor("whatsapp")).toEqual(["👍", "❤️", "😂", "😮", "😢", "🙏"]);
    expect(agentReactionsFor("instagram")).toEqual(["❤️"]);
    expect(agentReactionsFor("widget")).toEqual([]);
  });

  it("no WhatsApp: type reaction na mensagem do contato; o mesmo emoji tira", async () => {
    const { t, db } = setup("whatsapp");
    expect(await reactAsAgent(db, "c1", 10, "👍", vivi)).toMatchObject({ ok: true, message: "Reação enviada." });
    expect(calls[0]).toMatchObject({ fn: "sendReaction", args: [expect.anything(), "5521999990000", "wamid.CONTATO", "👍"] });
    expect(t.messages[0]).toMatchObject({ agent_reaction: "👍" });
    expect(t.messages[0].agent_reaction_at).toBeTruthy();
    // nada entra na conversa
    expect(t.messages.filter((m) => m.role === "agent")).toHaveLength(0);
    expect(await reactAsAgent(db, "c1", 10, "👍", vivi)).toMatchObject({ ok: true, message: "Reação retirada." });
    expect(calls[1].args[3]).toBeNull();
    expect(t.messages[0]).toMatchObject({ agent_reaction: null, agent_reaction_at: null });
  });

  it("só emoji da paleta, só na mensagem do contato e só quem está com a conversa", async () => {
    const { db } = setup("whatsapp");
    expect(await reactAsAgent(db, "c1", 10, "🔥", vivi)).toMatchObject({ ok: false, message: "Reação não disponível neste canal." });
    expect(await reactAsAgent(db, "c1", 11, "👍", vivi)).toMatchObject({ ok: false, message: "Esta mensagem não aceita reação." });
    expect(await reactAsAgent(db, "c1", 13, "👍", vivi)).toMatchObject({ ok: false });
    expect(await reactAsAgent(db, "c1", 12, "👍", vivi)).toMatchObject({ ok: false });
    expect(await reactAsAgent(db, "c1", 10, "👍", carlos)).toMatchObject({ ok: false, message: expect.stringContaining("Viviane está atendendo") });
    expect(await reactAsAgent(db, "outra", 12, "👍", vivi)).toMatchObject({ ok: false, message: "Assuma a conversa para reagir." });
    expect(calls).toHaveLength(0);
  });

  it("no Instagram: só o coração (sender_action react e unreact)", async () => {
    const { t, db } = setup("instagram");
    expect(await reactAsAgent(db, "c1", 10, "👍", vivi)).toMatchObject({ ok: false });
    expect((await reactAsAgent(db, "c1", 10, "❤️", vivi)).ok).toBe(true);
    expect(calls[0]).toMatchObject({ fn: "sendInstagramReaction", args: [expect.anything(), "igsid-1", "mid.CONTATO", true] });
    expect(t.messages[0].agent_reaction).toBe("❤️");
    await reactAsAgent(db, "c1", 10, null, vivi);
    expect(calls[1].args[3]).toBe(false);
    expect(t.messages[0].agent_reaction).toBeNull();
  });
});

describe("a reação da empresa feita fora do painel", () => {
  it("pela própria conta do Instagram ou pelo celular (coexistência): fica como a da equipe", async () => {
    const { t, db } = setup("whatsapp");
    t.messages[0].inbound_key = (await import("../message-links")).inboundKeyOf("whatsapp", "wamid.CONTATO");
    expect(await applyContactReaction(db, "whatsapp", "wamid.CONTATO", "❤️", new Date("2026-10-21T11:00:00Z"), "agent")).toBe(true);
    expect(t.messages[0]).toMatchObject({ agent_reaction: "❤️", contact_reaction: null });
    // eco do celular com reação: não vira mensagem
    await handleEcho(db, { bot_id: "b1", phone_number_id: "pn-1" } as Parameters<typeof handleEcho>[1], { id: "wamid.ECO", from: "5521000000000", to: "5521999990000", type: "reaction", reaction: { message_id: "wamid.CONTATO", emoji: "😂" } }, "k-eco");
    expect(t.messages[0].agent_reaction).toBe("😂");
    expect(t.messages.filter((m) => m.role === "agent")).toHaveLength(0);
  });
});
