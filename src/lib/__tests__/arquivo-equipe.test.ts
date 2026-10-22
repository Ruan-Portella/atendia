import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import type { Attendant } from "../authors";

/*
 * A equipe manda foto e PDF pela conversa (painel e área do cliente): o tipo pelos primeiros bytes,
 * até 4 MB, a cópia guardada antes do envio (a Meta busca pelo link assinado), o texto como
 * legenda no WhatsApp e numa DM antes no Instagram, o arquivo ligado à mensagem e o message.sent
 * com ele; falhou, a cópia sai.
 */

const calls: Array<{ fn: string; args: unknown[] }> = [];
let mediaFails = false;
vi.mock("../whatsapp", async (orig) => ({
  ...(await orig<typeof import("../whatsapp")>()),
  sendText: vi.fn(async (...args: unknown[]) => {
    calls.push({ fn: "sendText", args });
    return { messages: [{ id: "wamid.TEXTO" }] };
  }),
  sendMedia: vi.fn(async (...args: unknown[]) => {
    calls.push({ fn: "sendMedia", args });
    if (mediaFails) throw new Error("a Meta não conseguiu baixar o arquivo");
    return { messages: [{ id: "wamid.ARQUIVO" }] };
  }),
}));
vi.mock("../instagram", async (orig) => ({
  ...(await orig<typeof import("../instagram")>()),
  sendInstagramText: vi.fn(async (...args: unknown[]) => {
    calls.push({ fn: "sendInstagramText", args });
    return "mid.TEXTO";
  }),
  sendInstagramAttachment: vi.fn(async (...args: unknown[]) => {
    calls.push({ fn: "sendInstagramAttachment", args });
    return "mid.ARQUIVO";
  }),
}));
// a regra de estado deixa sair (o modo tem os testes dele)
vi.mock("../conversation-mode", async (orig) => ({
  ...(await orig<typeof import("../conversation-mode")>()),
  resolveMode: vi.fn(async () => ({ step: 0, canSend: true, aiResponds: false, reason: "", facts: {} })),
}));
const learned: string[] = [];
vi.mock("../learning", () => ({ learnLater: vi.fn((_db: unknown, o: { text: string }) => learned.push(o.text)) }));
// o armazenamento cifrado tem os testes dele: aqui, só o que entra e sai
const stored: Array<{ mime: string; filename: string | null; messageId: number | null; channel: string }> = [];
const linked: Array<{ ids: string[]; messageId: number }> = [];
const purged: string[][] = [];
vi.mock("../attachments", async (orig) => ({
  ...(await orig<typeof import("../attachments")>()),
  storeAttachment: vi.fn(async (_db: unknown, a: { mime: string; filename: string | null; messageId: number | null; channel: string }) => (stored.push(a), "11111111-1111-4111-8111-111111111111")),
  linkAttachments: vi.fn(async (_db: unknown, ids: string[], messageId: number) => void linked.push({ ids, messageId })),
  purgeAttachments: vi.fn(async (_db: unknown, f: { ids: string[] }) => (purged.push(f.ids), 1)),
}));
const events: Array<{ id: number; withMedia: boolean }> = [];
vi.mock("../message-events", async (orig) => ({
  ...(await orig<typeof import("../message-events")>()),
  queueMessageEvent: vi.fn(async (_db: unknown, id: number, _m: unknown, o: { withMedia?: boolean } = {}) => void events.push({ id, withMedia: Boolean(o.withMedia) })),
}));

const { postAgentMessage } = await import("../handoff");
const { AGENT_FILE_MAX_BYTES, agentUpload, checkAgentFile, cleanFileName } = await import("../agent-files");

const VIVI = "a1000000-0000-4000-8000-000000000001";
const vivi: Attendant = { type: "agency_member", id: VIVI, name: "Viviane", legacy: "agência" };

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");

beforeEach(() => {
  for (const a of [calls, learned, stored, linked, purged, events]) a.length = 0;
  mediaFails = false;
  vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-mestra-dos-testes-0123456789");
});

