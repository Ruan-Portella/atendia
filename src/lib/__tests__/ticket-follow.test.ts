import { describe, expect, it, vi } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import type { Attendant } from "../authors";

// quem abriu fica no lead (camada própria, leads.ts): aqui só o e-mail de quem abriu
const leads = vi.hoisted(() => ({ byConv: new Map<string, Array<{ name: string | null; email: string | null }>>() }));
vi.mock("../leads", async (orig) => ({ ...(await orig<typeof import("../leads")>()), leadsOfConversation: vi.fn(async (_db: unknown, id: string) => leads.byConv.get(id) ?? []) }));

const { addTicketMessage, afterTicketReply, markTicketInProgress, setTicketStatus, ticketByProtocol, ticketReplyEmail, ticketThread } = await import("../ticket-follow");

const at = "2026-10-21T15:00:00Z";
const vivi: Attendant = { type: "agency_member", id: "vivi", name: "Vivi", legacy: "agência" };

function setup(conv: MemRow = {}) {
  const tables: Record<string, MemRow[]> = {
    conversations: [{ id: "c1", bot_id: "b1", channel: "widget", ticket_protocol: "K7Q2-9XMP", ticket_status: "aberto", ticket_subject: "Financeiro", handled_at: null, takeover_at: null, assigned_to_id: null, handoff_requested_at: at, ...conv }],
    messages: [
      { id: 1, conversation_id: "c1", role: "user", content: "O boleto veio errado.", created_at: at, blocked_reason: null, failed_at: null, deleted_at: null },
      { id: 2, conversation_id: "c1", role: "agent", content: "Oi! Aqui é Vivi.\n\nVou corrigir.", announce_chars: 18, author_display_name: "Vivi", created_at: at, blocked_reason: null, failed_at: null, deleted_at: null },
    ],
  };
  leads.byConv.set("c1", [{ name: "Maria Souza", email: "Maria@Exemplo.com" }]);
  return { tables, db: memoryDb(tables) };
}

describe("acompanhar o chamado", () => {
  it("só com o protocolo e o e-mail de quem abriu (sem diferença de maiúsculas)", async () => {
    const { db } = setup();
    expect((await ticketByProtocol(db, "b1", "K7Q2-9XMP", " maria@exemplo.com "))?.id).toBe("c1");
    expect(await ticketByProtocol(db, "b1", "K7Q2-9XMP", "outra@exemplo.com")).toBeNull();
    expect(await ticketByProtocol(db, "b2", "K7Q2-9XMP", "maria@exemplo.com")).toBeNull();
  });

  it("as mensagens: as dela e as da equipe, sem o anúncio de entrada", async () => {
    const { db } = setup();
    expect(await ticketThread(db, "c1")).toEqual([
      { from: "cliente", name: null, text: "O boleto veio errado.", at },
      { from: "equipe", name: "Vivi", text: "Vou corrigir.", at },
    ]);
  });

  it("escrever de novo: aguardando o cliente volta para quem atende; resolvido reabre como pedido novo", async () => {
    const waiting = setup({ ticket_status: "aguardando_cliente", assigned_to_id: "vivi", takeover_at: at });
    const t1 = (await ticketByProtocol(waiting.db, "b1", "K7Q2-9XMP", "maria@exemplo.com"))!;
    expect((await addTicketMessage(waiting.db, t1, "Ainda não chegou.")).ok).toBe(true);
    expect(waiting.tables.conversations[0]).toMatchObject({ ticket_status: "em_andamento", assigned_to_id: "vivi" });
    expect(waiting.tables.messages.at(-1)).toMatchObject({ role: "user", content: "Ainda não chegou." });

    const done = setup({ ticket_status: "resolvido", handled_at: at, assigned_to_id: null });
    const t2 = (await ticketByProtocol(done.db, "b1", "K7Q2-9XMP", "maria@exemplo.com"))!;
    await addTicketMessage(done.db, t2, "Voltou a dar erro.", new Date("2026-10-22T10:00:00Z"));
    expect(done.tables.conversations[0]).toMatchObject({ ticket_status: "aberto", handled_at: null, ticket_resolved_at: null, needs_human: true, handoff_requested_at: "2026-10-22T10:00:00.000Z" });
    expect((await addTicketMessage(done.db, t2, " ")).ok).toBe(false);
  });
});

describe("o status pela equipe", () => {
  it("resolvido encerra o atendimento da conversa; outro status reabre; só em chamado", async () => {
    const { db, tables } = setup({ takeover_at: at, assigned_to_id: "vivi" });
    const r = await setTicketStatus(db, "c1", "resolvido", new Date(at));
    expect(r).toMatchObject({ ok: true, before: "aberto" });
    expect(tables.conversations[0]).toMatchObject({ ticket_status: "resolvido", ticket_resolved_at: "2026-10-21T15:00:00.000Z", handled_at: "2026-10-21T15:00:00.000Z", takeover_at: null, assigned_to_id: null });
    await setTicketStatus(db, "c1", "em_andamento", new Date("2026-10-21T16:00:00Z"));
    expect(tables.conversations[0]).toMatchObject({ ticket_status: "em_andamento", ticket_resolved_at: null, handled_at: null, needs_human: true });
    expect((await setTicketStatus(db, "c1", "fechado")).ok).toBe(false);
    const plain = memoryDb({ conversations: [{ id: "c2", ticket_protocol: null }] });
    expect((await setTicketStatus(plain, "c2", "resolvido")).message).toMatch(/não é um chamado/);
  });

  it("assumir o aberto deixa em andamento; responder deixa aguardando o cliente", async () => {
    const { db, tables } = setup();
    await markTicketInProgress(db, "c1");
    expect(tables.conversations[0].ticket_status).toBe("em_andamento");
    await afterTicketReply(db, "c1", "Vou corrigir.", vivi);
    expect(tables.conversations[0].ticket_status).toBe("aguardando_cliente");
  });
});

describe("o e-mail da resposta", () => {
  it("o primeiro nome, quem respondeu, o protocolo, o assunto e o link para acompanhar", () => {
    const m = ticketReplyEmail({ protocol: "K7Q2-9XMP", subject: "Financeiro", requester: "Maria Souza", agent: "Vivi", text: "Vou corrigir o boleto hoje.", company: "Loja da Ana", signature: "Loja da Ana\nAgência Sass", link: "https://app/w/k?chamado=K7Q2-9XMP" });
    expect(m.subject).toBe("Resposta ao seu chamado K7Q2-9XMP · Loja da Ana");
    expect(m.text).toContain("Olá, Maria!");
    expect(m.text).toContain("Vivi respondeu ao seu chamado K7Q2-9XMP (Financeiro):");
    expect(m.text).toContain("Vou corrigir o boleto hoje.");
    expect(m.text).toContain("https://app/w/k?chamado=K7Q2-9XMP");
  });
});
