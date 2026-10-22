import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { channelMsgHash } from "../hash";
import { applyContactReaction, inboundKeyOf, linkInbound, quoteSnippet, quotedNote, quotesOf, reactionEmoji } from "../message-links";
import { conversationHistory } from "../chat";

/*
 * Conversa mais natural, parte 1: a citação e a reação do contato no WhatsApp e no Instagram (a
 * mensagem achada pelo hash de sempre), o id original guardado e a IA lendo o trecho citado.
 */

beforeEach(() => {
  vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-mestra-dos-testes-0123456789");
});

function setup() {
  const t: Record<string, MemRow[]> = {
    conversations: [{ id: "conv1", bot_id: "b1", channel: "whatsapp" }],
    messages: [
      { id: 1, conversation_id: "conv1", role: "assistant", content: "Temos a pizza de calabresa (R$ 45) e a de frango (R$ 42).", channel_msg_hash: channelMsgHash("whatsapp", "wamid.A"), inbound_key: null, reply_to_id: null, channel_msg_ref_enc: null, contact_reaction: null, agent_reaction: null, deleted_at: null, blocked_reason: null, failed_at: null, created_at: "2026-10-21T10:00:00Z" },
      { id: 2, conversation_id: "conv1", role: "user", content: "quero essa", channel_msg_hash: null, inbound_key: inboundKeyOf("whatsapp", "wamid.B"), reply_to_id: null, channel_msg_ref_enc: null, contact_reaction: null, agent_reaction: null, deleted_at: null, blocked_reason: null, failed_at: null, created_at: "2026-10-21T10:01:00Z" },
      { id: 3, conversation_id: "outra", role: "assistant", content: "de outra conversa", channel_msg_hash: channelMsgHash("whatsapp", "wamid.X"), inbound_key: null, reply_to_id: null, channel_msg_ref_enc: null, contact_reaction: null, agent_reaction: null, deleted_at: null, blocked_reason: null, failed_at: null, created_at: "2026-10-21T09:00:00Z" },
    ],
  };
  return { t, db: memoryDb(t) };
}

describe("as regras", () => {
  it("o emoji da reação, o trecho e a nota para a IA", () => {
    expect(reactionEmoji({ emoji: "👍" })).toBe("👍");
    expect(reactionEmoji({ reaction: "love" })).toBe("❤️");
    expect(reactionEmoji({ reaction: "outra" })).toBeNull();
    expect(quoteSnippet("  linha um\n\n linha dois ")).toBe("linha um linha dois");
    expect(quoteSnippet("x".repeat(300))).toHaveLength(160);
    expect(quoteSnippet("qualquer", true)).toBe("(mensagem apagada)");
    expect(quotedNote("a pizza")).toBe('[O contato respondeu em cima desta mensagem: "a pizza"]');
  });
});

describe("citar e reagir", () => {
  it("a mensagem do contato fica ligada à citada (só da mesma conversa) e guarda o id original", async () => {
    const { t, db } = setup();
    expect(await linkInbound(db, "whatsapp", [{ key: inboundKeyOf("whatsapp", "wamid.B"), channelId: "wamid.B", quotedId: "wamid.A" }])).toBe(1);
    expect(t.messages[1]).toMatchObject({ reply_to_id: 1, channel_msg_ref_enc: "wamid.B" });
    // citou mensagem de outra conversa: não liga
    t.messages[1].reply_to_id = null;
    expect(await linkInbound(db, "whatsapp", [{ key: inboundKeyOf("whatsapp", "wamid.B"), channelId: "wamid.B", quotedId: "wamid.X" }])).toBe(0);
    expect(t.messages[1].reply_to_id).toBeNull();
    const quotes = await quotesOf(db, [1, null, 1]);
    expect(quotes.get(1)).toEqual({ snippet: "Temos a pizza de calabresa (R$ 45) e a de frango (R$ 42).", fromContact: false });
  });

  it("a reação do contato fica na mensagem; sem emoji, sai", async () => {
    const { t, db } = setup();
    expect(await applyContactReaction(db, "whatsapp", "wamid.A", "👍", new Date("2026-10-21T10:02:00Z"))).toBe(true);
    expect(t.messages[0]).toMatchObject({ contact_reaction: "👍", contact_reaction_at: "2026-10-21T10:02:00.000Z" });
    // reação à mensagem do próprio contato (pela chave do evento) também vale
    expect(await applyContactReaction(db, "whatsapp", "wamid.B", "😂")).toBe(true);
    expect(t.messages[1].contact_reaction).toBe("😂");
    await applyContactReaction(db, "whatsapp", "wamid.A", null);
    expect(t.messages[0]).toMatchObject({ contact_reaction: null, contact_reaction_at: null });
    expect(await applyContactReaction(db, "whatsapp", "wamid.nao-existe", "👍")).toBe(false);
  });

  it("o histórico da IA leva o trecho citado na mensagem do contato", async () => {
    const { db } = setup();
    await linkInbound(db, "whatsapp", [{ key: inboundKeyOf("whatsapp", "wamid.B"), channelId: "wamid.B", quotedId: "wamid.A" }]);
    const history = await conversationHistory(db, "conv1");
    const last = history.at(-1)!;
    expect(last.role).toBe("user");
    expect((last.parts[0] as { text: string }).text).toBe('[O contato respondeu em cima desta mensagem: "Temos a pizza de calabresa (R$ 45) e a de frango (R$ 42)."]\nquero essa');
  });
});
