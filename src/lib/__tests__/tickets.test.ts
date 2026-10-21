import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { TICKET_FILE_MAX_BYTES, assignProtocol, newProtocol, parseProtocol, parseTicketForm, ticketFileMime, ticketFormOf, ticketInputProblem, type TicketForm } from "../tickets";
import { openTicket } from "../ticket-open";
import type { BotRow } from "../chat";

// o lead tem a camada própria (leads.ts, cifra e mescla por contato): aqui só confere o que chega nela
const savedLeads = vi.hoisted(() => [] as Array<Record<string, unknown>>);
// o anexo vai para o armazenamento cifrado (attachments.ts): aqui só confere o que chega nele
const stored = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("../attachments", async (orig) => ({
  ...(await orig<typeof import("../attachments")>()),
  storeAttachment: vi.fn(async (_db: unknown, a: Record<string, unknown>) => (stored.push(a), "a1b2c3")),
}));
vi.mock("../leads", async (orig) => ({
  ...(await orig<typeof import("../leads")>()),
  saveLead: vi.fn(async (_db: unknown, lead: Record<string, unknown>) => {
    savedLeads.push(lead);
    return { id: "lead1" };
  }),
}));

const form: TicketForm = { enabled: true, mode: "aba", phone: "opcional", subjects: ["Financeiro", "Troca"] };
const ok = { name: "Maria Souza", email: "maria@exemplo.com", phone: null, subject: "Financeiro", description: "O boleto de outubro veio com o valor errado." };

describe("o formulário de chamado do chatbot", () => {
  it("guardado: desligado é null; ligado vem limpo", () => {
    expect(ticketFormOf(null)).toBeNull();
    expect(ticketFormOf({ enabled: false, subjects: ["A"] })).toBeNull();
    expect(ticketFormOf({ enabled: true, mode: "x", phone: "y", subjects: [" Financeiro ", "", 3] })).toEqual({ enabled: true, mode: "aba", phone: "nao", subjects: ["Financeiro"], attachment: false });
    expect(ticketFormOf({ enabled: true, subjects: [], attachment: true })?.attachment).toBe(true);
  });

  it("os campos do painel: assuntos um por linha, sem repetir; desligado guarda os assuntos", () => {
    expect(parseTicketForm({ ticket_enabled: "on", ticket_mode: "sozinho", ticket_phone: "obrigatorio", ticket_subjects: "Financeiro\nfinanceiro\n\nTroca" })).toEqual({ value: { enabled: true, mode: "sozinho", phone: "obrigatorio", subjects: ["financeiro", "Troca"], attachment: false } });
    expect(parseTicketForm({ ticket_enabled: "on", ticket_attachment: "on", ticket_subjects: "" })).toMatchObject({ value: { enabled: true, attachment: true } });
    expect(parseTicketForm({ ticket_subjects: "" })).toEqual({ value: null });
    expect(parseTicketForm({ ticket_subjects: "Financeiro" })).toEqual({ value: { enabled: false, mode: "aba", phone: "nao", subjects: ["Financeiro"] } });
    expect(parseTicketForm({ ticket_enabled: "on", ticket_subjects: Array.from({ length: 11 }, (_, i) => `A${i}`).join("\n") })).toHaveProperty("error");
    expect(parseTicketForm({ ticket_enabled: "on", ticket_subjects: "x".repeat(41) })).toHaveProperty("error");
  });
});

describe("protocolo", () => {
  it("8 letras e números sem os que confundem, em dois blocos; o digitado é normalizado", () => {
    let i = 0;
    expect(newProtocol(() => i++ % 31)).toBe("2345-6789");
    expect(newProtocol()).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(parseProtocol(" k7q2 9xmp ")).toBe("K7Q2-9XMP");
    expect(parseProtocol("K7Q2-9XM0")).toBeNull();
    expect(parseProtocol("abc")).toBeNull();
  });

  it("protocolo repetido (o índice único recusa): tenta outro", async () => {
    const tables: Record<string, MemRow[]> = { conversations: [{ id: "c1" }] };
    let calls = 0;
    const db = memoryDb(tables);
    const realFrom = db.from.bind(db);
    // a primeira gravação falha como o índice único do banco
    (db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = realFrom(t) as unknown as { update: (p: MemRow) => unknown };
      const update = q.update.bind(q);
      q.update = (p: MemRow) => (calls++ === 0 ? { eq: async () => ({ error: { message: "duplicate key value violates unique constraint" } }) } : update(p));
      return q;
    };
    const protocol = await assignProtocol(db, "c1", { subject: null, at: "2026-10-21T15:00:00Z" });
    expect(calls).toBe(2);
    expect(tables.conversations[0]).toMatchObject({ ticket_protocol: protocol, ticket_status: "aberto" });
  });
});

