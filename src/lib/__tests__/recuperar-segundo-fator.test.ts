import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<{ from: string; to: string; subject: string; text: string }> = [];
const ownerMails: string[] = [];
const platform: string[] = [];
vi.mock("../notify", () => ({
  sendAsAgency: vi.fn(async (from: string, to: string, subject: string, lines: string[]) => (sent.push({ from, to, subject, text: lines.join("\n") }), true)),
  notifyAgencyOwner: vi.fn(async (_db: unknown, _id: string, subject: string) => (ownerMails.push(subject), true)),
  notifyPlatform: vi.fn(async (subject: string) => (platform.push(subject), true)),
}));

import { memoryDb, type MemRow } from "../memory-db";
import { cancelOnVerified, cancelRecovery, confirmRecovery, effectiveStatus, loadRecovery, openRecoveryCounts, openRecoveryOf, recoveryRequestEmail, requestRecovery, supportRefuseRecovery, supportRemoveFactors, sweepMfaRecoveries, type FactorOps } from "../mfa-recovery";

const HOUR = 3_600_000;
const T0 = new Date("2026-10-21T12:00:00Z");
const at = (h: number) => new Date(T0.getTime() + h * HOUR);

function setup(o: { factors?: Array<{ id: string; status: string }> } = {}) {
  const t: Record<string, MemRow[]> = {
    agencies: [{ id: "ag1", name: "Agência Sol", owner_id: "u-dono", custom_domain: "painel.sol.com.br", custom_domain_verified_at: "2026-01-01T00:00:00Z" }],
    mfa_recovery_requests: [],
    audit_log: [],
  };
  const factors = { list: o.factors ?? [{ id: "f1", status: "verified" }], removed: [] as string[] };
  const ops: FactorOps = {
    list: async () => factors.list.filter((f) => !factors.removed.includes(f.id)),
    remove: async (_u, id) => void factors.removed.push(id),
  };
  return { t, db: memoryDb(t), ops, factors };
}

const painel = { userId: "u1", email: "Ana@Sol.com.br", area: "painel" as const, agencyId: "ag1" };
const cliente = { userId: "u2", email: "joao@padaria.com", area: "cliente" as const, agencyId: "ag1", clientId: "c1" };
const tokenOf = (text: string) => text.match(/segundo-fator\/([\w-]+)/)![1];
const actions = (t: Record<string, MemRow[]>) => t.audit_log.map((a) => a.action);

beforeEach(() => {
  sent.length = 0;
  ownerMails.length = 0;
  platform.length = 0;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://boavoz.com");
});

describe("o pedido", () => {
  it("só para quem tem o app cadastrado; um em aberto por pessoa; o link vai por e-mail", async () => {
    const none = setup({ factors: [] });
    expect(await requestRecovery(none.db, painel, { factors: none.ops, now: T0 })).toEqual({ ok: false, problem: "sem_fator" });

    const { t, db, ops } = setup();
    expect(await requestRecovery(db, painel, { factors: ops, reason: "  troquei   de celular ", now: T0 })).toEqual({ ok: true });
    expect(t.mfa_recovery_requests[0]).toMatchObject({ user_id: "u1", email: "ana@sol.com.br", area: "painel", status: "pendente", reason: "troquei de celular" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: "BoaVoz", to: "Ana@Sol.com.br", subject: "Confirme o pedido para recuperar o segundo fator" });
    expect(sent[0].text).toContain("https://boavoz.com/segundo-fator/");
    expect(sent[0].text).toContain("o suporte do BoaVoz só remove o app 48 horas depois");
    // o token fica só como hash
    expect(t.mfa_recovery_requests[0].token_hash).not.toBe(tokenOf(sent[0].text));
    expect(actions(t)).toEqual(["seguranca.mfa_recuperar_pedir"]);
    // pedir já não é alerta: o dono só fica sabendo na confirmação
    expect(ownerMails).toEqual([]);

    expect(await requestRecovery(db, painel, { factors: ops, now: at(1) })).toEqual({ ok: false, problem: "aberto" });
    expect(await openRecoveryOf(db, "u1", at(1))).toMatchObject({ status: "pendente" });
  });

  it("na área do cliente: o link no domínio da agência e o e-mail com o nome dela (sem BoaVoz)", async () => {
    const { t, db, ops } = setup();
    await requestRecovery(db, cliente, { factors: ops, now: T0 });
    expect(sent[0].from).toBe("Agência Sol");
    expect(sent[0].text).toContain("https://painel.sol.com.br/cliente/segundo-fator/");
    expect(sent[0].text).not.toMatch(/boavoz/i);
    expect(t.audit_log[0]).toMatchObject({ actor_type: "member", actor_id: "joao@padaria.com", target_type: "client", target_id: "c1" });
    const [, lines] = recoveryRequestEmail({ area: "cliente", agencyName: "Agência Sol", link: "x" });
    expect(lines.join(" ")).toContain("a equipe de Agência Sol só remove o app");
  });
});

