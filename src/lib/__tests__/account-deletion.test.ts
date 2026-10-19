import { describe, expect, it, vi } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { ACCOUNT_DELETION_DAYS, cancelAccountDeletion, executeAccountDeletion, requestAccountDeletion, runDueAccountDeletions, type DeletionDeps } from "../account-deletion";

const AG = "11111111-1111-4111-8111-111111111111";
const OWNER = "u-dono";
const NOW = new Date("2026-10-19T15:00:00.000Z");

function tables(over: Partial<MemRow> = {}): Record<string, MemRow[]> {
  return {
    agencies: [{ id: AG, name: "Norte Marketing", owner_id: OWNER, stripe_subscription_id: "sub_1", billing_cancel_at: null, deletion_scheduled_for: null, deletion_billing_paused: false, ...over }],
    bots: [{ id: "b1", agency_id: AG }, { id: "b2", agency_id: AG }],
    clients: [{ id: "c1", agency_id: AG }],
    agency_members: [{ id: "m1", agency_id: AG, user_id: OWNER }, { id: "m2", agency_id: AG, user_id: "u-ana" }],
    client_members: [{ id: "cm1", client_id: "c1" }, { id: "cm-outro", client_id: "c-outra-agencia" }],
    deletion_log: [],
    audit_log: [],
  };
}

function fakeDeps(o: { stripeFails?: boolean; userFails?: string } = {}) {
  const update = vi.fn(async () => {
    if (o.stripeFails) throw new Error("Stripe fora do ar");
    return {};
  });
  const cancel = vi.fn(async () => ({}));
  const deps = {
    stripe: { subscriptions: { update, cancel } },
    disconnectWhatsApp: vi.fn(async () => ({})),
    disconnectInstagram: vi.fn(async () => ({})),
    purgeBotFiles: vi.fn(async () => {}),
    removeLogoFolder: vi.fn<(db: unknown, folder: string) => Promise<void>>(async () => {}),
    deleteUser: vi.fn(async (_db: unknown, id: string) => (id === o.userFails ? { ok: false, message: "erro" } : { ok: true })),
    notifyOwner: vi.fn(async () => true),
  };
  return { deps: deps as unknown as DeletionDeps, ...deps, update, cancel };
}

