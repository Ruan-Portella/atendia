import { describe, expect, it } from "vitest";
import { memoryDb } from "../memory-db";
import { inQueue, isQueue, loadInbox, queueCounts, visibleTo, waitLabel, type InboxBot } from "../inbox";
import type { Sector } from "../sectors";

const now = new Date("2026-10-20T15:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

const bots: InboxBot[] = [
  { id: "b1", name: "Lia", client_name: "Loja da Ana", client_id: "c1", human_handoff: { hours: { "1": ["09:00", "18:00"], "2": ["09:00", "18:00"] } } },
];
const sectors: Sector[] = [{ id: "s1", clientId: "c1", name: "Financeiro", hours: null, distribution: "manual", position: 0, members: [] }];

function db() {
  return memoryDb({
    conversations: [
      // pedido aberto, sem setor, chegou na terça às 12h (no horário): fila geral
      { id: "geral", bot_id: "b1", channel: "whatsapp", contact_id: "ct1", sector_id: null, assigned_to_id: null, assigned_to_name: null, handoff_requested_at: ago(30), takeover_at: null, handled_at: null, handoff_urgent_at: null, last_contact_at: ago(30), last_reply_at: null, last_message_at: ago(30) },
      // do Financeiro, entregue à Vivi pelo rodízio
      { id: "fin", bot_id: "b1", channel: "widget", contact_id: null, sector_id: "s1", assigned_to_id: "vivi", assigned_to_name: "Vivi", handoff_requested_at: ago(10), takeover_at: null, handled_at: null, handoff_urgent_at: null, last_contact_at: ago(10), last_reply_at: null, last_message_at: ago(10) },
      // urgente, assumido por mim
      { id: "urg", bot_id: "b1", channel: "instagram", contact_id: null, sector_id: null, assigned_to_id: "eu", assigned_to_name: "Eu", handoff_requested_at: ago(5), takeover_at: ago(4), handled_at: null, handoff_urgent_at: ago(5), last_contact_at: ago(4), last_reply_at: ago(3), last_message_at: ago(3) },
      // encerrado: fica fora
      { id: "fim", bot_id: "b1", channel: "whatsapp", contact_id: null, sector_id: null, assigned_to_id: null, assigned_to_name: null, handoff_requested_at: ago(90), takeover_at: ago(80), handled_at: ago(70), handoff_urgent_at: null, last_contact_at: ago(90), last_reply_at: ago(80), last_message_at: ago(70) },
      // pediu na madrugada de terça (3h de Brasília): fora do horário
      { id: "madrugada", bot_id: "b1", channel: "whatsapp", contact_id: null, sector_id: null, assigned_to_id: null, assigned_to_name: null, handoff_requested_at: "2026-10-20T06:00:00Z", takeover_at: null, handled_at: null, handoff_urgent_at: null, last_contact_at: "2026-10-20T06:00:00Z", last_reply_at: null, last_message_at: "2026-10-20T06:00:00Z" },
    ],
    contacts: [{ id: "ct1", name: "Maria", display: null, phone_enc: null }],
  });
}

describe("caixa de entrada", () => {
  it("quem vê: sem setor, todos; do setor, as pessoas dele, quem está com ela e quem vê todos", () => {
    expect(visibleTo({ sector_id: null, assigned_to_id: null }, { meId: "x", mySectorIds: [], allSectors: false })).toBe(true);
    expect(visibleTo({ sector_id: "s1", assigned_to_id: null }, { meId: "x", mySectorIds: [], allSectors: false })).toBe(false);
    expect(visibleTo({ sector_id: "s1", assigned_to_id: null }, { meId: "x", mySectorIds: ["s1"], allSectors: false })).toBe(true);
    expect(visibleTo({ sector_id: "s1", assigned_to_id: "x" }, { meId: "x", mySectorIds: [], allSectors: false })).toBe(true);
    expect(visibleTo({ sector_id: "s1", assigned_to_id: null }, { meId: "x", mySectorIds: [], allSectors: true })).toBe(true);
  });

  it("as filas, a ordem (urgente primeiro, depois quem espera há mais tempo) e o fora do horário", async () => {
    const items = await loadInbox(db(), { bots, sectors, holidays: new Map(), meId: "eu", mySectorIds: [], allSectors: true, now });
    expect(items.map((i) => i.id)).toEqual(["urg", "madrugada", "geral", "fin"]);
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.geral).toMatchObject({ contact: "Maria", state: "aguardando", outsideHours: false, sectorName: null });
    expect(by.fin).toMatchObject({ sectorName: "Financeiro", assignedName: "Vivi" });
    expect(by.madrugada.outsideHours).toBe(true);
    expect(queueCounts(items, ["minhas", "nao_atribuidas", "fora", "todas", "setor:s1"], "eu")).toEqual({ minhas: 1, nao_atribuidas: 2, fora: 1, todas: 4, "setor:s1": 1 });
    expect(inQueue(by.fin, "setor:s1", "eu")).toBe(true);
    // o atendente fora do Financeiro não vê a conversa do setor
    const agent = await loadInbox(db(), { bots, sectors, holidays: new Map(), meId: "carlos", mySectorIds: [], allSectors: false, now });
    expect(agent.map((i) => i.id)).not.toContain("fin");
  });

  it("filas válidas e o tempo de espera curto", () => {
    expect(isQueue("minhas")).toBe(true);
    expect(isQueue("setor:7f1d3c2a-0000-4000-8000-000000000001")).toBe(true);
    expect(isQueue("setor:x")).toBe(false);
    expect(waitLabel(ago(4), now.getTime())).toBe("4 min");
    expect(waitLabel(ago(150), now.getTime())).toBe("3 h");
    expect(waitLabel(ago(60 * 50), now.getTime())).toBe("2 d");
  });
});
