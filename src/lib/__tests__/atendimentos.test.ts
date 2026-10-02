import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { agencyQuotaEmail, clientAlertLevel, clientCapEmail, contactKeyHash, openAtendimento, quotaAlertLevel } from "../atendimentos";
import { hardLimitOf, quotaOf } from "../quota";
import { PLANS } from "../plans";

process.env.CONTACT_HASH_KEY ??= "chave-de-teste-com-mais-de-16-caracteres";

describe("cota do mês", () => {
  it("a cota combinada fora do plano vale no lugar da do plano", () => {
    expect(quotaOf({ plan: "agencia" })).toBe(PLANS.agencia.atendimentos);
    expect(quotaOf({ plan: "agencia", quota_override: 15000 })).toBe(15000);
    expect(quotaOf({ plan: "freelancer", quota_override: 0 })).toBe(0);
    expect(quotaOf({ plan: "cancelado" })).toBe(0);
  });

  it("tolerância de 10% sobre a cota (cota pequena não tem)", () => {
    expect(hardLimitOf(2000)).toBe(2200);
    expect(hardLimitOf(200)).toBe(220);
    expect(hardLimitOf(5)).toBe(5);
    expect(hardLimitOf(0)).toBe(0);
  });
});

describe("avisos de cota (cada um sai uma vez: o contador sobe de 1 em 1)", () => {
  it("agência: 80%, 100% e o fim da tolerância", () => {
    expect(quotaAlertLevel(1600, 2000)).toBe(80);
    expect(quotaAlertLevel(1599, 2000)).toBeNull();
    expect(quotaAlertLevel(1601, 2000)).toBeNull();
    expect(quotaAlertLevel(2000, 2000)).toBe(100);
    expect(quotaAlertLevel(2001, 2000)).toBeNull();
    expect(quotaAlertLevel(2200, 2000)).toBe("fim");
    expect(quotaAlertLevel(1, 0)).toBeNull();
  });

  it("cota pequena: o aviso de 100% já é o do modo só humano", () => {
    expect(quotaAlertLevel(4, 5)).toBe(80);
    expect(quotaAlertLevel(5, 5)).toBe("fim");
  });

  it("sublimite do cliente: 80% e 100%", () => {
    expect(clientAlertLevel(80, 100)).toBe(80);
    expect(clientAlertLevel(100, 100)).toBe(100);
    expect(clientAlertLevel(101, 100)).toBeNull();
    expect(clientAlertLevel(1, 1)).toBe(100);
    expect(clientAlertLevel(3, 0)).toBeNull();
  });

  it("os e-mails dizem os números e o que acontece depois", () => {
    const [s80, l80] = agencyQuotaEmail(80, 1600, 2000, "outubro de 2026", "https://x/uso");
    expect(s80).toContain("80%");
    expect(l80.join("\n")).toContain("1.600 de 2.000");
    expect(l80.join("\n")).toContain("até 2.200");
    const [, l100] = agencyQuotaEmail(100, 2000, 2000, "outubro de 2026", "https://x/uso");
    expect(l100.join("\n")).toContain("mais 200 atendimentos");
    const [sFim] = agencyQuotaEmail("fim", 2200, 2000, "outubro de 2026", "https://x/uso");
    expect(sFim).toContain("modo só humano");
    const [sc, lc] = clientCapEmail(100, "Bar do Zé", 300, "outubro de 2026", "https://x/uso");
    expect(sc).toContain("Bar do Zé");
    expect(lc.join("\n")).toContain("limite de 300");
  });
});

describe("abertura do atendimento", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Banco falso: devolve a linha de open_atendimento e guarda os parâmetros. */
  function fake(row: Record<string, unknown> | null, error: { message: string } | null = null) {
    const calls: Array<Record<string, unknown>> = [];
    const db = {
      rpc: vi.fn(async (_fn: string, args: Record<string, unknown>) => (calls.push(args), { data: row ? [row] : null, error })),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    } as unknown as SupabaseClient;
    return { db, calls };
  }
  const bot = { id: "b1", agency_id: "a1" };

  it("a chave do contato vai em hash, diferente por canal, e a cota de cada plano vai junto", async () => {
    const { db, calls } = fake({ status: "aberto", atendimento_id: 7 });
    const r = await openAtendimento(db, bot, { channel: "whatsapp", contactKey: "contato-1", conversationId: "c1" });
    expect(r).toEqual({ blocked: null, isNew: false, id: 7 });
    expect(calls[0].p_contact_key_hash).toBe(contactKeyHash("whatsapp", "contato-1"));
    expect(calls[0].p_contact_key_hash).not.toContain("contato-1");
    expect(contactKeyHash("widget", "contato-1")).not.toBe(contactKeyHash("whatsapp", "contato-1"));
    expect(calls[0].p_plan_quotas).toMatchObject({ trial: PLANS.trial.atendimentos, agencia: PLANS.agencia.atendimentos });
  });

  it("sem vaga: devolve o motivo (agência ou cliente)", async () => {
    expect((await openAtendimento(fake({ status: "cota" }).db, bot, { channel: "widget", contactKey: "v1", conversationId: null })).blocked).toBe("quota_exceeded");
    expect((await openAtendimento(fake({ status: "sublimite" }).db, bot, { channel: "instagram", contactKey: "k", conversationId: "c" })).blocked).toBe("client_quota_exceeded");
  });

  it("novo: conta 1", async () => {
    const r = await openAtendimento(fake({ status: "novo", atendimento_id: 9, used: 10, quota: 2000, client_used: null, client_cap: null }).db, bot, { channel: "whatsapp", contactKey: "k", conversationId: "c" });
    expect(r).toEqual({ blocked: null, isNew: true, id: 9 });
  });

  it("erro do banco não para o bot", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await openAtendimento(fake(null, { message: "timeout" }).db, bot, { channel: "whatsapp", contactKey: "k", conversationId: "c" });
    expect(r.blocked).toBeNull();
  });
});
