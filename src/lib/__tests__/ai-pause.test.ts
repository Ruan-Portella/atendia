import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAiPaused } from "../ai-pause";
import { aiBlockedReason } from "../chat";

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
  it("chave geral ou pausa da agência param a IA; sem nada, segue", async () => {
    expect(await isAiPaused(fakeDb({ platform_flags: { ai_paused_at: "2026-10-02T00:00:00Z" }, agencies: { ai_paused_at: null } }), "a1")).toBe(true);
    expect(await isAiPaused(fakeDb({ platform_flags: { ai_paused_at: null }, agencies: { ai_paused_at: "2026-10-02T00:00:00Z" } }), "a1")).toBe(true);
    expect(await isAiPaused(fakeDb({ platform_flags: { ai_paused_at: null }, agencies: { ai_paused_at: null } }), "a1")).toBe(false);
    // sem linha (erro de leitura): não pausa
    expect(await isAiPaused(fakeDb({}), "a1")).toBe(false);
  });

  it("no WhatsApp e no Instagram a pausa vira modo só humano (antes do plano)", async () => {
    const paused = fakeDb({ platform_flags: { ai_paused_at: "2026-10-02T00:00:00Z" }, agencies: { ai_paused_at: null } });
    expect(await aiBlockedReason(paused, "a1")).toBe("paused");
    const ok = fakeDb({ platform_flags: { ai_paused_at: null }, agencies: { ai_paused_at: null } });
    expect(await aiBlockedReason(ok, "a1")).toBeNull();
  });
});