describe("o link do e-mail", () => {
  it("confirmar começa as 48 horas; o dono recebe o alerta e o suporte, o aviso", async () => {
    const { t, db, ops } = setup();
    await requestRecovery(db, painel, { factors: ops, now: T0 });
    const token = tokenOf(sent[0].text);
    expect(await loadRecovery(db, token, at(1))).toEqual({ status: "pendente", area: "painel", agencyName: "Agência Sol", availableAt: null });

    const r = await confirmRecovery(db, token, { now: at(2) });
    expect(r).toEqual({ ok: true, availableAt: at(50).toISOString() });
    expect(t.mfa_recovery_requests[0]).toMatchObject({ status: "confirmado", confirmed_at: at(2).toISOString(), available_at: at(50).toISOString() });
    expect(sent[1].subject).toBe("Pedido de recuperação do segundo fator confirmado");
    expect(sent[1].text).toContain("Não foi você? Cancele agora: https://boavoz.com/segundo-fator/");
    expect(ownerMails).toEqual(["Alerta de segurança: Recuperação do segundo fator confirmada (o suporte remove o app autenticador em 48 horas)"]);
    expect(platform).toEqual(["Recuperação do segundo fator confirmada"]);
    // confirmar de novo não muda nada
    expect(await confirmRecovery(db, token, { now: at(3) })).toEqual({ ok: false, problem: "fechado" });
    expect(await confirmRecovery(db, "token-que-nao-existe-123456", { now: at(3) })).toEqual({ ok: false, problem: "nao_encontrado" });
  });

  it("sem confirmação em 24 horas, vence (e a pessoa pode pedir de novo)", async () => {
    const { t, db, ops } = setup();
    await requestRecovery(db, painel, { factors: ops, now: T0 });
    const token = tokenOf(sent[0].text);
    expect(effectiveStatus(t.mfa_recovery_requests[0] as never, at(25))).toBe("vencido");
    expect(await confirmRecovery(db, token, { now: at(25) })).toEqual({ ok: false, problem: "vencido" });
    expect(t.mfa_recovery_requests[0].status).toBe("vencido");
    expect(await requestRecovery(db, painel, { factors: ops, now: at(26) })).toEqual({ ok: true });
  });

  it("\"Não fui eu\" cancela, antes ou depois de confirmar", async () => {
    const { t, db, ops } = setup();
    await requestRecovery(db, painel, { factors: ops, now: T0 });
    const token = tokenOf(sent[0].text);
    await confirmRecovery(db, token, { now: at(1) });
    expect(await cancelRecovery(db, token, { now: at(2) })).toEqual({ ok: true });
    expect(t.mfa_recovery_requests[0]).toMatchObject({ status: "cancelado", closed_by: "pessoa (link do e-mail)" });
    expect(await cancelRecovery(db, token, { now: at(3) })).toEqual({ ok: false, problem: "fechado" });
    expect(actions(t)).toEqual(["seguranca.mfa_recuperar_pedir", "seguranca.mfa_recuperar_confirmar", "seguranca.mfa_recuperar_cancelar"]);
  });

  it("o código do app usado de novo derruba o pedido em aberto", async () => {
    const { t, db, ops } = setup();
    await requestRecovery(db, painel, { factors: ops, now: T0 });
    expect(await cancelOnVerified(db, "u1", at(1))).toBe(1);
    expect(t.mfa_recovery_requests[0]).toMatchObject({ status: "cancelado", closed_by: "código do app usado" });
    expect(await cancelOnVerified(db, "u1", at(2))).toBe(0);
  });
});

