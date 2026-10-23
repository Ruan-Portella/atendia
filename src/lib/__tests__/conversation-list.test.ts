import { describe, expect, it } from "vitest";
import { isConversationFilter, listStatus } from "../conversation-list";

describe("a situação na lista de conversas", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const base = { handoff_requested_at: null, takeover_at: null, handled_at: null, handoff_urgent_at: null, last_contact_at: null, last_reply_at: null, last_message_at: "2026-10-23T11:00:00Z", assigned_to_name: null };

  it("o atendimento aberto vem antes da IA", () => {
    expect(listStatus({ ...base, handoff_requested_at: "2026-10-23T11:50:00Z", last_contact_at: "2026-10-23T11:50:00Z" }, now).label).toBe("Esperando a equipe");
    expect(listStatus({ ...base, handoff_requested_at: "2026-10-23T11:00:00Z", takeover_at: "2026-10-23T11:10:00Z", last_reply_at: "2026-10-23T11:55:00Z", assigned_to_name: "Ruan" }, now).label).toBe("Com Ruan");
  });

  it("sem atendimento: com a IA nas 24 horas depois da última mensagem do contato, depois encerrada", () => {
    expect(listStatus({ ...base, last_contact_at: "2026-10-23T08:00:00Z" }, now)).toMatchObject({ label: "Com a IA", tone: "brand" });
    expect(listStatus({ ...base, last_contact_at: "2026-10-21T08:00:00Z" }, now)).toMatchObject({ label: "Encerrada", tone: "neutral" });
    expect(listStatus({ ...base, handoff_requested_at: "2026-10-20T08:00:00Z", handled_at: "2026-10-20T09:00:00Z" }, now).label).toBe("Encerrada");
  });

  it("os filtros", () => {
    expect(isConversationFilter("esperando")).toBe(true);
    expect(isConversationFilter("widget")).toBe(true);
    expect(isConversationFilter("x")).toBe(false);
    expect(isConversationFilter(undefined)).toBe(false);
  });
});
