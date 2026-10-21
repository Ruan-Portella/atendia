import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUDIOS_PER_DAY, AUDIO_UNKNOWN_MAX_BYTES, audioLimit, audioTooLong, longAudioAskDue } from "../audio-limits";

const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const le64 = (n: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, BigInt(n), true);
  return b;
};
const bytes = (...parts: Array<string | number[] | Uint8Array>) => {
  const chunks = parts.map((p) => (typeof p === "string" ? new TextEncoder().encode(p) : p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};
const oggPage = (granule: number) => bytes("OggS", [0, 0], le64(granule), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 19]);
/** Áudio do WhatsApp (OGG/Opus) com a duração pedida. */
const opus = (seconds: number) => bytes(oggPage(0), bytes("OpusHead", [1, 1], le16(0), le32(48_000), [0, 0, 0]), oggPage(48_000 * seconds));

/** Contador de hit_rate_limit em memória (como a função do banco). */
function limiterDb(): SupabaseClient {
  const hits = new Map<string, number>();
  return {
    rpc: async (_fn: string, a: { p_key: string; p_max: number }) => {
      const n = (hits.get(a.p_key) ?? 0) + 1;
      hits.set(a.p_key, n);
      return { data: n <= a.p_max, error: null };
    },
  } as unknown as SupabaseClient;
}

describe("limites de áudio", () => {
  it("5 minutos por áudio, pela duração do arquivo; sem duração, pelo tamanho", () => {
    expect(audioTooLong(opus(290))).toBe(false);
    expect(audioTooLong(opus(6 * 60))).toBe(true);
    expect(audioTooLong(new Uint8Array(1000))).toBe(false);
    expect(audioTooLong(new Uint8Array(AUDIO_UNKNOWN_MAX_BYTES + 1))).toBe(true);
  });

  it("até 30 transcritos por dia por contato; o longo não gasta a conta do dia", async () => {
    const db = limiterDb();
    expect(await audioLimit(db, "bot:5521", opus(600))).toBe("longo");
    for (let i = 0; i < AUDIOS_PER_DAY; i++) expect(await audioLimit(db, "bot:5521", opus(20))).toBeNull();
    expect(await audioLimit(db, "bot:5521", opus(20))).toBe("dia");
    // outro contato tem os dele
    expect(await audioLimit(db, "bot:5522", opus(20))).toBeNull();
  });

  it("o pedido de resumo vai uma vez por dia", async () => {
    const db = limiterDb();
    expect(await longAudioAskDue(db, "bot:5521")).toBe(true);
    expect(await longAudioAskDue(db, "bot:5521")).toBe(false);
  });
});
