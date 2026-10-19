import { describe, expect, it } from "vitest";
import { routineEventData, sourceOf } from "../message-events";
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

describe("eventos de roteiro nos webhooks", () => {
  const run = { id: "r-1", routineId: "rot-1", routineName: "Segunda via", startedBy: "palavra" as const, startedAt: "2026-10-19T12:00:00.000Z", endedAt: "2026-10-19T12:03:00.000Z", stepIndex: 2, stepsTotal: 3 };

  it("routine.completed: o roteiro, como começou e o passo em que acabou (os dados que ele juntou não vão)", () => {
    expect(routineEventData(run, null)).toEqual({
      routine: { id: "rtn_rot-1", name: "Segunda via" },
      run: { id: "run_r-1", started_by: "keyword", started_at: "2026-10-19T12:00:00.000Z", ended_at: "2026-10-19T12:03:00.000Z", step: 2, steps_total: 3 },
    });
  });

  it("routine.abandoned leva o motivo; roteiro apagado vai sem id", () => {
    expect(routineEventData({ ...run, routineId: null, startedBy: "ia" }, "idle")).toEqual({ routine: { id: null, name: "Segunda via" }, run: { ...routineEventData(run, null).run as object, started_by: "ai" }, reason: "idle" });
    expect(WEBHOOK_EVENT_GROUPS.find((g) => g.label === "Roteiros")?.events).toEqual(["routine.completed", "routine.abandoned"]);
  });
});
