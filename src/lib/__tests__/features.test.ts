import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { channelAccess, channelBlock } from "../features";

const closed = { whatsappOpenAt: null, instagramOpenAt: null };
const open = { whatsappOpenAt: "2026-11-01T00:00:00Z", instagramOpenAt: "2026-11-01T00:00:00Z" };

describe("liberação por agência", () => {
  it("antes da abertura: só quem foi liberado no backoffice", () => {
    expect(channelAccess({ features: ["whatsapp"] }, "whatsapp", closed)).toBe("liberado");
    expect(channelAccess({ features: [] }, "whatsapp", closed)).toBe("fechado");
    // liberar o WhatsApp não libera o Instagram
    expect(channelAccess({ features: ["whatsapp"] }, "instagram", closed)).toBe("fechado");
    expect(channelAccess({ features: null }, "instagram", closed)).toBe("fechado");
  });

  it("depois da abertura: toda conta conecta (o chatbot atende com um tamanho)", () => {
    expect(channelAccess({ features: [] }, "whatsapp", open)).toBe("liberado");
    expect(channelAccess({ features: null }, "instagram", open)).toBe("liberado");
  });
});

/** Banco falso: agência e abertura dos canais. */
function fakeDb(o: { features: string[]; opening?: typeof open }) {
  const rows: Record<string, unknown> = {
    agencies: { features: o.features },
    platform_flags: { whatsapp_open_at: o.opening?.whatsappOpenAt ?? null, instagram_open_at: o.opening?.instagramOpenAt ?? null },
  };
  return {
    from(table: string) {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: rows[table] ?? null }) };
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe("channelBlock", () => {
  it("diz por que não pode, ou null", async () => {
    expect(await channelBlock(fakeDb({ features: [] }), "a1", "whatsapp")).toBe("O WhatsApp ainda não está disponível na sua conta.");
    expect(await channelBlock(fakeDb({ features: ["whatsapp"] }), "a1", "whatsapp")).toBeNull();
    expect(await channelBlock(fakeDb({ features: [], opening: open }), "a1", "whatsapp")).toBeNull();
  });
});
