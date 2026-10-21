import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// as taxas das últimas mensagens vêm de fora: aqui, o que cada teste pede
const stats = { inbound: { total: 0, retried: 0 }, sends: { whatsapp: { sent: 0, failed: 0 }, instagram: { sent: 0, failed: 0 } } };
vi.mock("../inbound-queue", () => ({ inboundErrorStats: vi.fn(async () => stats.inbound) }));
vi.mock("../messages", () => ({ sendFailureStatsByChannel: vi.fn(async () => stats.sends) }));

import { memoryDb, type MemRow } from "../memory-db";
import { dayLevels, isStatusHost, nextState, runStatusCheck, statesFromSignals, type StatusIncident, type StatusSignals } from "../status";

const quiet: StatusSignals = { dbWrite: true, oldestPendingSeconds: { whatsapp: null, instagram: null }, inbound: { total: 200, retried: 3 }, sends: { whatsapp: { sent: 100, failed: 2 }, instagram: { sent: 50, failed: 0 } } };

describe("página de status: as regras", () => {
  it("tudo certo; banco sem escrita derruba tudo", () => {
    expect(Object.values(statesFromSignals(quiet)).map((s) => s.state)).toEqual(["operando", "operando", "operando", "operando", "operando", "operando"]);
    const down = statesFromSignals({ ...quiet, dbWrite: false });
    expect(new Set(Object.values(down).map((s) => s.state))).toEqual(new Set(["fora"]));
  });

  it("WhatsApp e Instagram: a fila parada e as respostas recusadas, só com um mínimo de casos", () => {
    expect(statesFromSignals({ ...quiet, oldestPendingSeconds: { whatsapp: 11 * 60, instagram: null } }).whatsapp).toEqual({ state: "instavel", reason: "as mensagens recebidas estão atrasadas (11 minutos)" });
    expect(statesFromSignals({ ...quiet, oldestPendingSeconds: { whatsapp: 31 * 60, instagram: null } }).whatsapp.state).toBe("fora");
    expect(statesFromSignals({ ...quiet, sends: { ...quiet.sends, instagram: { sent: 40, failed: 12 } } }).instagram).toEqual({ state: "instavel", reason: "30% das respostas recusadas pelo canal" });
    expect(statesFromSignals({ ...quiet, sends: { ...quiet.sends, instagram: { sent: 20, failed: 15 } } }).instagram.state).toBe("fora");
    // pouco volume não acende nada
    expect(statesFromSignals({ ...quiet, sends: { ...quiet.sends, instagram: { sent: 6, failed: 5 } } }).instagram.state).toBe("operando");
    // o pior dos dois sinais vale
    expect(statesFromSignals({ ...quiet, oldestPendingSeconds: { whatsapp: 11 * 60, instagram: null }, sends: { ...quiet.sends, whatsapp: { sent: 20, failed: 15 } } }).whatsapp.state).toBe("fora");
  });

  it("IA: as mensagens que precisaram de outra tentativa", () => {
    expect(statesFromSignals({ ...quiet, inbound: { total: 40, retried: 12 } }).ia).toEqual({ state: "instavel", reason: "30% das mensagens precisaram de outra tentativa" });
    expect(statesFromSignals({ ...quiet, inbound: { total: 40, retried: 30 } }).ia.state).toBe("fora");
    expect(statesFromSignals({ ...quiet, inbound: { total: 12, retried: 10 } }).ia.state).toBe("fora");
    expect(statesFromSignals({ ...quiet, inbound: { total: 9, retried: 9 } }).ia.state).toBe("operando");
  });

  it("a leitura dupla: muda só quando duas seguidas concordam", () => {
    const a = nextState({ state: "operando", pending_state: null, pending_count: 0 }, "fora");
    expect(a).toEqual({ state: "operando", pending_state: "fora", pending_count: 1, changed: false });
    expect(nextState(a, "fora")).toEqual({ state: "fora", pending_state: null, pending_count: 0, changed: true });
    // a segunda leitura discorda: recomeça a contar
    expect(nextState(a, "instavel")).toEqual({ state: "operando", pending_state: "instavel", pending_count: 1, changed: false });
    // voltou ao normal antes de confirmar: limpa
    expect(nextState(a, "operando")).toEqual({ state: "operando", pending_state: null, pending_count: 0, changed: false });
  });

  it("os 90 dias: sem registro antes do começo, os minutos de cada dia e os incidentes (manutenção não conta)", () => {
    const incident = (o: Partial<StatusIncident>): StatusIncident => ({ id: "i", title: "t", level: "fora", components: ["whatsapp"], startedAt: "2026-10-19T10:00:00.000Z", resolvedAt: "2026-10-19T12:00:00.000Z", updates: [], ...o });
    const days = dayLevels(
      [
        { day: "2026-10-17", degraded_minutes: 20, down_minutes: 0 },
        { day: "2026-10-18", degraded_minutes: 0, down_minutes: 20 },
        { day: "2026-10-20", degraded_minutes: 5, down_minutes: 0 },
      ],
      [incident({}), incident({ level: "manutencao", startedAt: "2026-10-21T01:00:00.000Z", resolvedAt: null })],
      "whatsapp",
      "2026-10-16",
      "2026-10-21",
      7,
    );
    expect(days).toEqual([
      { day: "2026-10-15", level: "sem_registro" },
      { day: "2026-10-16", level: "ok" },
      { day: "2026-10-17", level: "instavel" },
      { day: "2026-10-18", level: "fora" },
      { day: "2026-10-19", level: "fora" },
      { day: "2026-10-20", level: "ok" },
      { day: "2026-10-21", level: "ok" },
    ]);
  });

  it("status.<domínio do app> mostra a página; o de uma agência, não", () => {
    expect(isStatusHost("status.boavoz.com", "boavoz.com")).toBe(true);
    expect(isStatusHost("STATUS.boavoz.com:443", "www.boavoz.com")).toBe(true);
    expect(isStatusHost("status.dev.boavoz.com", "dev.boavoz.com")).toBe(true);
    expect(isStatusHost("status.agencia.com.br", "boavoz.com")).toBe(false);
    expect(isStatusHost("boavoz.com", "boavoz.com")).toBe(false);
    expect(isStatusHost(null, "boavoz.com")).toBe(false);
  });
});