describe("exclusão da conta", () => {
  it("o pedido marca a data (7 dias), para a renovação e avisa o dono; pedir de novo não muda nada", async () => {
    const t = tables();
    const f = fakeDeps();
    const r = await requestAccountDeletion(memoryDb(t), { agencyId: AG, userId: OWNER, now: NOW }, f.deps);
    const when = new Date(NOW.getTime() + ACCOUNT_DELETION_DAYS * 86_400_000).toISOString();
    expect(r).toEqual({ ok: true, scheduledFor: when });
    expect(t.agencies[0]).toMatchObject({ deletion_scheduled_for: when, deletion_requested_by: OWNER, deletion_billing_paused: true });
    expect(f.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(f.notifyOwner).toHaveBeenCalledWith(expect.anything(), AG, expect.stringContaining("será excluída em 26/10/2026"), expect.any(Array));

    expect(await requestAccountDeletion(memoryDb(t), { agencyId: AG, userId: OWNER, now: new Date("2026-10-20T10:00:00Z") }, f.deps)).toEqual({ ok: true, scheduledFor: when });
    expect(f.update).toHaveBeenCalledTimes(1);
  });

  it("cancelamento já agendado pela pessoa fica como está; a Stripe fora do ar não agenda", async () => {
    const t = tables({ billing_cancel_at: "2026-11-01T03:00:00Z" });
    const f = fakeDeps();
    expect((await requestAccountDeletion(memoryDb(t), { agencyId: AG, userId: OWNER, now: NOW }, f.deps)).ok).toBe(true);
    expect(f.update).not.toHaveBeenCalled();
    expect(t.agencies[0].deletion_billing_paused).toBe(false);

    const t2 = tables();
    const r = await requestAccountDeletion(memoryDb(t2), { agencyId: AG, userId: OWNER, now: NOW }, fakeDeps({ stripeFails: true }).deps);
    expect(r.ok).toBe(false);
    expect(t2.agencies[0].deletion_scheduled_for).toBeNull();
  });

  it("desistir tira a data e volta a renovar só se foi o pedido que parou", async () => {
    const t = tables({ deletion_scheduled_for: "2026-10-26T15:00:00.000Z", deletion_billing_paused: true });
    const f = fakeDeps();
    expect(await cancelAccountDeletion(memoryDb(t), { agencyId: AG }, f.deps)).toEqual({ ok: true });
    expect(f.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: false });
    expect(t.agencies[0]).toMatchObject({ deletion_scheduled_for: null, deletion_billing_paused: false });

    const t2 = tables({ deletion_scheduled_for: "2026-10-26T15:00:00.000Z", deletion_billing_paused: false });
    const f2 = fakeDeps();
    await cancelAccountDeletion(memoryDb(t2), { agencyId: AG }, f2.deps);
    expect(f2.update).not.toHaveBeenCalled();
  });

  it("antes da data, nada sai", async () => {
    const t = tables({ deletion_scheduled_for: "2026-10-26T15:00:00.000Z" });
    const f = fakeDeps();
    expect(await executeAccountDeletion(memoryDb(t), AG, NOW, f.deps)).toBeNull();
    expect(f.disconnectWhatsApp).not.toHaveBeenCalled();
    expect(t.agencies).toHaveLength(1);
  });

  it("na data: canais, assinatura, o registro do que sai, arquivos, a agência e as contas da equipe", async () => {
    const t = tables({ deletion_scheduled_for: "2026-10-19T14:00:00.000Z" });
    const f = fakeDeps({ userFails: "u-ana" });
    const r = await executeAccountDeletion(memoryDb(t), AG, NOW, f.deps);
    expect(r).toEqual({ agencyId: AG, bots: 2, clients: 1, people: 2, usersLeft: ["u-ana"] });
    expect(f.disconnectWhatsApp).toHaveBeenCalledTimes(2);
    expect(f.disconnectInstagram).toHaveBeenCalledTimes(2);
    expect(f.cancel).toHaveBeenCalledWith("sub_1");
    expect(t.deletion_log.map((d) => `${d.table_name}:${d.row_id}`).sort()).toEqual([`agencies:${AG}`, "auth_users:u-ana", `auth_users:${OWNER}`, "bots:b1", "bots:b2", "clients:c1"].sort());
    expect(f.purgeBotFiles).toHaveBeenCalledTimes(2);
    expect(f.removeLogoFolder.mock.calls.map((c) => c[1])).toEqual([AG, "avatars/m1", "avatars/m2", "avatars/cm1"]);
    expect(f.notifyOwner).toHaveBeenCalledWith(expect.anything(), AG, expect.stringContaining("foi excluída"), expect.any(Array));
    expect(t.agencies).toHaveLength(0);
    expect(f.deleteUser.mock.calls.map((c) => c[1])).toEqual([OWNER, "u-ana"]);
    expect(t.audit_log[0]).toMatchObject({ agency_id: AG, actor_type: "system", action: "conta.excluida" });
  });

  it("o cron pega só as vencidas, e uma com erro não segura as outras", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const t = tables({ deletion_scheduled_for: "2026-10-19T14:00:00.000Z" });
    t.agencies.push({ id: other, name: "Outra", owner_id: "u2", stripe_subscription_id: null, billing_cancel_at: null, deletion_scheduled_for: "2026-10-25T00:00:00.000Z", deletion_billing_paused: false });
    const f = fakeDeps();
    expect(await runDueAccountDeletions(memoryDb(t), NOW, f.deps)).toEqual({ deleted: 1, failed: 0 });
    expect(t.agencies.map((a) => a.id)).toEqual([other]);
  });
});
