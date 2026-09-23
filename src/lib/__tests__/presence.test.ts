import { describe, expect, it } from "vitest";
import { canTakeOver, conversationState, isResumable, lastSeen, whatsappWindowOpen } from "../presence";

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

describe("canTakeOver", () => {
  it("site: online ou falou há menos de 30 min", () => {
    expect(canTakeOver({ last_message_at: ago(3 * 3600), visitor_seen_at: ago(10) }, now)).toBe(true);
    expect(canTakeOver({ last_message_at: ago(10 * 60) }, now)).toBe(true);
    expect(canTakeOver({ last_message_at: ago(45 * 60) }, now)).toBe(false);
  });
  it("WhatsApp: dentro da janela de 24 h da Meta", () => {
    expect(canTakeOver({ channel: "whatsapp", last_message_at: ago(5 * 3600) }, now)).toBe(true);
    expect(canTakeOver({ channel: "whatsapp", last_message_at: ago(25 * 3600) }, now)).toBe(false);
  });
});

describe("whatsappWindowOpen", () => {
  it("conta da última mensagem do contato, não da nossa", () => {
    // mandamos um modelo agora, mas o cliente não escreve há 2 dias: janela fechada
    expect(whatsappWindowOpen({ channel: "whatsapp", last_message_at: ago(10), last_user_at: ago(48 * 3600) }, now)).toBe(false);
    expect(whatsappWindowOpen({ channel: "whatsapp", last_message_at: ago(10), last_user_at: ago(3600) }, now)).toBe(true);
    // conversa aberta pelo painel, sem mensagem do contato ainda
    expect(canTakeOver({ channel: "whatsapp", last_message_at: ago(10), last_user_at: ago(30 * 3600) }, now)).toBe(false);
    // null = o contato nunca escreveu (aberta por nós com modelo): fechada mesmo com mensagem nossa agora
    expect(whatsappWindowOpen({ channel: "whatsapp", last_message_at: ago(10), last_user_at: null }, now)).toBe(false);
    // ausente = não sabemos: usa a última mensagem da conversa
    expect(whatsappWindowOpen({ channel: "whatsapp", last_message_at: ago(3600) }, now)).toBe(true);
  });
});
