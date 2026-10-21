import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { resetWebhookCache } from "../message-events";
import type { Attendant } from "../authors";

// a Meta, os descadastros e a regra de estado simulados: o teste confere quando o aviso sai
const m = vi.hoisted(() => ({ list: vi.fn(), send: vi.fn(), create: vi.fn(), suppressions: vi.fn(), blocked: vi.fn(), emitted: [] as Array<{ type: string; data: Record<string, unknown> }>, leads: new Map<string, Array<{ name: string | null; email: string | null; phone: string | null }>>() }));
vi.mock("../whatsapp-templates", async (orig) => ({
  ...(await orig<typeof import("../whatsapp-templates")>()),
  loadTemplateChannel: vi.fn(async () => ({ waba_id: "w1", phone_number_id: "p1", access_token_enc: "x" })),
  listTemplates: m.list,
  sendTemplate: m.send,
  createTemplate: m.create,
}));
vi.mock("../suppression", async (orig) => ({ ...(await orig<typeof import("../suppression")>()), activeSuppressions: m.suppressions }));
vi.mock("../conversation-mode", async (orig) => ({ ...(await orig<typeof import("../conversation-mode")>()), sendBlockedReason: m.blocked }));
vi.mock("../leads", async (orig) => ({ ...(await orig<typeof import("../leads")>()), leadsOfConversation: vi.fn(async (_db: unknown, id: string) => m.leads.get(id) ?? []) }));
vi.mock("../webhooks", async (orig) => ({ ...(await orig<typeof import("../webhooks")>()), emitEvent: vi.fn(async (_db: unknown, e: { type: string; data: Record<string, unknown> }) => void m.emitted.push({ type: e.type, data: e.data })) }));

const { ensureTicketTemplate, notifyTicketByWhatsApp, ticketTemplateBody, ticketTemplateName } = await import("../ticket-whatsapp");
const { afterTicketReply, setTicketStatus } = await import("../ticket-follow");

const KEY = "ab12cd34ef56ab12cd34ef56";
const NAME = ticketTemplateName(KEY);
const vivi: Attendant = { type: "agency_member", id: "vivi", name: "Vivi", legacy: "agência" };

function db(extra: Record<string, MemRow[]> = {}) {
  return memoryDb({
    bots: [{ id: "b1", agency_id: "ag1", client_id: "c1", name: "Lia", public_key: KEY, client_name: "Loja da Ana", agency: null }],
    agencies: [{ id: "ag1", custom_domain: null }],
    webhooks: [{ id: "w1", agency_id: "ag1", active: true }],
    agency_packs: [{ agency_id: "ag1", pack: "integracoes", ends_at: null }],
    conversations: [{ id: "c1", bot_id: "b1", channel: "widget", contact_id: null, ticket_protocol: "K7Q2-9XMP", ticket_status: "em_andamento", ticket_subject: "Financeiro", ticket_whatsapp_at: "2026-10-21T15:00:00Z", handled_at: null }],
    ...extra,
  });
}

