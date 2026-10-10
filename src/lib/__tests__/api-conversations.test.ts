import { describe, expect, it } from "vitest";
import { API_PAUSE_MAX_MINUTES, pausePlan, pendingQuestion } from "../api-pause";
import { conversationStatus, decodeCursor, encodeCursor, messageObject, messageStatus, pageLimit, statusFilter } from "../api-conversations";
import { decideMode, type ModeFacts } from "../conversation-mode";
import { apiPauseActive } from "../presence";
import { ApiError } from "../api-v1";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const iso = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

describe("pausa da IA pela integração (C pública, parte 3a)", () => {
  it("sem minutes: 24 horas renováveis; com minutes: de 1 a 10.080, sem renovar", () => {
    expect(pausePlan(undefined, NOW)).toEqual({ until: iso(24 * 60), renews: true });
    expect(pausePlan(30, NOW)).toEqual({ until: iso(30), renews: false });
    expect(pausePlan(API_PAUSE_MAX_MINUTES, NOW)).toEqual({ until: iso(10_080), renews: false });
    for (const bad of [0, 10_081, 1.5, "10", -5]) expect(pausePlan(bad, NOW)).toHaveProperty("error");
  });

  it("a pausa vale até o prazo", () => {
    expect(apiPauseActive(iso(1), NOW)).toBe(true);
    expect(apiPauseActive(iso(-1), NOW)).toBe(false);
    expect(apiPauseActive(null, NOW)).toBe(false);
  });

  it("na regra de estados é o degrau 3: a IA não responde, a equipe não é avisada e dá para enviar", () => {
    const normal: ModeFacts = { channel: "whatsapp", channelDisconnected: false, metaOrder: false, whatsappDisabled: false, metaPaymentIssue: false, boavozSuspended: false, humanInConversation: false, apiPaused: false, botPaused: false, botPauseNotify: false, humanOnly: null, coexistence: false };
    expect(decideMode({ ...normal, apiPaused: true })).toMatchObject({ step: 3, reason: "IA pausada pela integração", aiResponds: false, canSend: true, handoff: false, notice: null });
    // a pausa vem antes do bot pausado e do modo só humano; a equipe na conversa tem o motivo dela
    expect(decideMode({ ...normal, apiPaused: true, botPaused: true, humanOnly: "quota_exceeded" })).toMatchObject({ step: 3 });
    expect(decideMode({ ...normal, apiPaused: true, humanInConversation: true }).reason).toBe("equipe na conversa");
    // suspensão pela BoaVoz continua vencendo
    expect(decideMode({ ...normal, apiPaused: true, boavozSuspended: true })).toMatchObject({ step: 2 });
  });

  it("a IA responde a pergunta pendente só se ela é do contato, pelo canal, recente, com texto e não é SAIR", () => {
    const q = { role: "user", content: "qual o horário?", inbound_key: "abc", created_at: iso(-60), deleted_at: null };
    expect(pendingQuestion(q, NOW)).toBe(true);
    expect(pendingQuestion({ ...q, role: "agent" }, NOW)).toBe(false);
    expect(pendingQuestion({ ...q, inbound_key: null }, NOW)).toBe(false);
    expect(pendingQuestion({ ...q, created_at: iso(-25 * 60) }, NOW)).toBe(false);
    expect(pendingQuestion({ ...q, deleted_at: iso(-1) }, NOW)).toBe(false);
    expect(pendingQuestion({ ...q, content: "📷 (foto)" }, NOW)).toBe(false);
    expect(pendingQuestion({ ...q, content: "(figurinha)" }, NOW)).toBe(false);
    expect(pendingQuestion({ ...q, content: "SAIR" }, NOW)).toBe(false);
    expect(pendingQuestion(null, NOW)).toBe(false);
  });
});