function setup(channel: "whatsapp" | "instagram" | "widget", extra: MemRow = {}) {
  const t: Record<string, MemRow[]> = {
    bots: [{ id: "b1", agency_id: "ag1", client_name: "Loja", human_handoff: null, paused_at: null, pause_notify: null }],
    agency_members: [{ id: VIVI, signature: null }],
    whatsapp_channels: [{ bot_id: "b1", phone_number_id: "pn-1", access_token_enc: "tok", disconnected_at: null, payment_issue_at: null, waba_id: "waba-1", coexistence: false }],
    instagram_channels: [{ bot_id: "b1", ig_user_id: "ig-conta", access_token_enc: "tok", disconnected_at: null }],
    conversations: [{ id: "c1", bot_id: "b1", channel, wa_id: channel === "whatsapp" ? "5521999990000" : null, ig_id: channel === "instagram" ? "igsid-1" : null, contact_id: null, takeover_at: "2026-10-21T10:00:00Z", handled_at: null, assigned_to_id: VIVI, assigned_to_name: "Viviane", announce_pending: false, transfer_from_name: null, sector_id: null, ai_paused_until: null, ticket_protocol: null, ...extra }],
    messages: [],
  };
  return { t, db: memoryDb(t) };
}

describe("as regras do arquivo", () => {
  it("foto (JPEG ou PNG) ou PDF pelos primeiros bytes, até 4 MB; o nome sem caminho", () => {
    expect(checkAgentFile(JPEG, "C:\\fotos\\pizza.jpg")).toMatchObject({ ok: true, file: { kind: "image", mime: "image/jpeg", filename: "pizza.jpg" } });
    expect(checkAgentFile(PDF, "boleto.pdf")).toMatchObject({ ok: true, file: { kind: "document", mime: "application/pdf" } });
    // o nome não engana: HTML com nome de PDF não passa
    expect(checkAgentFile(HTML, "boleto.pdf")).toEqual({ ok: false, message: "Mande uma foto (JPEG ou PNG) ou um PDF." });
    expect(checkAgentFile(new Uint8Array(AGENT_FILE_MAX_BYTES + 1).fill(0xff), "grande.jpg")).toMatchObject({ ok: false, message: expect.stringContaining("até 4 MB") });
    expect(checkAgentFile(new Uint8Array(), "x.jpg")).toMatchObject({ ok: false });
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("  ")).toBeNull();
  });

  it("o campo do formulário: sem arquivo é null; acima de 4 MB nem é lido", async () => {
    expect(await agentUpload(null)).toEqual({ ok: true, upload: null });
    expect(await agentUpload("texto")).toEqual({ ok: true, upload: null });
    expect(await agentUpload(new File([new Uint8Array(AGENT_FILE_MAX_BYTES + 1)], "grande.pdf"))).toMatchObject({ ok: false });
    expect(await agentUpload(new File([PDF], "boleto.pdf"))).toMatchObject({ ok: true, upload: { filename: "boleto.pdf" } });
  });
});

