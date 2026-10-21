import { afterEach, describe, expect, it, vi } from "vitest";
import { contactSafetyId, withContactId } from "../ai-contact";
import { modelCallOptions } from "../ai";

afterEach(() => vi.unstubAllEnvs());

const safetyOf = (o: ReturnType<typeof modelCallOptions>) => (o.providerOptions?.openai as { safetyIdentifier?: string } | undefined)?.safetyIdentifier;

describe("identificador do contato na IA", () => {
  it("vai nas chamadas feitas enquanto o BoaVoz atende o contato, sem o telefone", async () => {
    vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-32-caracteres!");
    const id = await withContactId("bot-1", "5521999990000", async () => safetyOf(modelCallOptions("gpt-6-luna", { temperature: 0.3 })));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).not.toContain("5521");
    expect(id).toBe(contactSafetyId("bot-1", "5521999990000"));
    // outro contato, outro chatbot: outro identificador
    expect(contactSafetyId("bot-1", "5521999990001")).not.toBe(id);
    expect(contactSafetyId("bot-2", "5521999990000")).not.toBe(id);
    // fora do atendimento (análise do bot, posts): sem identificador
    expect(safetyOf(modelCallOptions("gpt-6-luna", { temperature: 0 }))).toBeUndefined();
  });

  it("sem a chave de hash, segue sem identificador (nunca derruba a resposta)", async () => {
    vi.stubEnv("CONTACT_HASH_KEY", "");
    vi.stubEnv("WHATSAPP_TOKEN_KEY", "");
    expect(await withContactId("bot-1", "5521999990000", async () => safetyOf(modelCallOptions("gpt-6-luna")))).toBeUndefined();
  });
});
