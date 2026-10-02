import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAiPaused } from "../ai-pause";
import { aiBlockedReason } from "../chat";
import { extendedTrialEnd } from "../backoffice";

/** Banco de mentira: cada tabela devolve a linha dada em maybeSingle (e uso zerado). */
function fakeDb(rows: Record<string, Record<string, unknown> | null>) {
  return {
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: rows[table] ?? null }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

describe("pausa da IA pelo backoffice", () => {
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString();

  it("chave geral ou pausa da agência param a IA; sem nada, segue", async () => {
    expect(await isAiPaused(fakeDb({ platform_flags: { ai_paused_at: "2026-10-02T00:00:00Z" }, agencies: { ai_paused_at: null } }), "a1")).toBe(true);
    expect(await isAiPaused(fakeDb({ platform_flags: { ai_paused_at: null }, agencies: { ai_paused_at: "2026-10-02T00:00:00Z" } }), "a1")).toBe(true);
    expect(await isAiPaused(fakeDb({ platform_flags: { ai_paused_at: null }, agencies: { ai_paused_at: null } }), "a1")).toBe(false);
    // sem linha (erro de leitura): não pausa
    expect(await isAiPaused(fakeDb({}), "a1")).toBe(false);
  });

  it("no WhatsApp e no Instagram a pausa vira modo só humano (antes do plano)", async () => {
    const paused = fakeDb({ platform_flags: { ai_paused_at: "2026-10-02T00:00:00Z" }, agencies: { plan: "agencia", trial_ends_at: future, ai_paused_at: null } });
    expect(await aiBlockedReason(paused, "a1")).toBe("paused");
    const ok = fakeDb({ platform_flags: { ai_paused_at: null }, agencies: { plan: "agencia", trial_ends_at: future, ai_paused_at: null } });
    expect(await aiBlockedReason(ok, "a1")).toBeNull();
  });
});

describe("estender o teste", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  it("a partir do fim atual se ainda está valendo", () => {
    expect(extendedTrialEnd("2026-10-05T12:00:00Z", 7, now)).toBe("2026-10-12T12:00:00.000Z");
  });
  it("a partir de hoje se já venceu", () => {
    expect(extendedTrialEnd("2026-09-20T12:00:00Z", 7, now)).toBe("2026-10-09T12:00:00.000Z");
    expect(extendedTrialEnd(null, 3, now)).toBe("2026-10-05T12:00:00.000Z");
  });
});