describe("página de status: a conferência", () => {
  let tables: Record<string, MemRow[]>;
  let minutes: Array<Record<string, unknown>>;
  function db() {
    const base = memoryDb(tables);
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => (minutes.push(args), { data: null, error: null }));
    return new Proxy(base, { get: (t, k) => (k === "rpc" ? rpc : (t as unknown as Record<string | symbol, unknown>)[k]) }) as SupabaseClient;
  }
  beforeEach(() => {
    minutes = [];
    stats.inbound = { total: 100, retried: 2 };
    stats.sends = { whatsapp: { sent: 50, failed: 0 }, instagram: { sent: 10, failed: 0 } };
    tables = {
      status_current: ["painel", "chat", "whatsapp", "instagram", "ia", "api"].map((component) => ({ component, state: "operando", since: "2026-10-21T00:00:00.000Z", pending_state: null, pending_count: 0, checked_at: null, reason: null })),
      health_checks: [],
      inbound_events: [{ id: 1, source: "whatsapp", status: "received", kind: "msg", created_at: "2026-10-21T11:20:00.000Z" }],
    };
  });

  it("duas leituras com a fila do WhatsApp parada há mais de 30 minutos: fora, com o motivo e os minutos do dia; antes de 5 minutos, não confere", async () => {
    const t0 = new Date("2026-10-21T12:00:00.000Z");
    expect(await runStatusCheck(db(), t0)).toEqual({ ran: true, changed: [] });
    expect(tables.status_current.find((r) => r.component === "whatsapp")).toMatchObject({ state: "operando", pending_state: "fora", pending_count: 1 });
    expect(await runStatusCheck(db(), new Date(t0.getTime() + 2 * 60_000))).toEqual({ ran: false, changed: [] });
    const t1 = new Date(t0.getTime() + 5 * 60_000);
    expect(await runStatusCheck(db(), t1)).toEqual({ ran: true, changed: ["whatsapp"] });
    expect(tables.status_current.find((r) => r.component === "whatsapp")).toMatchObject({ state: "fora", since: t1.toISOString(), reason: "as mensagens recebidas estão paradas há 45 minutos", pending_count: 0 });
    expect(minutes).toEqual([{ p_component: "whatsapp", p_state: "fora", p_minutes: 5 }]);
    // os outros seguem operando
    expect(tables.status_current.filter((r) => r.state !== "operando").map((r) => r.component)).toEqual(["whatsapp"]);
  });
});
