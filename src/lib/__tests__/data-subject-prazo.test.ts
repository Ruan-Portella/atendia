import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "../memory-db";
import { remindDueRequests } from "../data-subject";

/* Pedido do titular perto do prazo (relatório de segurança de 23/10/2026): o dono fica sabendo. */

describe("prazo dos pedidos do titular", () => {
  it("um e-mail por conta, com os vencidos e os que vencem em até 2 dias", async () => {
    const now = new Date("2026-10-24T12:00:00Z");
    const db = memoryDb({
      data_subject_requests: [
        { id: "r1", agency_id: "A", status: "aguardando", due_at: "2026-10-20T12:00:00Z" },
        { id: "r2", agency_id: "A", status: "aguardando", due_at: "2026-10-25T12:00:00Z" },
        { id: "r3", agency_id: "A", status: "aguardando", due_at: "2026-11-05T12:00:00Z" },
        { id: "r4", agency_id: "A", status: "executado", due_at: "2026-10-20T12:00:00Z" },
        { id: "r5", agency_id: "B", status: "aguardando", due_at: "2026-10-26T00:00:00Z" },
      ],
    });
    const notify = vi.fn(async () => true);
    expect(await remindDueRequests(db, { now, notify })).toBe(2);
    const calls = notify.mock.calls as unknown as Array<[string, string, string[]]>;
    const a = calls.find((c) => c[0] === "A")!;
    expect(a[2][0]).toBe("Pedidos de exclusão de dados: 1 pedido venceu e 1 pedido vence em até 2 dias.");
    const b = calls.find((c) => c[0] === "B")!;
    expect(b[2][0]).toBe("Pedidos de exclusão de dados: 1 pedido vence em até 2 dias.");
  });
});
