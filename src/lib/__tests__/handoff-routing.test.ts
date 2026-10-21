import { describe, expect, it } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { assignByRotation, handoffAudience, matchSector, sectorForHandoff } from "../handoff-routing";
import { isOnline, nextInRotation } from "../availability";
import { assignedToOther, takeOver } from "../handoff";
import { rotationView } from "@/components/handoff-controls";
import type { Sector } from "../sectors";

const now = new Date("2026-10-20T15:00:00Z");
const seen = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

function setup(extra: Record<string, MemRow[]> = {}) {
  const tables: Record<string, MemRow[]> = {
    sectors: [{ id: "s1", client_id: "c1", name: "Financeiro", hours: null, distribution: "rodizio", position: 0 }],
    sector_members: [
      { sector_id: "s1", member_type: "agency_member", member_id: "vivi", last_assigned_at: seen(30) },
      { sector_id: "s1", member_type: "agency_member", member_id: "carlos", last_assigned_at: null },
      { sector_id: "s1", member_type: "client_member", member_id: "carla", last_assigned_at: seen(120) },
      { sector_id: "s1", member_type: "agency_member", member_id: "fora", last_assigned_at: null },
    ],
    agency_members: [
      { id: "vivi", display_name: "Vivi", email: "vivi@x.com", available: true, last_seen_at: seen(2), removed_at: null },
      { id: "carlos", display_name: null, email: "carlos@x.com", available: false, last_seen_at: seen(1), removed_at: null },
      { id: "fora", display_name: "Fora", email: "fora@x.com", available: true, last_seen_at: seen(60), removed_at: null },
    ],
    client_members: [{ id: "carla", display_name: "Carla", email: "carla@loja.com", available: true, last_seen_at: seen(3) }],
    conversations: [{ id: "conv1", sector_id: null, takeover_at: null, handled_at: null, assigned_to_id: null, assigned_to_name: null, assigned_to_type: null, assigned_at: null }],
    ...extra,
  };
  return { tables, db: memoryDb(tables) };
}

describe("triagem pelo setor", () => {
  it("acha o setor pelo nome, sem diferença de maiúsculas e acentos", () => {
    const list = [{ id: "s1", name: "Financeiro" }, { id: "s2", name: "Pós-venda" }];
    expect(matchSector(list, "financeiro")?.id).toBe("s1");
    expect(matchSector(list, " pos-venda ")?.id).toBe("s2");
    expect(matchSector(list, "Vendas")).toBeNull();
    expect(matchSector(list, "")).toBeNull();
  });

  it("o setor que a IA escolheu; senão, o que a conversa já tinha", async () => {
    const { db } = setup({ conversations: [{ id: "conv1", sector_id: "s1" }] });
    expect((await sectorForHandoff(db, { clientId: "c1", conversationId: "conv1", sectorName: "FINANCEIRO" }))?.id).toBe("s1");
    expect((await sectorForHandoff(db, { clientId: "c1", conversationId: "conv1", sectorName: "inexistente" }))?.id).toBe("s1");
  });
});

describe("rodízio", () => {
  it("online = disponível e visto nos últimos 10 minutos", () => {
    expect(isOnline({ available: true, last_seen_at: seen(9) }, now.getTime())).toBe(true);
    expect(isOnline({ available: true, last_seen_at: seen(11) }, now.getTime())).toBe(false);
    expect(isOnline({ available: false, last_seen_at: seen(1) }, now.getTime())).toBe(false);
  });

  it("vai para quem está online e recebeu há mais tempo; marca a vez", async () => {
    const { db, tables } = setup();
    // Carlos está ausente e "fora" não abre o painel há 1 hora: entre Vivi (30 min) e Carla (2 h), Carla
    expect(await nextInRotation(db, "s1", now)).toEqual({ type: "client_member", id: "carla", name: "Carla" });
    expect(tables.sector_members.find((m) => m.member_id === "carla")?.last_assigned_at).toBe(now.toISOString());
    expect((await nextInRotation(db, "s1", now))?.id).toBe("vivi");
  });

  it("entrega a conversa sem assumir; a conversa de outra pessoa pede Assumir no lugar", async () => {
    const { db, tables } = setup();
    const sector = { id: "s1", clientId: "c1", name: "Financeiro", hours: null, distribution: "rodizio", position: 0, members: [] } as Sector;
    const to = await assignByRotation(db, "conv1", sector, now);
    expect(to?.id).toBe("carla");
    expect(tables.conversations[0]).toMatchObject({ assigned_to_id: "carla", assigned_to_name: "Carla", takeover_at: null });
    const conv = tables.conversations[0] as never;
    expect(assignedToOther(conv, "vivi")).toBe(true);
    expect(rotationView(conv, "carla")).toBe("mine");
    expect(rotationView(conv, "vivi")).toBe("other");
    const vivi = { type: "agency_member" as const, id: "vivi", name: "Vivi", legacy: "agência" };
    expect(await takeOver(db, "conv1", vivi)).toMatchObject({ ok: false });
    expect((await takeOver(db, "conv1", { type: "client_member", id: "carla", name: "Carla", legacy: "carla@loja.com" })).ok).toBe(true);
    expect(tables.conversations[0]).toMatchObject({ assigned_to_id: "carla" });
    // manual: ninguém recebe
    expect(await assignByRotation(db, "conv1", { ...sector, distribution: "manual" }, now)).toBeNull();
  });

  it("os avisos: só quem recebeu; sem ninguém, as pessoas do setor; setor vazio, todos", async () => {
    const { db } = setup();
    const sector = { id: "s1", clientId: "c1", name: "Financeiro", hours: null, distribution: "manual", position: 0, members: [{ type: "agency_member", id: "vivi" }, { type: "client_member", id: "carla" }] } as Sector;
    expect(await handoffAudience(db, sector, { type: "agency_member", id: "vivi", name: "Vivi" })).toEqual({ emails: ["vivi@x.com"], agencyMemberIds: ["vivi"] });
    expect(await handoffAudience(db, sector, null)).toEqual({ emails: ["vivi@x.com", "carla@loja.com"], agencyMemberIds: ["vivi"] });
    expect(await handoffAudience(db, { ...sector, members: [] }, null)).toBeNull();
  });
});