describe("conversas e mensagens pela API", () => {
  const base = { handoff_requested_at: null, takeover_at: null, handled_at: null, ai_paused_until: null };

  it("status: equipe vence a pausa; pausa vencida volta a ser da IA", () => {
    expect(conversationStatus(base, NOW)).toBe("ai");
    expect(conversationStatus({ ...base, ai_paused_until: iso(10) }, NOW)).toBe("ai_paused");
    expect(conversationStatus({ ...base, ai_paused_until: iso(-10) }, NOW)).toBe("ai");
    expect(conversationStatus({ ...base, takeover_at: iso(-5), ai_paused_until: iso(10) }, NOW)).toBe("human");
    expect(conversationStatus({ ...base, handoff_requested_at: iso(-5) }, NOW)).toBe("waiting_human");
    expect(conversationStatus({ ...base, handoff_requested_at: iso(-5), handled_at: iso(-1) }, NOW)).toBe("ai");
  });

  it("o filtro de status vira grupos lógicos (um or só por consulta)", () => {
    const now = iso(0);
    expect(statusFilter(null, now)).toEqual([]);
    expect(statusFilter("human", now)).toEqual(["takeover_at.not.is.null", "handled_at.is.null"]);
    expect(statusFilter("ai_paused", now)).toContain(`ai_paused_until.gt."${now}"`);
    expect(statusFilter("ai", now).join(",")).toContain("or(handoff_requested_at.is.null,handled_at.not.is.null)");
  });

  it("cursor opaco ida e volta; cursor estranho dá 400", () => {
    expect(decodeCursor(encodeCursor(["2026-10-10T12:00:00.123456+00:00", "c1"]), 2)).toEqual(["2026-10-10T12:00:00.123456+00:00", "c1"]);
    expect(decodeCursor(null, 2)).toBeNull();
    expect(() => decodeCursor(encodeCursor(["só um"]), 2)).toThrow(ApiError);
  });

  it("limit: padrão 50, de 1 a 100", () => {
    expect(pageLimit(null)).toBe(50);
    expect(pageLimit("100")).toBe(100);
    for (const bad of ["0", "101", "2.5", "x"]) expect(() => pageLimit(bad)).toThrow(ApiError);
  });

  it("status da mensagem: recebida, o mais avançado do canal, enviada no site e pendente no canal", () => {
    expect(messageStatus({ role: "user", failed_at: null, channel_msg_id: null, delivery_status: null, error_code: null }, "whatsapp")).toBe("received");
    expect(messageStatus({ role: "assistant", failed_at: iso(-1), channel_msg_id: null, delivery_status: null, error_code: null }, "whatsapp")).toBe("failed");
    expect(messageStatus({ role: "assistant", failed_at: null, channel_msg_id: "x", delivery_status: "read", error_code: null }, "whatsapp")).toBe("read");
    expect(messageStatus({ role: "assistant", failed_at: null, channel_msg_id: "x", delivery_status: null, error_code: null }, "whatsapp")).toBe("sent");
    expect(messageStatus({ role: "assistant", failed_at: null, channel_msg_id: null, delivery_status: null, error_code: null }, "widget")).toBe("sent");
    expect(messageStatus({ role: "assistant", failed_at: null, channel_msg_id: null, delivery_status: null, error_code: null }, "instagram")).toBe("pending");
    expect(messageStatus({ role: "agent", failed_at: null, channel_msg_id: null, delivery_status: null, error_code: "uncertain" }, "whatsapp")).toBe("uncertain");
  });

  it("mensagem no formato da API: desfeita sem texto; de quem é e o atendente", () => {
    const m = { id: 7, conversation_id: "c1", role: "agent" as const, content: "Seu pedido saiu", author: "zendesk", author_type: "api" as const, author_id: null, author_display_name: "Ana", channel_msg_id: "w1", delivery_status: "delivered", blocked_reason: null, failed_at: null, error_code: null, deleted_at: null, edited_at: null, created_at: iso(0) };
    expect(messageObject(m, "whatsapp")).toMatchObject({ id: "msg_7", conversation_id: "conv_c1", direction: "outbound", source: "api", text: "Seu pedido saiu", status: "delivered", agent: { type: "api", display_name: "Ana", sender: "zendesk" } });
    expect(messageObject({ ...m, role: "user", author: null, author_type: null, deleted_at: iso(1) }, "instagram")).toMatchObject({ direction: "inbound", source: "contact", text: null, deleted: true, agent: null, status: "received" });
  });
});
