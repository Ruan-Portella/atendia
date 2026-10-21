import { describe, expect, it } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { eligibleSectorMembers, holidaysText, listSectors, parseHolidays, saveSector, sectorFromForm, sectorNameProblem } from "../sectors";
import { handoffNotice, isHoliday, nextOpening } from "../handoff-hours";

describe("feriados", () => {
  it("dia/mês vale todo ano; dia/mês/ano, só nele; data que não existe é recusada", () => {
    expect(parseHolidays("25/12\n20/11/2026, 1/1")).toEqual({ holidays: ["01-01", "12-25", "2026-11-20"] });
    expect(parseHolidays("31/02")).toEqual({ error: "\"31/02\" não existe no calendário." });
    expect("error" in parseHolidays("natal")).toBe(true);
    expect(holidaysText(["12-25", "2026-11-20"])).toBe("25/12\n20/11/2026");
  });

  it("feriado é dia fechado: a equipe volta no próximo dia útil, com a data se passar de uma semana", () => {
    const hours = { "1": ["09:00", "18:00"] as [string, string], "2": ["09:00", "18:00"] as [string, string] };
    // segunda, 30/11/2026, 10h em Brasília (13h UTC)
    const monday = new Date("2026-11-30T13:00:00Z");
    expect(nextOpening(hours, monday)).toBeNull();
    expect(isHoliday(["11-30"], monday)).toBe(true);
    expect(nextOpening(hours, monday, ["11-30"])).toMatchObject({ inDays: 1, day: 2 });
    expect(handoffNotice(hours, monday, null, ["11-30", "2026-12-01"])).toContain("na próxima segunda, das 9h às 18h");
    expect(handoffNotice(hours, monday, null, ["11-30", "2026-12-01", "12-07", "12-08"])).toContain("segunda, dia 14/12, das 9h às 18h");
  });
});

describe("setores", () => {
  it("nome obrigatório, até 40 caracteres e sem repetir no cliente", () => {
    expect(sectorNameProblem(" ", [])).toContain("Dê um nome");
    expect(sectorNameProblem("Vendas", ["vendas"])).toBe("Já existe um setor chamado Vendas neste cliente.");
    expect(sectorNameProblem("Suporte", ["Vendas"])).toBeNull();
  });

  it("o formulário: pessoas marcadas, rodízio e horário próprio só quando marcado", () => {
    const fd = new FormData();
    fd.set("name", "Financeiro");
    fd.set("distribution", "rodizio");
    fd.append("member", "agency_member:m1");
    fd.append("member", "client_member:c1");
    fd.append("member", "lixo");
    fd.set("hours_open_1", "09:00");
    fd.set("hours_close_1", "17:00");
    expect(sectorFromForm(fd)).toEqual({ name: "Financeiro", hours: null, distribution: "rodizio", members: [{ type: "agency_member", id: "m1" }, { type: "client_member", id: "c1" }] });
    fd.set("own_hours", "on");
    expect(sectorFromForm(fd)).toMatchObject({ hours: { "1": ["09:00", "17:00"] } });
  });

  it("só entra quem atende o cliente: a equipe com o cliente no escopo e as pessoas da área do cliente", async () => {
    const tables: Record<string, MemRow[]> = {
      agency_members: [
        { id: "dono", agency_id: "a1", email: "dono@x.com", display_name: "Ruan", scope: "all", role: "owner", accepted_at: "2026-01-01", removed_at: null },
        { id: "vivi", agency_id: "a1", email: "vivi@x.com", display_name: "Vivi", scope: "selected", role: "agent", accepted_at: "2026-01-01", removed_at: null },
        { id: "outro", agency_id: "a1", email: "outro@x.com", display_name: null, scope: "selected", role: "agent", accepted_at: "2026-01-01", removed_at: null },
        { id: "convite", agency_id: "a1", email: "novo@x.com", display_name: null, scope: "all", role: "agent", accepted_at: null, removed_at: null },
      ],
      agency_member_scopes: [
        { member_id: "vivi", client_id: null, bot_id: "bot1" },
        { member_id: "outro", client_id: "c2", bot_id: null },
      ],
      bots: [{ id: "bot1", client_id: "c1" }],
      client_members: [{ id: "cm1", client_id: "c1", email: "loja@x.com", display_name: "Carla" }],
      sectors: [],
      sector_members: [],
    };
    const db = memoryDb(tables);
    const eligible = await eligibleSectorMembers(db, { agencyId: "a1", clientId: "c1" });
    expect(eligible.map((m) => `${m.type}:${m.id}`)).toEqual(["agency_member:dono", "agency_member:vivi", "client_member:cm1"]);
    const r = await saveSector(db, { agencyId: "a1", clientId: "c1", id: null, input: { name: "Vendas", hours: null, distribution: "manual", members: [{ type: "agency_member", id: "vivi" }, { type: "agency_member", id: "outro" }, { type: "client_member", id: "cm1" }] } });
    expect("id" in r).toBe(true);
    const [s] = await listSectors(db, ["c1"]);
    expect(s.members.map((m) => m.id).sort()).toEqual(["cm1", "vivi"]);
    expect(await saveSector(db, { agencyId: "a1", clientId: "c1", id: null, input: { name: "VENDAS", hours: null, distribution: "manual", members: [] } })).toEqual({ error: "Já existe um setor chamado VENDAS neste cliente." });
    // tirar e pôr pessoas
    await saveSector(db, { agencyId: "a1", clientId: "c1", id: s.id, input: { name: "Vendas", hours: null, distribution: "rodizio", members: [{ type: "agency_member", id: "dono" }] } });
    const [after] = await listSectors(db, ["c1"]);
    expect(after).toMatchObject({ distribution: "rodizio", members: [{ type: "agency_member", id: "dono" }] });
  });
});