describe("o que a pessoa preenche", () => {
  it("nome, e-mail, telefone conforme o chatbot, assunto da lista e descrição", () => {
    expect(ticketInputProblem(form, ok)).toBeNull();
    expect(ticketInputProblem(form, { ...ok, name: "M" })).toMatch(/nome/);
    expect(ticketInputProblem(form, { ...ok, email: "maria" })).toMatch(/e-mail/);
    expect(ticketInputProblem({ ...form, phone: "obrigatorio" }, ok)).toMatch(/telefone/i);
    expect(ticketInputProblem(form, { ...ok, phone: "123" })).toMatch(/Telefone inválido/);
    expect(ticketInputProblem(form, { ...ok, subject: "Outro" })).toMatch(/assunto/);
    expect(ticketInputProblem({ ...form, subjects: [] }, { ...ok, subject: null })).toBeNull();
    expect(ticketInputProblem(form, { ...ok, description: "curto" })).toMatch(/pelo menos 10/);
  });
});

describe("abrir o chamado", () => {
  // o telefone vira hash (contacts.typedPhoneHash)
  beforeEach(() => vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16"));
  afterEach(() => vi.unstubAllEnvs());

  it("conversa do site com protocolo, a descrição, o lead e o pedido no setor do assunto", async () => {
    const tables: Record<string, MemRow[]> = {
      bots: [{ id: "b1", agency_id: "ag1", client_id: "c1", name: "Lia", client_name: "Loja", human_handoff: null, lead_capture: null }],
      sectors: [{ id: "s1", agency_id: "ag1", client_id: "c1", name: "Financeiro", hours: null, distribution: "manual", position: 0 }],
      sector_members: [],
      clients: [{ id: "c1", holidays: [] }],
      conversations: [],
      messages: [],
      routine_runs: [],
      webhooks: [],
    };
    const bot = tables.bots[0] as unknown as BotRow;
    const r = await openTicket(memoryDb(tables), bot, form, { ...ok, phone: "(21) 99999-0000", visitorId: "v1" }, new Date("2026-10-21T15:00:00Z"));
    expect(r.protocol).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    const conv = tables.conversations[0];
    expect(conv).toMatchObject({ id: r.conversationId, bot_id: "b1", channel: "widget", visitor_id: "v1", ticket_protocol: r.protocol, ticket_status: "aberto", ticket_subject: "Financeiro", sector_id: "s1", needs_human: true });
    expect(conv.handoff_requested_at).toBeTruthy();
    expect(tables.messages.map((m) => [m.role, m.content])).toEqual([["user", ok.description]]);
    expect(savedLeads).toHaveLength(1);
    expect(savedLeads[0]).toMatchObject({ botId: "b1", conversationId: r.conversationId, name: "Maria Souza", email: "maria@exemplo.com", phone: "(21) 99999-0000", channel: "widget" });
    expect(savedLeads[0].phoneHash).toBeTruthy();
    expect(String(savedLeads[0].notes)).toContain(r.protocol);
  });
});

describe("o anexo do chamado (leva das sobras, parte 4)", () => {
  it("só foto (JPEG, PNG, WEBP) ou PDF, pelos primeiros bytes", () => {
    expect(ticketFileMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, ...new Array(20).fill(0)]))).toBe("application/pdf");
    expect(ticketFileMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(1)]))).toBe("image/jpeg");
    // HTML disfarçado de PDF, e um executável: recusados
    expect(ticketFileMime(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(ticketFileMime(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...new Array(20).fill(0)]))).toBeNull();
    expect(TICKET_FILE_MAX_BYTES).toBe(4 * 1024 * 1024);
  });

  it("o arquivo fica com a descrição, no armazenamento privado, e o ticket.created leva o id", async () => {
    stored.length = 0;
    const tables: Record<string, MemRow[]> = {
      bots: [{ id: "b1", agency_id: "ag1", client_id: "c1", name: "Lia", client_name: "Loja", human_handoff: null, lead_capture: null }],
      sectors: [],
      sector_members: [],
      clients: [{ id: "c1", holidays: [] }],
      conversations: [],
      messages: [],
      routine_runs: [],
      webhooks: [],
    };
    const bot = tables.bots[0] as unknown as BotRow;
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const r = await openTicket(memoryDb(tables), bot, { ...form, attachment: true }, { ...ok, visitorId: "v1", attachment: { data, mime: "application/pdf", filename: "boleto.pdf" } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ botId: "b1", conversationId: r.conversationId, channel: "widget", mime: "application/pdf", filename: "boleto.pdf", maxBytes: TICKET_FILE_MAX_BYTES });
    expect(stored[0].messageId).toBe(tables.messages[0].id);
  });
});
