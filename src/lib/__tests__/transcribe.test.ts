import { afterEach, describe, expect, it, vi } from "vitest";

const transcribe = vi.fn();
vi.mock("ai", async (orig) => ({ ...(await orig<typeof import("ai")>()), transcribe }));

/** Carrega o módulo de IA com as chaves dadas (os provedores leem as chaves ao carregar). */
async function load(keys: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of ["GROQ_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"]) vi.stubEnv(k, keys[k] ?? "");
  return import("../ai");
}
const fromGroq = (call: unknown[]) => String((call[0] as { model: { provider: string } }).model.provider).startsWith("groq");

describe("transcrição: Groq com a OpenAI de reserva", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    transcribe.mockReset();
  });

  it("usa a Groq quando ela responde", async () => {
    transcribe.mockResolvedValueOnce({ text: " oi, tudo bem? ", durationInSeconds: 4 });
    const { transcribeAudio } = await load({ GROQ_API_KEY: "g", OPENAI_API_KEY: "o" });
    const onUsage = vi.fn();
    expect(await transcribeAudio(new Uint8Array([1, 2, 3]), onUsage)).toBe("oi, tudo bem?");
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(fromGroq(transcribe.mock.calls[0])).toBe(true);
    // sem novas tentativas na Groq: a reserva já cobre a falha
    expect(transcribe.mock.calls[0][0]).toMatchObject({ maxRetries: 0 });
    expect(onUsage).toHaveBeenCalledWith({ audioModel: "whisper-large-v3-turbo", audioSeconds: 4 });
  });

  it("Groq recusou ou bateu o limite: a OpenAI transcreve", async () => {
    transcribe.mockRejectedValueOnce(new Error("429 rate limit")).mockResolvedValueOnce({ text: "pedido de pizza", durationInSeconds: 6 });
    const { transcribeAudio } = await load({ GROQ_API_KEY: "g", OPENAI_API_KEY: "o" });
    const onUsage = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await transcribeAudio(new Uint8Array([1]), onUsage)).toBe("pedido de pizza");
    expect(transcribe.mock.calls.map(fromGroq)).toEqual([true, false]);
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith({ audioModel: "gpt-4o-mini-transcribe", audioSeconds: 6 });
  });

  it("Groq falhou e não há reserva: o erro sobe", async () => {
    transcribe.mockRejectedValueOnce(new Error("503"));
    const { transcribeAudio } = await load({ GROQ_API_KEY: "g" });
    await expect(transcribeAudio(new Uint8Array([1]))).rejects.toThrow("503");
  });

  it("sem a chave da Groq, segue direto na OpenAI", async () => {
    transcribe.mockResolvedValueOnce({ text: "ok", durationInSeconds: 2 });
    const { transcribeAudio, canTranscribe } = await load({ OPENAI_API_KEY: "o" });
    expect(canTranscribe()).toBe(true);
    expect(await transcribeAudio(new Uint8Array([1]))).toBe("ok");
    expect(fromGroq(transcribe.mock.calls[0])).toBe(false);
  });
});