describe("o aviso da resposta pelo WhatsApp", () => {
  beforeEach(() => {
    m.list.mockResolvedValue([{ name: NAME, status: "APPROVED", category: "UTILITY", language: "pt_BR" }]);
    m.suppressions.mockResolvedValue([]);
    m.blocked.mockResolvedValue(null);
    m.send.mockResolvedValue({ messages: [{ id: "wamid" }] });
  });
  afterEach(() => {
    vi.clearAllMocks();
    m.emitted.length = 0;
    resetWebhookCache();
  });

  it("um modelo por chatbot, com o nome do negócio fixo, o nome e o protocolo", () => {
    expect(NAME).toBe("resposta_chamado_ab12cd34");
    expect(ticketTemplateBody("Loja {da} Ana")).toBe("Olá, {{1}}! A equipe de Loja da Ana respondeu ao seu chamado {{2}}. Toque no botão para ver a resposta e continuar o atendimento.");
  });

  it("sem o modelo, o BoaVoz cria (de utilidade, com o botão para acompanhar)", async () => {
    m.list.mockResolvedValueOnce([]);
    expect(await ensureTicketTemplate(db(), "b1")).toBe("em_analise");
    expect(m.create.mock.calls[0][1]).toMatchObject({ name: NAME, category: "UTILITY", urlButton: { text: "Ver a resposta", example: "K7Q2-9XMP" } });
    expect(m.create.mock.calls[0][1].urlButton.baseUrl).toMatch(new RegExp(`/w/${KEY}\\?chamado=$`));
    m.list.mockResolvedValueOnce([{ name: NAME, status: "APPROVED", category: "MARKETING" }]);
    expect(await ensureTicketTemplate(db(), "b1")).toBe("reclassificado");
  });

  it("sai com o modelo aprovado, para o telefone no formato da Meta, com o primeiro nome e o protocolo", async () => {
    expect(await notifyTicketByWhatsApp(db(), { botId: "b1", phone: "(21) 99999-0000", name: "Maria Souza", protocol: "K7Q2-9XMP" })).toBe(true);
    expect(m.send).toHaveBeenCalledWith(expect.anything(), "5521999990000", { name: NAME, language: "pt_BR" }, ["Maria", "K7Q2-9XMP"], { urlSuffix: "K7Q2-9XMP" });
  });

  it("não sai: modelo em análise, descadastro de utilidade, canal bloqueado ou telefone inválido", async () => {
    m.list.mockResolvedValueOnce([{ name: NAME, status: "PENDING", category: "UTILITY" }]);
    expect(await notifyTicketByWhatsApp(db(), { botId: "b1", phone: "21999990000", name: null, protocol: "K7Q2-9XMP" })).toBe(false);
    m.suppressions.mockResolvedValueOnce([{ id: 1, kind: "all", reason: "SAIR" }]);
    expect(await notifyTicketByWhatsApp(db(), { botId: "b1", phone: "21999990000", name: null, protocol: "K7Q2-9XMP" })).toBe(false);
    m.blocked.mockResolvedValueOnce("Canal suspenso.");
    expect(await notifyTicketByWhatsApp(db(), { botId: "b1", phone: "21999990000", name: null, protocol: "K7Q2-9XMP" })).toBe(false);
    expect(await notifyTicketByWhatsApp(db(), { botId: "b1", phone: "123", name: null, protocol: "K7Q2-9XMP" })).toBe(false);
    expect(m.send).not.toHaveBeenCalled();
  });

  it("a resposta da equipe: aviso pelo WhatsApp (com o aceite) e o ticket.updated, sem a nota", async () => {
    m.leads.set("c1", [{ name: "Maria Souza", email: "maria@exemplo.com", phone: "21999990000" }]);
    await afterTicketReply(db(), "c1", "Corrigi o boleto.", vivi, new Date("2026-10-21T16:00:00Z"));
    expect(m.send).toHaveBeenCalledOnce();
    expect(m.emitted).toEqual([{ type: "ticket.updated", data: { ticket: { protocol: "K7Q2-9XMP", status: "aguardando_cliente", subject: "Financeiro" }, change: "resposta_equipe", previous_status: "em_andamento", agent: { id: "mbr_vivi", display_name: "Vivi", type: "agency_member" } } }]);
    // sem o aceite, só o e-mail (e o evento)
    m.emitted.length = 0;
    m.send.mockClear();
    await afterTicketReply(db({ conversations: [{ id: "c1", bot_id: "b1", channel: "widget", contact_id: null, ticket_protocol: "K7Q2-9XMP", ticket_status: "em_andamento", ticket_subject: null, ticket_whatsapp_at: null }] }), "c1", "Oi", vivi);
    expect(m.send).not.toHaveBeenCalled();
    expect(m.emitted.map((e) => e.type)).toEqual(["ticket.updated"]);
  });

  it("a troca de status pela equipe sai no ticket.updated", async () => {
    await setTicketStatus(db(), "c1", "resolvido", new Date("2026-10-21T17:00:00Z"), vivi);
    expect(m.emitted[0]).toMatchObject({ type: "ticket.updated", data: { ticket: { status: "resolvido" }, change: "status", previous_status: "em_andamento" } });
  });
});
