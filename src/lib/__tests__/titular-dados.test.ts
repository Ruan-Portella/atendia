import { describe, expect, it } from "vitest";
import { memoryDb } from "../memory-db";
import { personExportDoc } from "../titular-dados";

/* Pedido de acesso do titular (relatório de segurança de 23/10/2026, M11): só os dados da pessoa. */

describe("exportar os dados de uma pessoa", () => {
  it("as fichas, os leads e as conversas da pessoa, sem as de outras", async () => {
    const db = memoryDb({
      contacts: [
        { id: "k1", bot_id: "b1", channel: "whatsapp", name: "Ana", email: "ana@x.com", created_at: "2026-10-01T10:00:00Z" },
        { id: "k2", bot_id: "b1", channel: "whatsapp", name: "Bia", email: "bia@x.com", created_at: "2026-10-01T10:00:00Z" },
      ],
      leads: [
        { id: "l1", bot_id: "b1", name: "Ana", email: "ana@x.com", conversation_id: "c1", requests: [], created_at: "2026-10-01T10:05:00Z" },
        { id: "l2", bot_id: "b1", name: "Bia", email: "bia@x.com", conversation_id: "c3", requests: [], created_at: "2026-10-01T10:05:00Z" },
      ],
      conversations: [
        { id: "c1", bot_id: "b1", channel: "widget", started_at: "2026-10-01T10:00:00Z" },
        { id: "c2", bot_id: "b1", channel: "whatsapp", started_at: "2026-10-02T10:00:00Z" },
        { id: "c3", bot_id: "b1", channel: "widget", started_at: "2026-10-03T10:00:00Z" },
      ],
      messages: [
        { id: 1, conversation_id: "c1", role: "user", content: "oi, sou a Ana", created_at: "2026-10-01T10:00:01Z" },
        { id: 2, conversation_id: "c1", role: "assistant", content: "Olá, Ana!", created_at: "2026-10-01T10:00:02Z" },
        { id: 3, conversation_id: "c3", role: "user", content: "sou a Bia", created_at: "2026-10-03T10:00:01Z" },
      ],
    });
    const doc = await personExportDoc(db, {
      match: { byEmail: true, botIds: ["b1"], contactIds: ["k1"], leads: [{ id: "l1", conversation_id: "c1" }], leadConvs: ["c1"], conversationIds: ["c1", "c2"] },
      bots: [{ id: "b1", name: "Assistente da Pizzaria" }],
      who: "ana@x.com",
      now: new Date("2026-10-24T12:00:00Z"),
    });
    expect(doc.pessoa).toBe("ana@x.com");
    expect((doc.fichas as Array<{ id: string }>).map((f) => f.id)).toEqual(["k1"]);
    expect((doc.leads as Array<{ nome: string }>).map((l) => l.nome)).toEqual(["Ana"]);
    const conversas = doc.conversas as Array<{ conversa: string; mensagens: Array<{ de: string; texto: string }> }>;
    expect(conversas.map((c) => c.conversa)).toEqual(["c1", "c2"]);
    expect(conversas[0].mensagens).toEqual([
      { data: "2026-10-01T10:00:01Z", de: "pessoa", texto: "oi, sou a Ana" },
      { data: "2026-10-01T10:00:02Z", de: "assistente", texto: "Olá, Ana!" },
    ]);
    expect(JSON.stringify(doc)).not.toContain("Bia");
  });
});
