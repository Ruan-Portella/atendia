import { describe, expect, it } from "vitest";
import { conversationState, isResumable, lastSeen } from "../presence";

const now = Date.UTC(2026, 8, 22, 12, 0, 0);
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

describe("conversationState", () => {
  it("widget deu sinal há pouco: visitante online", () => {
    expect(conversationState({ last_message_at: ago(3600), visitor_seen_at: ago(20) }, now)).toBe("online");
  });
  it("sem sinal, mas falou há menos de 30 min: ativa", () => {
    expect(conversationState({ last_message_at: ago(10 * 60), visitor_seen_at: ago(5 * 60) }, now)).toBe("active");
  });
  it("sem sinal e sem mensagem há mais de 30 min: encerrada", () => {
    expect(conversationState({ last_message_at: ago(31 * 60), visitor_seen_at: null }, now)).toBe("closed");
  });
});

describe("isResumable (F5 continua a conversa)", () => {
  it("até 6 horas sem mensagem: retoma", () => {
    expect(isResumable(ago(5 * 3600), now)).toBe(true);
  });
  it("depois disso: conversa nova", () => {
    expect(isResumable(ago(7 * 3600), now)).toBe(false);
  });
});

describe("lastSeen", () => {
  it("usa o mais recente entre sinal do widget e última mensagem", () => {
    expect(lastSeen({ last_message_at: ago(600), visitor_seen_at: ago(60) })).toBe(ago(60));
    expect(lastSeen({ last_message_at: ago(60), visitor_seen_at: ago(600) })).toBe(ago(60));
    expect(lastSeen({ last_message_at: ago(60), visitor_seen_at: null })).toBe(ago(60));
  });
});
