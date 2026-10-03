import { describe, expect, it } from "vitest";
import type { UIMessageChunk } from "ai";
import { INTERNAL_FALLBACK, internalTerms, stripInternal } from "../internal-guard";
import { readResponse } from "../actions";
import { actionsNote, guardInternal, withoutToolParts } from "../chat";

describe("campos internos das ações", () => {
  it("a resposta do endpoint traz internal à parte do data", () => {
    const r = readResponse(200, JSON.stringify({ data: { status: "em análise" }, internal: { bloqueado: true, motivo: "inadimplente" } }));
    expect(r).toMatchObject({ status: "ok", data: { status: "em análise" }, internal: { bloqueado: true, motivo: "inadimplente" } });
    expect(readResponse(200, JSON.stringify({ data: {}, internal: ["x"] })).internal).toBeNull();
  });

  it("valores que não podem aparecer: textos com 4+ letras, números com 3+ dígitos (também no formato brasileiro)", () => {
    const terms = internalTerms({ bloqueado: true, motivo: "inadimplente", score: 410, limite: 4100, nivel: "B", obs: ["ok", "cliente VIP"] });
    expect(terms).toEqual(expect.arrayContaining(["inadimplente", "410", "4100", "4.100", "cliente VIP"]));
    expect(terms).not.toContain("B");
    expect(terms).not.toContain("ok");
    expect(terms.some((t) => t === "true")).toBe(false);
  });

  it("a frase com o valor sai; o resto fica", () => {
    const terms = internalTerms({ motivo: "inadimplente", score: 410 });
    const r = stripInternal("Seu pedido está em análise. O motivo é: Inadimplente!\nSeu score é 410.\n\nPosso ajudar com mais alguma coisa?", terms);
    expect(r.leaked).toBe(true);
    expect(r.text).toBe("Seu pedido está em análise.\n\nPosso ajudar com mais alguma coisa?");
    expect(stripInternal("Seu limite é R$ 4.100,00.", internalTerms({ limite: 4100 })).leaked).toBe(true);
    // palavra inteira: 410 não pega 4105
    expect(stripInternal("Protocolo 4105.", terms).leaked).toBe(false);
    expect(guardInternal("Seu score é 410.", terms)).toBe(INTERNAL_FALLBACK);
    expect(guardInternal("Tudo certo por aqui.", terms)).toBe("Tudo certo por aqui.");
  });

  it("o interno não vai para o histórico", () => {
    const note = actionsNote([{ name: "acao_cadastro", input: {}, output: { ok: true, data: { status: "em análise" }, interno: { motivo: "inadimplente" } } }], new Set());
    expect(note).toContain("em análise");
    expect(note).not.toContain("inadimplente");
  });

  it("widget: com interno, o texto é conferido antes de aparecer; o interno nunca vai ao navegador", async () => {
    const chunks: UIMessageChunk[] = [
      { type: "start" },
      { type: "tool-input-available", toolCallId: "1", toolName: "acao_cadastro", input: {} },
      { type: "tool-output-available", toolCallId: "1", output: { ok: true, data: { status: "em análise" }, interno: { motivo: "inadimplente", score: 410 } } },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Seu cadastro está em análise. " },
      { type: "text-delta", id: "t", delta: "Seu score é 410." },
      { type: "text-end", id: "t" },
      { type: "finish" },
    ];
    const out: UIMessageChunk[] = [];
    const reader = new ReadableStream<UIMessageChunk>({
      start(c) {
        chunks.forEach((ch) => c.enqueue(ch));
        c.close();
      },
    })
      .pipeThrough(withoutToolParts())
      .getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) out.push(r.value);
    expect(out.map((c) => c.type)).toEqual(["start", "text-start", "text-delta", "text-end", "finish"]);
    expect(JSON.stringify(out)).toContain("Seu cadastro está em análise.");
    expect(JSON.stringify(out)).not.toMatch(/410|inadimplente/);
  });
});
