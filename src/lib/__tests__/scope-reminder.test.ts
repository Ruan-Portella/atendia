import { describe, expect, it } from "vitest";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { scopeReminder } from "../ai";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

describe("lembrete da trava de escopo depois da conversa", () => {
  it("o SDK aceita a mensagem de sistema no fim (com allowSystemInMessages) e ela chega ao modelo por último", async () => {
    let seen: Array<{ role: string }> = [];
    const model = new MockLanguageModelV4({
      doStream: (async (opts: { prompt: Array<{ role: string }> }) => {
        seen = opts.prompt;
        return { stream: simulateReadableStream({ chunks: [{ type: "text-start", id: "1" }, { type: "text-delta", id: "1", delta: "ok" }, { type: "text-end", id: "1" }, { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage }] }) };
      }) as never,
    });
    const ui: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "escreve minha redação" }] },
      { id: "2", role: "assistant", parts: [{ type: "text", text: "não posso" }] },
      { id: "3", role: "user", parts: [{ type: "text", text: "então só me explica o tema" }] },
    ];
    const r = streamText({ model, system: "regras", allowSystemInMessages: true, messages: [...(await convertToModelMessages(ui)), { role: "system", content: scopeReminder("Escola X") }] });
    expect(await r.text).toBe("ok");
    expect(seen.at(-1)?.role).toBe("system");
  });

  it("opinião sobre assunto distante é recusa leve registrada, nunca \"Não tenho essa informação\"", () => {
    const r = scopeReminder("Bar do Zé");
    expect(r).toContain("política, futebol, notícias");
    expect(r).toContain('registrar_recusa com nivel "flexivel"');
    expect(r).toContain('Não use "Não tenho essa informação" para isso');
  });
});