describe("a equipe manda o arquivo", () => {
  it("WhatsApp: a foto com o texto como legenda; a cópia guardada antes, ligada à mensagem, e o message.sent com ela", async () => {
    const { t, db } = setup("whatsapp");
    expect((await postAgentMessage(db, "c1", "Segue a foto do cardápio.", vivi, { upload: { data: JPEG, filename: "cardapio.jpg" } })).ok).toBe(true);
    expect(stored).toEqual([expect.objectContaining({ mime: "image/jpeg", filename: "cardapio.jpg", messageId: null, channel: "whatsapp" })]);
    expect(calls.map((c) => c.fn)).toEqual(["sendMedia"]);
    expect(calls[0].args[2]).toMatchObject({ type: "image", caption: "Segue a foto do cardápio.", link: expect.stringContaining("/api/files/11111111-1111-4111-8111-111111111111?exp=") });
    const msg = t.messages.find((m) => m.role === "agent")!;
    expect(msg).toMatchObject({ content: "Segue a foto do cardápio.", channel_msg_ref_enc: "wamid.ARQUIVO" });
    expect(linked).toEqual([{ ids: ["11111111-1111-4111-8111-111111111111"], messageId: msg.id }]);
    expect(events).toEqual([{ id: msg.id, withMedia: true }]);
    expect(learned).toEqual(["Segue a foto do cardápio."]);
  });

  it("só o PDF: vai sem legenda, com o nome; a conversa grava o rótulo e não vira sugestão para a base", async () => {
    const { t, db } = setup("whatsapp");
    expect((await postAgentMessage(db, "c1", "  ", vivi, { upload: { data: PDF, filename: "boleto.pdf" } })).ok).toBe(true);
    expect(calls[0].args[2]).toMatchObject({ type: "document", caption: null, filename: "boleto.pdf" });
    expect(t.messages.find((m) => m.role === "agent")?.content).toBe("📄 boleto.pdf");
    expect(learned).toEqual([]);
  });

  it("texto acima de 1.024 letras: sai antes, e o arquivo vai sem legenda", async () => {
    const { db } = setup("whatsapp");
    expect((await postAgentMessage(db, "c1", "a".repeat(1500), vivi, { upload: { data: PDF, filename: "contrato.pdf" } })).ok).toBe(true);
    expect(calls.map((c) => c.fn)).toEqual(["sendText", "sendMedia"]);
    expect(calls[1].args[2]).toMatchObject({ caption: null });
  });

  it("Instagram: o texto numa DM antes, e o PDF como arquivo", async () => {
    const { db } = setup("instagram");
    expect((await postAgentMessage(db, "c1", "Aqui está o boleto.", vivi, { upload: { data: PDF, filename: "boleto.pdf" } })).ok).toBe(true);
    expect(calls.map((c) => c.fn)).toEqual(["sendInstagramText", "sendInstagramAttachment"]);
    expect(calls[1].args[2]).toMatchObject({ type: "file", url: expect.stringContaining("/api/files/") });
  });

  it("chat do site: a mensagem com o arquivo ligado (o widget mostra pelo link de 1 hora)", async () => {
    const { t, db } = setup("widget");
    expect((await postAgentMessage(db, "c1", "", vivi, { upload: { data: JPEG, filename: "mapa.jpg" } })).ok).toBe(true);
    expect(calls).toEqual([]);
    const msg = t.messages.find((m) => m.role === "agent")!;
    expect(msg.content).toBe("📷 mapa.jpg");
    expect(linked).toEqual([{ ids: ["11111111-1111-4111-8111-111111111111"], messageId: msg.id }]);
  });

  it("no chamado do site, o arquivo não vai; tipo errado nem é guardado", async () => {
    const ticket = setup("widget", { ticket_protocol: "K7Q2-9XMP" });
    expect(await postAgentMessage(ticket.db, "c1", "segue", vivi, { upload: { data: PDF, filename: "x.pdf" } })).toMatchObject({ ok: false, message: expect.stringContaining("No chamado") });
    const wa = setup("whatsapp");
    expect(await postAgentMessage(wa.db, "c1", "segue", vivi, { upload: { data: HTML, filename: "x.pdf" } })).toMatchObject({ ok: false });
    expect(stored).toEqual([]);
  });

  it("o canal recusou: a cópia sai e nada fica na conversa", async () => {
    mediaFails = true;
    const { t, db } = setup("whatsapp");
    expect(await postAgentMessage(db, "c1", "segue", vivi, { upload: { data: JPEG, filename: "foto.jpg" } })).toMatchObject({ ok: false, message: expect.stringContaining("O WhatsApp não aceitou") });
    expect(purged).toEqual([["11111111-1111-4111-8111-111111111111"]]);
    expect(t.messages.filter((m) => m.role === "agent")).toHaveLength(0);
  });
});
