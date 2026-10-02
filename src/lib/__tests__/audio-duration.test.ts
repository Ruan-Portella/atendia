import { describe, expect, it } from "vitest";
import { audioDurationSeconds } from "../audio-duration";
import { costUsd, usageFrom } from "../ai-usage";

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
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const le64 = (n: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, BigInt(n), true);
  return b;
};
/** Cabeçalho de página OGG até o granule (o resto da página não importa para a leitura). */
const oggPage = (granule: number) => bytes("OggS", [0, 0], le64(granule), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 19]);

describe("duração do áudio lida do arquivo", () => {
  it("OGG/Opus (áudio do WhatsApp): granule da última página ÷ 48 kHz, menos o pre-skip", () => {
    const opusHead = bytes("OpusHead", [1, 1], le16(312), le32(48_000), [0, 0, 0]);
    const audio = bytes(oggPage(0), opusHead, oggPage(48_000 * 2), new Uint8Array(200), oggPage(48_000 * 5 + 312), new Uint8Array(50));
    expect(audioDurationSeconds(audio)).toBe(5);
  });

  it("OGG/Vorbis: pela taxa do cabeçalho", () => {
    const head = bytes("\u0001vorbis", le32(0), [2], le32(44_100), new Uint8Array(12));
    expect(audioDurationSeconds(bytes(oggPage(0), head, oggPage(44_100 * 3)))).toBe(3);
  });

  it("MP4/M4A (áudio do Instagram): caixa mvhd, versões 0 e 1", () => {
    const v0 = bytes(be32(20), "ftypM4A ", new Uint8Array(8), be32(108), "mvhd", [0, 0, 0, 0], be32(0), be32(0), be32(1000), be32(7500), new Uint8Array(80));
    expect(audioDurationSeconds(v0)).toBe(7.5);
    const v1 = bytes(be32(20), "ftypisom", new Uint8Array(8), be32(120), "mvhd", [1, 0, 0, 0], new Uint8Array(16), be32(44_100), [0, 0, 0, 0], be32(44_100 * 12), new Uint8Array(80));
    expect(audioDurationSeconds(v1)).toBe(12);
  });

  it("WAV: dados ÷ bytes por segundo", () => {
    const wav = bytes("RIFF", le32(0), "WAVE", "fmt ", le32(16), le16(1), le16(1), le32(16_000), le32(32_000), le16(2), le16(16), "data", le32(32_000 * 4), new Uint8Array(10));
    expect(audioDurationSeconds(wav)).toBe(4);
  });

  it("formato desconhecido ou arquivo cortado: null (nunca chuta)", () => {
    expect(audioDurationSeconds(bytes("ID3", new Uint8Array(100)))).toBeNull();
    expect(audioDurationSeconds(bytes("OggS", [0, 0]))).toBeNull();
    expect(audioDurationSeconds(new Uint8Array(0))).toBeNull();
  });
});

describe("custo da transcrição e das IAs pequenas", () => {
  it("duração desconhecida: sem preço (null), nunca zero", () => {
    expect(costUsd({ audioModel: "gpt-4o-mini-transcribe", audioSeconds: null })).toBeNull();
    expect(costUsd({ audioModel: "gpt-4o-mini-transcribe", audioSeconds: 60 })).toBe(0.003);
  });

  it("uso de uma chamada no formato da tabela (classificador no gpt-4.1-nano)", () => {
    const u = usageFrom("gpt-4.1-nano-2025-04-14", { inputTokens: 1000, outputTokens: 100, inputTokenDetails: { cacheReadTokens: 0 } });
    expect(u).toEqual({ model: "gpt-4.1-nano-2025-04-14", inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100 });
    // 1000 × 0,10 + 100 × 0,40 por milhão
    expect(costUsd(u)).toBe(0.00014);
  });
});
