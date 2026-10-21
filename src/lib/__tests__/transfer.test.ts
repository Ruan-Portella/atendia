import { describe, expect, it } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { parseTarget, transferConversation, transferOptions } from "../transfer";
import { transferNotice } from "../handoff-hours";
import { addNote, listNotes } from "../conversation-notes";
import { noteBody } from "../note-text";
import { isSnoozed, snoozeConversation, snoozeTarget, unsnoozeConversation } from "../snooze";
import { quickReplyProblem, renderQuickReply, saveQuickReply } from "../quick-replies";
import { inQueue, type InboxItem } from "../inbox";
import { withNotes } from "@/components/conversation-thread";
import type { Attendant } from "../authors";

const now = new Date("2026-10-21T15:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const S1 = "5e1d3c2a-0000-4000-8000-000000000001";
const VIVI = "a1000000-0000-4000-8000-000000000001";
const CARLOS = "a1000000-0000-4000-8000-000000000002";
const CARLA = "c1000000-0000-4000-8000-000000000001";
const vivi: Attendant = { type: "agency_member", id: VIVI, name: "Vivi", legacy: "agência" };
const carlos: Attendant = { type: "agency_member", id: CARLOS, name: "Carlos", legacy: "agência" };

function setup(conv: MemRow = {}, extra: Record<string, MemRow[]> = {}) {
  const tables: Record<string, MemRow[]> = {
    bots: [{ id: "b1", name: "Lia", client_name: "Loja da Ana", client_id: "c1", agency_id: "ag1", lead_capture: null, human_handoff: null }],
    clients: [{ id: "c1", allow_handoff: true }],
    agency_members: [
      { id: VIVI, agency_id: "ag1", email: "vivi@x.com", display_name: "Vivi", scope: "all", role: "admin", accepted_at: ago(9999), removed_at: null, available: true, last_seen_at: ago(1) },
      { id: CARLOS, agency_id: "ag1", email: "carlos@x.com", display_name: "Carlos", scope: "all", role: "attendant", accepted_at: ago(9999), removed_at: null, available: true, last_seen_at: ago(2) },
    ],
    client_members: [{ id: CARLA, client_id: "c1", email: "carla@loja.com", display_name: "Carla", available: true, last_seen_at: ago(3) }],
    sectors: [{ id: S1, agency_id: "ag1", client_id: "c1", name: "Financeiro", hours: null, distribution: "rodizio", position: 0 }],
    sector_members: [
      { sector_id: S1, member_type: "agency_member", member_id: VIVI, last_assigned_at: null },
      { sector_id: S1, member_type: "client_member", member_id: CARLA, last_assigned_at: ago(60) },
    ],
    conversations: [
      { id: "conv1", bot_id: "b1", channel: "widget", sector_id: null, handoff_requested_at: ago(30), takeover_at: ago(20), handled_at: null, assigned_to_type: "agency_member", assigned_to_id: VIVI, assigned_to_name: "Vivi", assigned_at: ago(20), announce_pending: false, transfer_from_name: null, snoozed_until: null, snoozed_at: null, last_contact_at: ago(21), ...conv },
    ],
    conversation_notes: [],
    quick_replies: [],
    ...extra,
  };
  return { tables, db: memoryDb(tables) };
}

describe("transferir", () => {
  it("lê o destino do formulário e monta o anúncio", () => {
    expect(parseTarget(`setor:${S1}`)).toEqual({ kind: "setor", id: S1 });
    expect(parseTarget(`client_member:${CARLA}`)).toEqual({ kind: "pessoa", type: "client_member", id: CARLA });
    expect(parseTarget("setor:x")).toBeNull();
    expect(parseTarget("admin:" + S1)).toBeNull();
    expect(transferNotice("Vivi", "Carlos", "Financeiro")).toBe("Vivi passou seu atendimento para Carlos, do setor Financeiro.");
    expect(transferNotice("Vivi", "Carlos")).toBe("Vivi passou seu atendimento para Carlos.");
  });

  it("para onde dá: os setores e quem atende o cliente, menos você; sem atendimento liberado, só a agência", async () => {
    const { db } = setup();
    const o = await transferOptions(db, { agencyId: "ag1", clientId: "c1", meId: VIVI });
    expect(o.sectors).toEqual([{ id: S1, name: "Financeiro" }]);
    expect(o.people.map((p) => p.id)).toEqual([CARLOS, CARLA]);
    const closed = setup({}, { clients: [{ id: "c1", allow_handoff: false }] });
    expect((await transferOptions(closed.db, { agencyId: "ag1", clientId: "c1", meId: VIVI })).people.map((p) => p.id)).toEqual([CARLOS]);
  });

  it("para uma pessoa, no atendimento em andamento: ela fica com a conversa, o anúncio diz quem passou e a nota fica registrada", async () => {
    const { db, tables } = setup();
    const r = await transferConversation(db, "conv1", vivi, { kind: "pessoa", type: "agency_member", id: CARLOS }, "  cliente quer 2ª via  ", now);
    expect(r).toMatchObject({ ok: true, toLabel: "Carlos" });
    expect(tables.conversations[0]).toMatchObject({ assigned_to_id: CARLOS, assigned_to_name: "Carlos", takeover_at: ago(20), announce_pending: true, transfer_from_name: "Vivi" });
    expect(tables.conversation_notes[0]).toMatchObject({ kind: "transferencia", author_name: "Vivi", body_enc: "cliente quer 2ª via", target_label: "Carlos" });
    // agora é do Carlos: a Vivi não transfere de novo
    expect((await transferConversation(db, "conv1", vivi, { kind: "setor", id: S1 }, "", now)).ok).toBe(false);
  });

  it("para o setor com rodízio: vai para a próxima pessoa disponível, nunca de volta para quem transferiu", async () => {
    const { db, tables } = setup();
    const r = await transferConversation(db, "conv1", vivi, { kind: "setor", id: S1 }, null, now);
    expect(r).toMatchObject({ ok: true, toLabel: "Financeiro · com Carla" });
    expect(tables.conversations[0]).toMatchObject({ sector_id: S1, assigned_to_type: "client_member", assigned_to_id: CARLA, transfer_from_name: "Vivi" });
  });

  it("para o setor sem ninguém disponível: fica na fila do setor, sem dono, e o assistente segue pausado", async () => {
    const { db, tables } = setup({}, { client_members: [{ id: CARLA, client_id: "c1", email: "carla@loja.com", display_name: "Carla", available: false, last_seen_at: ago(3) }] });
    const r = await transferConversation(db, "conv1", vivi, { kind: "setor", id: S1 }, null, now);
    expect(r).toMatchObject({ ok: true, toLabel: "Financeiro" });
    expect(tables.conversations[0]).toMatchObject({ sector_id: S1, assigned_to_id: null, takeover_at: ago(20) });
  });

  it("pedido ainda sem ninguém: a pessoa recebe sem assumir; encerrado não transfere; tirar do adiamento junto", async () => {
    const { db, tables } = setup({ takeover_at: null, assigned_to_id: null, assigned_to_name: null, assigned_to_type: null, snoozed_until: ago(-60), snoozed_at: ago(5) });
    expect((await transferConversation(db, "conv1", carlos, { kind: "pessoa", type: "agency_member", id: VIVI }, null, now)).ok).toBe(true);
    expect(tables.conversations[0]).toMatchObject({ assigned_to_id: VIVI, takeover_at: null, announce_pending: false, snoozed_until: null });
    const done = setup({ handled_at: ago(1), takeover_at: null });
    expect((await transferConversation(done.db, "conv1", vivi, { kind: "pessoa", type: "agency_member", id: CARLOS }, null, now)).message).toMatch(/atendimento aberto/);
  });

  it("nota longa demais não transfere", async () => {
    const { db, tables } = setup();
    expect((await transferConversation(db, "conv1", vivi, { kind: "pessoa", type: "agency_member", id: CARLOS }, "x".repeat(1001), now)).ok).toBe(false);
    expect(tables.conversations[0].assigned_to_id).toBe(VIVI);
  });
});

describe("notas internas", () => {
  it("grava, lista e entra no meio das mensagens pela hora", async () => {
    const { db } = setup();
    expect(noteBody("   ")).toBeNull();
    expect((await addNote(db, "conv1", "", vivi)).ok).toBe(false);
    expect((await addNote(db, "conv1", "ligar amanhã", vivi)).ok).toBe(true);
    const notes = await listNotes(db, "conv1");
    expect(notes).toMatchObject([{ kind: "nota", authorName: "Vivi", body: "ligar amanhã" }]);
    const thread = withNotes([{ id: 1, role: "user", content: "oi", created_at: "2000-01-01T00:00:00Z" }, { id: 2, role: "agent", content: "olá", created_at: "2999-01-01T00:00:00Z" }], notes);
    expect(thread.map((m) => m.role)).toEqual(["user", "nota", "agent"]);
  });
});

describe("adiar", () => {
  it("a data: 1 hora, amanhã às 9h de Brasília, ou a escolhida (até 30 dias)", () => {
    expect(snoozeTarget("1h", null, now)).toEqual(new Date("2026-10-21T16:00:00Z"));
    expect(snoozeTarget("amanha", null, now)).toEqual(new Date("2026-10-22T12:00:00Z"));
    expect(snoozeTarget("data", "2026-10-25T08:30", now)).toEqual(new Date("2026-10-25T11:30:00Z"));
    expect(snoozeTarget("data", "2026-10-21T12:01", now)).toMatchObject({ error: expect.stringMatching(/5 minutos/) });
    expect(snoozeTarget("data", "2026-12-25T08:00", now)).toMatchObject({ error: expect.stringMatching(/30 dias/) });
    expect(snoozeTarget("x", null, now)).toHaveProperty("error");
  });

  it("adiada até a data, ou até o contato escrever", () => {
    expect(isSnoozed({ snoozed_until: ago(-60), snoozed_at: ago(10), last_contact_at: ago(20) }, now.getTime())).toBe(true);
    expect(isSnoozed({ snoozed_until: ago(-60), snoozed_at: ago(10), last_contact_at: ago(2) }, now.getTime())).toBe(false);
    expect(isSnoozed({ snoozed_until: ago(1), snoozed_at: ago(10) }, now.getTime())).toBe(false);
  });

  it("só quem está com a conversa adia; a fila Adiadas tira das outras", async () => {
    const { db, tables } = setup();
    expect((await snoozeConversation(db, "conv1", carlos, new Date(now.getTime() + 3_600_000), now)).ok).toBe(false);
    expect((await snoozeConversation(db, "conv1", vivi, new Date(now.getTime() + 3_600_000), now)).ok).toBe(true);
    expect(tables.conversations[0].snoozed_until).toBe("2026-10-21T16:00:00.000Z");
    const item = { assignedId: VIVI, outsideHours: false, sectorId: null, snoozedUntil: "2026-10-21T16:00:00.000Z" } as InboxItem;
    expect(["minhas", "todas", "adiadas"].map((q) => inQueue(item, q as "minhas", VIVI))).toEqual([false, false, true]);
    expect((await unsnoozeConversation(db, "conv1", vivi)).ok).toBe(true);
    expect(tables.conversations[0].snoozed_until).toBeNull();
  });
});

describe("respostas prontas", () => {
  it("{nome} e {atendente}; sem nome, o {nome} sai sem deixar vírgula sobrando", () => {
    expect(renderQuickReply("Olá, {nome}! Aqui é {atendente}.", { contact: "Maria Souza", attendant: "Vivi" })).toBe("Olá, Maria! Aqui é Vivi.");
    expect(renderQuickReply("Olá, {nome}! Tudo bem?", { contact: null, attendant: "Vivi" })).toBe("Olá! Tudo bem?");
    expect(renderQuickReply("{nome}, seu pedido saiu.", { contact: "", attendant: "Vivi" })).toBe("Seu pedido saiu.");
  });

  it("título e texto obrigatórios, sem título repetido no cliente", async () => {
    expect(quickReplyProblem("", "x")).toMatch(/título/);
    expect(quickReplyProblem("Horário", " ")).toMatch(/texto/);
    const { db, tables } = setup();
    expect(await saveQuickReply(db, { clientId: "c1", id: null, title: "Horário", body: "9h às 18h" })).toHaveProperty("id");
    expect(await saveQuickReply(db, { clientId: "c1", id: null, title: " horário ", body: "outro" })).toMatchObject({ error: expect.stringMatching(/já existe/i) });
    expect(tables.quick_replies).toHaveLength(1);
  });
});

describe("depois da transferência", () => {
  it("a primeira mensagem de quem recebe sai com o anúncio de quem passou; a seguinte, sem", async () => {
    const { db, tables } = setup({}, { messages: [] });
    await transferConversation(db, "conv1", vivi, { kind: "pessoa", type: "agency_member", id: CARLOS }, null, now);
    const { postAgentMessage } = await import("../handoff");
    expect((await postAgentMessage(db, "conv1", "Oi! Vou ver a sua 2ª via.", carlos)).ok).toBe(true);
    expect((await postAgentMessage(db, "conv1", "Pronto, enviei.", carlos)).ok).toBe(true);
    const sent = tables.messages.map((m) => m.content);
    expect(sent).toEqual(["Vivi passou seu atendimento para Carlos.\n\nOi! Vou ver a sua 2ª via.", "Pronto, enviei."]);
    expect(tables.conversations[0]).toMatchObject({ announce_pending: false, transfer_from_name: null });
  });

  it("o roteiro com setor manda a conversa para ele, pelo nome; sem setor com o nome, nada muda", async () => {
    const { routeToRoutineSector } = await import("../routine-engine");
    const run = (sector: string | null) => ({ conversationId: "conv1", botId: "b1", routine: { handoff_sector: sector } }) as unknown as Parameters<typeof routeToRoutineSector>[1];
    const { db, tables } = setup();
    await routeToRoutineSector(db, run("inexistente"));
    expect(tables.conversations[0].sector_id).toBeNull();
    await routeToRoutineSector(db, run(" FINANCEIRO "));
    expect(tables.conversations[0].sector_id).toBe(S1);
  });
});
