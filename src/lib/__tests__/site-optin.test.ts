import { describe, expect, it } from "vitest";
import type { UIMessageChunk } from "ai";
import { appendSiteOffer } from "../chat";
import { isSiteOffer, optInSiteText, optInSiteYesText, typedOptInAnswer } from "../marketing-consent";
import { displayPhone } from "../phone";

async function run(chunks: UIMessageChunk[], offer: { text: string } | null): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = [];
  const stream = new ReadableStream<UIMessageChunk>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  }).pipeThrough(appendSiteOffer(() => offer));
  for await (const ch of stream as unknown as AsyncIterable<UIMessageChunk>) out.push(ch);
  return out;
}

const answer: UIMessageChunk[] = [
  { type: "start" },
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: "Anotado! A equipe fala com você." },
  { type: "text-end", id: "t" },
  { type: "finish" },
];

describe("oferta de novidades no site", () => {
  it("telefone para mostrar", () => {
    expect(displayPhone("5521999990000")).toBe("+55 21 99999-0000");
    expect(displayPhone("552133334444")).toBe("+55 21 3333-4444");
    expect(displayPhone("14155550123")).toBe("+14155550123");
  });

  it("o texto mostra o número e diz como parar; a mensagem gravada é reconhecida", () => {
    const t = optInSiteText("Bar do Zé", "5521999990000");
    expect(t).toContain("+55 21 99999-0000");
    expect(t).toContain("SAIR");
    expect(isSiteOffer(`Anotado!\n\n${t}`, "Bar do Zé")).toBe(true);
    expect(isSiteOffer("Anotado!", "Bar do Zé")).toBe(false);
    expect(optInSiteYesText("Bar do Zé", "5521999990000")).toContain("+55 21 99999-0000");
  });

  it("o clique nos botões volta como texto e vale como resposta", () => {
    const now = Date.now();
    const at = new Date(now - 60_000).toISOString();
    expect(typedOptInAnswer("Sim, quero", at, now)).toBe("sim");
    expect(typedOptInAnswer("Não, obrigado", at, now)).toBe("nao");
  });

  it("a oferta entra antes do fim da resposta, com os botões", async () => {
    const out = await run(answer, { text: "Quer receber novidades?" });
    const types = out.map((c) => c.type);
    expect(types.slice(-5)).toEqual(["text-start", "text-delta", "text-end", "data-components", "finish"]);
    expect(out.find((c) => c.type === "text-delta" && c.id === "novidades")).toMatchObject({ delta: "\n\nQuer receber novidades?" });
  });

  it("sem oferta, ou se a resposta já trouxe botões, nada muda", async () => {
    expect(await run(answer, null)).toEqual(answer);
    const withButtons: UIMessageChunk[] = [...answer.slice(0, 4), { type: "data-components", data: { type: "options", options: [] } } as UIMessageChunk, answer[4]];
    expect(await run(withButtons, { text: "Quer receber novidades?" })).toEqual(withButtons);
  });
});
