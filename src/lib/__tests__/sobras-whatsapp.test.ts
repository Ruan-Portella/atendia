import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Leva das sobras, parte 2: o envio com o hash de identidade (o 137000 desfaz o vínculo) e a volta
 * aos lembretes pelo chat (a oferta com Sim e Não, para quem parou os lembretes).
 */

const events = vi.hoisted(() => {
  // o hash do contato (supressão) usa a chave dos segredos
  process.env.WHATSAPP_TOKEN_KEY ??= "chave-mestra-dos-testes-0123456789";
  return { linked: [] as Array<{ id: string; kind: string; reason?: string }>, consent: [] as Array<{ type: string; granted: boolean }> };
});
vi.mock("../webhooks", async (orig) => ({
  ...(await orig<typeof import("../webhooks")>()),
  emitLinkEvent: vi.fn(async (_db: unknown, id: string, kind: string, data: { reason?: string }) => void events.linked.push({ id, kind, reason: data?.reason })),
}));
vi.mock("../platform-events", async (orig) => ({
  ...(await orig<typeof import("../platform-events")>()),
  queueConsentEvent: vi.fn(async (_db: unknown, e: { type: string; granted: boolean }) => void events.consent.push({ type: e.type, granted: e.granted })),
}));

import { memoryDb, type MemRow } from "../memory-db";
import { recipientOf } from "../whatsapp";
import { handleIdentityMismatch, linkedRecipient } from "../pairing";
import { failureReason } from "../send-errors";
import { activeSuppressions, contactHash, isReminderReturnRequest, remindOfferText, remindersStopped, returnToReminders } from "../suppression";

beforeEach(() => {
  events.linked.length = 0;
  events.consent.length = 0;
});

describe("o hash de identidade no envio", () => {
  it("o destino leva o hash só quando há vínculo", () => {
    expect(recipientOf("5521999990000")).toEqual({ to: "5521999990000" });
    expect(recipientOf("BR.abc")).toEqual({ recipient: "BR.abc" });
    expect(recipientOf({ id: "5521999990000", identityHash: "DF2lS5v2W6x=" })).toEqual({ to: "5521999990000", recipient_identity_key_hash: "DF2lS5v2W6x=" });
    expect(recipientOf({ id: "5521999990000", identityHash: null })).toEqual({ to: "5521999990000" });
  });

  it("o vínculo ativo dá o hash; desfeito, ou sem hash, só o número", async () => {
    const t: Record<string, MemRow[]> = {
      contact_links: [
        { id: "l1", contact_id: "c1", channel: "whatsapp", identity_key_hash: "HASH1", unlinked_at: null },
        { id: "l2", contact_id: "c2", channel: "whatsapp", identity_key_hash: "HASH2", unlinked_at: "2026-10-20T10:00:00Z" },
        { id: "l3", contact_id: "c3", channel: "whatsapp", identity_key_hash: null, unlinked_at: null },
      ],
    };
    const db = memoryDb(t);
    expect(await linkedRecipient(db, "c1", "5521999990000")).toEqual({ id: "5521999990000", identityHash: "HASH1" });
    expect(await linkedRecipient(db, "c2", "5521999990000")).toBe("5521999990000");
    expect(await linkedRecipient(db, "c3", "5521999990000")).toBe("5521999990000");
    expect(await linkedRecipient(db, null, "5521999990000")).toBe("5521999990000");
  });

  it("o 137000 no status desfaz os vínculos do WhatsApp (contact.unlinked identity_changed)", async () => {
    const t: Record<string, MemRow[]> = {
      messages: [{ id: 1, conversation_id: "conv1", channel_msg_hash: "h-msg" }],
      conversations: [{ id: "conv1", contact_id: "c1" }],
      contacts: [{ id: "c1", active_link_id: "l1" }],
      contact_links: [
        { id: "l1", bot_id: "b1", contact_id: "c1", channel: "whatsapp", identity_key_hash: "HASH1", unlinked_at: null, linked_at: "2026-10-01T10:00:00Z", source: "pairing" },
        { id: "l2", bot_id: "b1", contact_id: "c1", channel: "instagram", identity_key_hash: null, unlinked_at: null, linked_at: "2026-10-02T10:00:00Z", source: "pairing" },
      ],
      conversation_identities: [],
    };
    const db = memoryDb(t);
    expect(await handleIdentityMismatch(db, "h-msg")).toEqual({ contactId: "c1", conversationId: "conv1", unlinked: 1 });
    expect(t.contact_links[0]).toMatchObject({ unlink_reason: "identity_changed" });
    expect(t.contact_links[1].unlinked_at).toBeNull();
    expect(events.linked).toEqual([{ id: "l1", kind: "unlinked", reason: "identity_changed" }]);
    expect(await handleIdentityMismatch(db, "h-outra")).toMatchObject({ unlinked: 0 });
    expect(failureReason("137000")).toContain("vínculo com a conta foi desfeito");
  });
});

describe("a volta aos lembretes pelo chat", () => {
  it("o pedido escrito pela pessoa, sem negação", () => {
    for (const yes of ["quero voltar a receber os lembretes", "Ativa os lembretes de novo, por favor", "pode voltar a me mandar lembrete?", "queria receber os lembretes das consultas"]) expect(isReminderReturnRequest(yes), yes).toBe(true);
    for (const no of ["não quero mais lembretes", "parar os lembretes", "SAIR", "quero marcar uma consulta", "cancela os lembretes", "lembrete", `quero voltar a receber os lembretes ${"x".repeat(200)}`]) expect(isReminderReturnRequest(no), no).toBe(false);
    expect(remindOfferText("Clínica Sol")).toContain("lembretes e avisos da Clínica Sol");
  });

  it("o Sim desfaz o descadastro de lembretes; o de tudo vira só de promoções; o do titular continua", async () => {
    const target = { channel: "whatsapp" as const, scope: "waba:W1", contact: "5521999990000" };
    const hash = contactHash("whatsapp", target.contact);
    const row = (id: number, kind: string, reason = "opt_out") => ({ id, contact_hash: hash, channel: "whatsapp", scope: "waba:W1", kind, reason, source: "chat", revoked_at: null });
    const t: Record<string, MemRow[]> = { suppressions: [row(1, "utility")] };
    const db = memoryDb(t);
    expect(await remindersStopped(db, target)).toBe(true);
    expect(await returnToReminders(db, target)).toBe(true);
    expect(t.suppressions[0]).toMatchObject({ revoke_source: "chat:volta_lembretes" });
    expect(await remindersStopped(db, target)).toBe(false);
    expect(events.consent).toEqual([{ type: "utility", granted: true }]);

    events.consent.length = 0;
    const all: Record<string, MemRow[]> = { suppressions: [row(2, "all")] };
    const db2 = memoryDb(all);
    await returnToReminders(db2, target);
    expect((await activeSuppressions(db2, target)).map((s) => s.kind)).toEqual(["marketing"]);
    // o resto (promoções paradas) não sai como descadastro novo; só os lembretes voltam
    expect(events.consent).toEqual([{ type: "utility", granted: true }]);

    const erasure: Record<string, MemRow[]> = { suppressions: [row(3, "all", "erasure")] };
    const db3 = memoryDb(erasure);
    expect(await remindersStopped(db3, target)).toBe(false);
    expect(await returnToReminders(db3, target)).toBe(false);
    expect(erasure.suppressions[0].revoked_at).toBeNull();
  });
});
