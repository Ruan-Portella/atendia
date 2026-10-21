import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mails: string[] = [];
vi.mock("../notify", () => ({ notifyAgencyOwner: vi.fn(async (_db: unknown, _id: string, subject: string) => (mails.push(subject), true)) }));

import { memoryDb, type MemRow } from "../memory-db";
import { ACTION_PER_BOT_MINUTE, ACTION_PER_CONVERSATION_MINUTE, actionCapEmail, actionCapNotice, checkActionLimits, monthlyActionCap } from "../action-limits";

const BOT = "b0000000-0000-4000-8000-000000000001";

/** O banco em memória com os dois contadores do banco: o do minuto (por chave) e o do mês. */
function db(tables: Record<string, MemRow[]>, o: { monthCalls?: number } = {}) {
  const base = memoryDb(tables);
  const minute = new Map<string, number>();
  let month = o.monthCalls ?? 0;
  const rpc = vi.fn(async (fn: string, a: Record<string, unknown>) => {
    if (fn === "hit_rate_limit") {
      const n = (minute.get(a.p_key as string) ?? 0) + 1;
      minute.set(a.p_key as string, n);
      return { data: n <= (a.p_max as number), error: null };
    }
    if (fn === "hit_action_month") return { data: ++month <= (a.p_cap as number), error: null };
    return { data: null, error: { message: fn } };
  });
  return new Proxy(base, { get: (t, k) => (k === "rpc" ? rpc : (t as unknown as Record<string | symbol, unknown>)[k]) }) as SupabaseClient;
}

const tables = (bot: MemRow = {}): Record<string, MemRow[]> => ({ bots: [{ id: BOT, agency_id: "ag1", name: "Lia", client_name: "Bar do Zé", size: "P", volume_packs: null, quota_override: null, prorated_month: null, prorated_quota: null, action_cap_hit_at: null, action_cap_kind: null, ...bot }] });

beforeEach(() => {
  mails.length = 0;
});

describe("tetos das chamadas de ação", () => {
  it("o teto do mês é 10 vezes a cota, no mínimo 1.000", () => {
    expect(monthlyActionCap({ size: "P" })).toBe(1600);
    expect(monthlyActionCap({ size: "volume", volume_packs: 2 })).toBe(20_000);
    expect(monthlyActionCap({ size: null })).toBe(1000);
    expect(monthlyActionCap({ size: "P", quota_override: 50 })).toBe(1000);
    expect(monthlyActionCap({ size: "G", quota_override: 5000 })).toBe(50_000);
  });

  it("na conversa: a 16ª chamada no minuto volta o teto da conversa, sem aviso ao dono", async () => {
    const t = tables();
    const d = db(t);
    for (let n = 0; n < ACTION_PER_CONVERSATION_MINUTE; n++) expect(await checkActionLimits(d, { botId: BOT, conversationId: "c1" })).toBeNull();
    expect(await checkActionLimits(d, { botId: BOT, conversationId: "c1" })).toBe("conversa");
    expect(mails).toEqual([]);
    expect(t.bots[0].action_cap_hit_at).toBeNull();
  });

  it("no chatbot: a 601ª chamada no minuto volta o teto, guarda o aviso da aba Ações e manda um e-mail por dia", async () => {
    const t = tables();
    const d = db(t);
    const now = new Date("2026-10-21T15:00:00.000Z");
    for (let n = 0; n < ACTION_PER_BOT_MINUTE; n++) await checkActionLimits(d, { botId: BOT, conversationId: `c${n}` }, now);
    expect(await checkActionLimits(d, { botId: BOT, conversationId: "outra" }, now)).toBe("bot_minuto");
    expect(await checkActionLimits(d, { botId: BOT, conversationId: "mais-uma" }, now)).toBe("bot_minuto");
    expect(t.bots[0]).toMatchObject({ action_cap_hit_at: now.toISOString(), action_cap_kind: "minuto" });
    expect(mails).toEqual(["O chatbot Lia (Bar do Zé) bateu o teto de chamadas de ação por minuto"]);
    expect(actionCapNotice(t.bots[0] as { action_cap_hit_at: string; action_cap_kind: string }, new Date("2026-10-21T20:00:00.000Z"))).toContain("600 chamadas de ação por minuto");
    expect(actionCapNotice(t.bots[0] as { action_cap_hit_at: string; action_cap_kind: string }, new Date("2026-10-22T16:00:00.000Z"))).toBeNull();
  });

  it("no mês: passou de 10 vezes a cota, a IA oferece a equipe até o dia 1º; o e-mail sai uma vez no mês", async () => {
    const t = tables();
    const d = db(t, { monthCalls: 1599 });
    const now = new Date("2026-10-21T15:00:00.000Z");
    expect(await checkActionLimits(d, { botId: BOT, conversationId: "c1" }, now)).toBeNull();
    expect(await checkActionLimits(d, { botId: BOT, conversationId: "c2" }, now)).toBe("mes");
    expect(await checkActionLimits(d, { botId: BOT, conversationId: "c3" }, now)).toBe("mes");
    expect(t.bots[0]).toMatchObject({ action_cap_kind: "mes" });
    expect(mails).toEqual(["O chatbot Lia (Bar do Zé) chegou ao teto de chamadas de ação do mês"]);
    expect(actionCapNotice(t.bots[0] as { action_cap_hit_at: string; action_cap_kind: string }, new Date("2026-10-30T12:00:00.000Z"))).toContain("até o dia 1º");
    expect(actionCapNotice(t.bots[0] as { action_cap_hit_at: string; action_cap_kind: string }, new Date("2026-11-02T12:00:00.000Z"))).toBeNull();
  });

  it("os e-mails dizem o teto e o caminho", () => {
    const [s1, l1] = actionCapEmail("minuto", { name: "Lia", clientName: null }, 600, "https://x/acoes");
    expect(s1).toBe("O chatbot Lia bateu o teto de chamadas de ação por minuto");
    expect(l1.join(" ")).toContain("fale com o suporte");
    const [, l2] = actionCapEmail("mes", { name: "Lia", clientName: "Bar" }, 1600, "https://x/acoes");
    expect(l2.join(" ")).toMatch(/1\.600 chamadas de ação neste mês/);
    expect(l2.join(" ")).toContain("suba o tamanho");
  });
});
