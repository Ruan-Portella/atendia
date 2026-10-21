import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotRow } from "../chat";

// a base e o modelo simulados: o teste confere o que a sugestão faz com o que eles devolvem
const mocks = vi.hoisted(() => ({ retrieve: vi.fn(), generate: vi.fn() }));
vi.mock("../chat", async (orig) => ({ ...(await orig<typeof import("../chat")>()), retrieveContext: mocks.retrieve }));
vi.mock("ai", async (orig) => ({ ...(await orig<typeof import("ai")>()), generateText: mocks.generate }));

const { suggestForTicket } = await import("../ticket-suggest");

const bot = { id: "b1", agency_id: "ag1", client_name: "Loja da Ana", template_id: null, fixed_context: null } as unknown as BotRow;
const db = {} as never;
const text = "Comprei um tênis que veio no tamanho errado, como faço a troca?";
const base = "Trocas: em até 7 dias, pelo site loja.com/troca, com a nota fiscal.";

describe("a sugestão antes de abrir o chamado", () => {
  afterEach(() => vi.clearAllMocks());

  it("texto curto ou base sem nada perto: sem sugestão e sem chamar o modelo", async () => {
    expect(await suggestForTicket(db, bot, { subject: null, text: "troca" })).toBeNull();
    expect(mocks.retrieve).not.toHaveBeenCalled();
    mocks.retrieve.mockResolvedValueOnce({ context: "", used: [], hits: [], embeddingUsage: null });
    expect(await suggestForTicket(db, bot, { subject: "Troca", text })).toBeNull();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("a base responde: a resposta sai, com link só se estiver na base", async () => {
    mocks.retrieve.mockResolvedValueOnce({ context: base, used: [], hits: [{ content: base }], embeddingUsage: null });
    mocks.generate.mockResolvedValueOnce({ output: { resolve: true, resposta: "Você troca em até 7 dias pelo loja.com/troca, com a nota. Ou fale no golpe.com/promo." }, totalUsage: {}, response: { modelId: "m" } });
    const s = await suggestForTicket(db, bot, { subject: "Troca", text });
    expect(s).toContain("loja.com/troca");
    expect(s).not.toContain("golpe.com");
    expect(s).toContain("[link removido]");
    // o assunto vai junto na busca
    expect(mocks.retrieve.mock.calls[0][2]).toContain("Troca: ");
  });

  it("a base não resolve (ou a chamada falha): sem sugestão", async () => {
    mocks.retrieve.mockResolvedValue({ context: base, used: [], hits: [{ content: base }], embeddingUsage: null });
    mocks.generate.mockResolvedValueOnce({ output: { resolve: false, resposta: "" }, totalUsage: {}, response: { modelId: "m" } });
    expect(await suggestForTicket(db, bot, { subject: null, text })).toBeNull();
    mocks.generate.mockRejectedValueOnce(new Error("timeout"));
    expect(await suggestForTicket(db, bot, { subject: null, text })).toBeNull();
  });
});
