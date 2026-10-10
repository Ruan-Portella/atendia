import { describe, expect, it } from "vitest";
import { sourceOf } from "../message-events";
import { HIGH_VOLUME_EVENTS, WEBHOOK_EVENTS, WEBHOOK_EVENT_GROUPS, eventId } from "../webhooks";

describe("eventos de mensagem nos webhooks", () => {
  it("de quem é a mensagem enviada (source)", () => {
    expect(sourceOf({ author_type: "ai" })).toBe("ai");
    expect(sourceOf({ author_type: "system", author: "sistema" })).toBe("ai");
    expect(sourceOf({ author_type: "agency_member", author: "ana@agencia.com" })).toBe("human");
    expect(sourceOf({ author_type: "client_member" })).toBe("human");
    expect(sourceOf({ author_type: "api" })).toBe("api");
    expect(sourceOf({ author_type: "phone_app", author: "celular" })).toBe("phone_app");
    expect(sourceOf({ author_type: "system", author: "campanha" })).toBe("campaign");
  });

  it("todo evento aparece num grupo do editor; message.status vem desmarcado", () => {
    expect(WEBHOOK_EVENT_GROUPS.flatMap((g) => g.events).sort()).toEqual([...WEBHOOK_EVENTS].sort());
    expect(HIGH_VOLUME_EVENTS).toEqual(["message.status"]);
  });

  it("o id do evento sai do fato: status pela mensagem e pelo status, falha pelo código", () => {
    expect(eventId("message.status", "42:delivered")).toBe(eventId("message.status", "42:delivered"));
    expect(eventId("message.status", "42:delivered")).not.toBe(eventId("message.status", "42:read"));
    expect(eventId("message.failed", "42:131026")).not.toBe(eventId("message.failed", "42:131049"));
  });
});