describe("o suporte", () => {
  it("remove só o confirmado e depois das 48 horas; a pessoa recebe o e-mail", async () => {
    const { t, db, ops, factors } = setup();
    await requestRecovery(db, painel, { factors: ops, now: T0 });
    const id = t.mfa_recovery_requests[0].id as string;
    expect(await supportRemoveFactors(db, id, "ruan@boavoz.com", { check: "Liguei para o WhatsApp do dono", factors: ops, now: at(1) })).toEqual({ ok: false, problem: "fechado" });
    await confirmRecovery(db, tokenOf(sent[0].text), { now: at(1) });
    expect(await supportRemoveFactors(db, id, "ruan@boavoz.com", { check: "Liguei para o WhatsApp do dono", factors: ops, now: at(48) })).toEqual({ ok: false, problem: "espera" });
    // sem a conferência fora do e-mail (M12, relatório de segurança de 23/10/2026), nada sai
    expect(await supportRemoveFactors(db, id, "ruan@boavoz.com", { check: "ok", factors: ops, now: at(49) })).toEqual({ ok: false, problem: "conferencia" });
    expect(factors.removed).toEqual([]);

    expect(await supportRemoveFactors(db, id, "ruan@boavoz.com", { check: "Liguei para o WhatsApp do dono", factors: ops, now: at(49) })).toEqual({ ok: true, removed: 1 });
    expect(factors.removed).toEqual(["f1"]);
    expect(t.mfa_recovery_requests[0]).toMatchObject({ status: "feito", closed_by: "ruan@boavoz.com", close_note: "Conferido fora do e-mail: Liguei para o WhatsApp do dono" });
    expect(t.audit_log.at(-1)).toMatchObject({ action: "seguranca.mfa_remover_suporte", actor_type: "support", actor_id: "ruan@boavoz.com" });
    expect(ownerMails.at(-1)).toBe("Alerta de segurança: Segundo fator removido pelo suporte (recuperação)");
    expect(sent.at(-1)!.subject).toBe("O app autenticador foi removido da sua conta");
    expect(await supportRemoveFactors(db, id, "ruan@boavoz.com", { check: "Liguei para o WhatsApp do dono", factors: ops, now: at(50) })).toEqual({ ok: false, problem: "fechado" });
  });

  it("o Supabase recusou a remoção: o pedido continua confirmado", async () => {
    const { t, db, ops } = setup();
    await requestRecovery(db, painel, { factors: ops, now: T0 });
    await confirmRecovery(db, tokenOf(sent[0].text), { now: T0 });
    const failing: FactorOps = { list: ops.list, remove: async () => Promise.reject(new Error("fora do ar")) };
    expect(await supportRemoveFactors(db, t.mfa_recovery_requests[0].id as string, "ruan@boavoz.com", { check: "Liguei para o WhatsApp do dono", factors: failing, now: at(49) })).toEqual({ ok: false, problem: "erro" });
    expect(t.mfa_recovery_requests[0].status).toBe("confirmado");
  });

  it("recusa com o motivo, que vai no e-mail; na área do cliente, com o nome da agência", async () => {
    const { t, db, ops } = setup();
    await requestRecovery(db, cliente, { factors: ops, now: T0 });
    const id = t.mfa_recovery_requests[0].id as string;
    expect(await supportRefuseRecovery(db, id, "ruan@boavoz.com", "a agência não reconheceu o pedido", at(1))).toEqual({ ok: true });
    expect(t.mfa_recovery_requests[0]).toMatchObject({ status: "recusado", close_note: "a agência não reconheceu o pedido" });
    expect(sent.at(-1)).toMatchObject({ from: "Agência Sol", subject: "O pedido de recuperação do segundo fator não foi atendido" });
    expect(sent.at(-1)!.text).toContain("A equipe de Agência Sol não atendeu");
    expect(sent.at(-1)!.text).not.toMatch(/boavoz/i);
    expect(await supportRefuseRecovery(db, id, "ruan@boavoz.com", "de novo", at(2))).toEqual({ ok: false, problem: "fechado" });
  });

  it("a visão geral conta os em aberto e os prontos; a tarefa diária vence e apaga", async () => {
    const { t, db, ops } = setup();
    await requestRecovery(db, painel, { factors: ops, now: T0 });
    await confirmRecovery(db, tokenOf(sent[0].text), { now: T0 });
    await requestRecovery(db, cliente, { factors: ops, now: T0 });
    expect(await openRecoveryCounts(db, at(10))).toEqual({ open: 2, ready: 0 });
    expect(await openRecoveryCounts(db, at(49))).toEqual({ open: 1, ready: 1 });
    t.mfa_recovery_requests.push({ id: "velho", user_id: "u9", email: "x@y.com", area: "painel", agency_id: "ag1", token_hash: "h", status: "feito", created_at: new Date(T0.getTime() - 400 * 86_400_000).toISOString() });
    expect(await sweepMfaRecoveries(db, at(30))).toEqual({ vencidos: 1, apagados: 1 });
    expect(t.mfa_recovery_requests.map((r) => r.status)).toEqual(["confirmado", "vencido"]);
  });
});
