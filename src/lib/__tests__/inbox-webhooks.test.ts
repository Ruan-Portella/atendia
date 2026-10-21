import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { resetWebhookCache } from "../message-events";
import { transferConversation } from "../transfer";
import { takeOver } from "../handoff";
import type { Attendant } from "../authors";

// os eventos que sairiam (sem o envio de verdade)
const emitted: Array<{ type: string; data: Record<string, unknown> }> = [];
vi.mock("../webhooks", async (orig) => ({
  ...(await orig<typeof import("../webhooks")>()),
  emitEvent: vi.fn(async (_db: unknown, e: { type: string; data: Record<string, unknown> }) => void emitted.push({ type: e.type, data: e.data })),
}));

const S1 = "5e1d3c2a-0000-4000-8000-000000000001";
const VIVI = "a1000000-0000-4000-8000-000000000001";
const CARLOS = "a1000000-0000-4000-8000-000000000002";
const vivi: Attendant = { type: "agency_member", id: VIVI, name: "Vivi", legacy: "agência" };
const carlos: Attendant = { type: "agency_member", id: CARLOS, name: "Carlos", legacy: "agência" };
const at = new Date(Date.now() - 20 * 60_000).toISOString();

function setup(conv: MemRow = {}) {
  const tables: Record<string, MemRow[]> = {
    webhooks: [{ id: "w1", agency_id: "ag1", active: true }],
    agency_packs: [{ agency_id: "ag1", pack: "integracoes", ends_at: null }],
    bots: [{ id: "b1", name: "Lia", client_name: "Loja", client_id: "c1", agency_id: "ag1", lead_capture: null, human_handoff: null }],
    clients: [{ id: "c1", allow_handoff: false }],
    agency_members: [
      { id: VIVI, agency_id: "ag1", email: "vivi@x.com", display_name: "Vivi", scope: "all", role: "admin", accepted_at: at, removed_at: null, available: true, last_seen_at: new Date().toISOString() },
      { id: CARLOS, agency_id: "ag1", email: "carlos@x.com", display_name: "Carlos", scope: "all", role: "attendant", accepted_at: at, removed_at: null, available: true, last_seen_at: new Date().toISOString() },
    ],
    client_members: [],
    sectors: [{ id: S1, agency_id: "ag1", client_id: "c1", name: "Financeiro", hours: null, distribution: "rodizio", position: 0 }],
    sector_members: [{ sector_id: S1, member_type: "agency_member", member_id: CARLOS, last_assigned_at: null }],
    conversations: [{ id: "conv1", bot_id: "b1", channel: "widget", contact_id: null, sector_id: null, handoff_requested_at: at, takeover_at: at, handled_at: null, assigned_to_type: "agency_member", assigned_to_id: VIVI, assigned_to_name: "Vivi", assigned_at: at, announce_pending: false, transfer_from_name: null, ...conv }],
    conversation_notes: [],
    handoff_waits: [],
    routine_runs: [],
  };
  return { tables, db: memoryDb(tables) };
}

describe("webhooks da Caixa de entrada", () => {
  afterEach(() => {
    emitted.length = 0;
    resetWebhookCache();
  });

  it("transferir para o setor com rodízio: conversation.transferred e conversation.assigned (by transfer), sem a nota", async () => {
    const { db } = setup();
    expect((await transferConversation(db, "conv1", vivi, { kind: "setor", id: S1 }, "nota só da equipe")).ok).toBe(true);
    expect(emitted.map((e) => e.type)).toEqual(["conversation.transferred", "conversation.assigned"]);
    expect(emitted[0].data).toEqual({ from: { id: `mbr_${VIVI}`, display_name: "Vivi", type: "agency_member" }, to: { type: "sector", agent: { id: `mbr_${CARLOS}`, display_name: "Carlos", type: "agency_member" }, sector: { id: `sec_${S1}`, name: "Financeiro" } } });
    expect(emitted[1].data).toMatchObject({ by: "transfer", agent: { id: `mbr_${CARLOS}` }, previous_agent: { id: `mbr_${VIVI}`, display_name: "Vivi" }, sector: { name: "Financeiro" } });
    expect(JSON.stringify(emitted)).not.toContain("nota só da equipe");
  });

  it("assumir no lugar: conversation.assigned (by agent) com quem estava", async () => {
    const { db } = setup();
    expect((await takeOver(db, "conv1", carlos, { force: true })).ok).toBe(true);
    expect(emitted).toEqual([{ type: "conversation.assigned", data: { agent: { id: `mbr_${CARLOS}`, display_name: "Carlos", type: "agency_member" }, by: "agent", previous_agent: { id: `mbr_${VIVI}`, display_name: "Vivi", type: "agency_member" }, sector: null } }]);
  });
});
