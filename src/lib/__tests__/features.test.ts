import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TRIAL_WHATSAPP_LOCKED, channelAccess, channelBlock, trialContentProblem } from "../features";

const closed = { whatsappOpenAt: null, instagramOpenAt: null };
const open = { whatsappOpenAt: "2026-11-01T00:00:00Z", instagramOpenAt: "2026-11-01T00:00:00Z" };

describe("liberação por agência", () => {
  it("antes da abertura: só quem foi liberado no backoffice", () => {
    expect(channelAccess({ plan: "agencia", features: ["whatsapp"] }, "whatsapp", closed)).toBe("liberado");
    expect(channelAccess({ plan: "agencia", features: [] }, "whatsapp", closed)).toBe("fechado");
    // liberar o WhatsApp não libera o Instagram
    expect(channelAccess({ plan: "agencia", features: ["whatsapp"] }, "instagram", closed)).toBe("fechado");
    expect(channelAccess({ plan: "trial", features: null }, "instagram", closed)).toBe("fechado");
  });

  it("depois da abertura: planos pagos conectam; o teste grátis com WhatsApp espera a liberação manual", () => {
    expect(channelAccess({ plan: "freelancer", features: [] }, "whatsapp", open)).toBe("liberado");
    expect(channelAccess({ plan: "trial", features: [] }, "whatsapp", open)).toBe("aguardando");
    expect(channelAccess({ plan: "trial", features: ["whatsapp"] }, "whatsapp", open)).toBe("liberado");
    expect(channelAccess({ plan: "trial", features: [] }, "instagram", open)).toBe("liberado");
  });

  it("teste grátis: o número real só conecta com 1 fonte pronta e as instruções escritas", () => {
    expect(trialContentProblem(0, "Atenda com educação")).toMatch(/fonte pronta/);
    expect(trialContentProblem(2, "   ")).toMatch(/instruções/);
    expect(trialContentProblem(1, null)).toMatch(/instruções/);
    expect(trialContentProblem(1, "Atenda com educação")).toBeNull();
  });
});

/** Banco falso: agência, abertura dos canais, fontes prontas e as instruções do bot. */
function fakeDb(o: { plan: string; features: string[]; opening?: typeof open; sources?: number; instructions?: string | null }) {
  const rows: Record<string, unknown> = {
    agencies: { plan: o.plan, features: o.features },
    platform_flags: { whatsapp_open_at: o.opening?.whatsappOpenAt ?? null, instagram_open_at: o.opening?.instagramOpenAt ?? null },
    bots: { persona: { instructions: o.instructions ?? null } },
  };
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null }),
        then: (resolve: (x: { count: number }) => unknown) => resolve({ count: o.sources ?? 0 }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe("channelBlock", () => {
  it("diz por que não pode, ou null", async () => {
    expect(await channelBlock(fakeDb({ plan: "agencia", features: [] }), "a1", "whatsapp")).toBe("O WhatsApp ainda não está disponível na sua conta.");
    expect(await channelBlock(fakeDb({ plan: "trial", features: [], opening: open }), "a1", "whatsapp")).toBe(TRIAL_WHATSAPP_LOCKED);
    expect(await channelBlock(fakeDb({ plan: "agencia", features: ["whatsapp"] }), "a1", "whatsapp", "b1")).toBeNull();
  });

  it("conectar no teste grátis confere o conteúdo do chatbot", async () => {
    const trial = { plan: "trial", features: ["whatsapp"] };
    expect(await channelBlock(fakeDb({ ...trial, sources: 0, instructions: "x" }), "a1", "whatsapp", "b1")).toMatch(/fonte pronta/);
    expect(await channelBlock(fakeDb({ ...trial, sources: 1, instructions: "Atenda bem" }), "a1", "whatsapp", "b1")).toBeNull();
    // sem conectar (ex.: modelos), o conteúdo não importa
    expect(await channelBlock(fakeDb({ ...trial, sources: 0 }), "a1", "whatsapp")).toBeNull();
  });
});
