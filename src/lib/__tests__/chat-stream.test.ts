import { describe, expect, it } from "vitest";
import type { UIMessageChunk } from "ai";
import { withoutToolParts } from "../chat";

async function run(chunks: UIMessageChunk[]): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = [];
  const stream = new ReadableStream<UIMessageChunk>({
    start(c) {
      chunks.forEach((ch) => c.enqueue(ch));
      c.close();
    },
  }).pipeThrough(withoutToolParts());
  const reader = stream.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) out.push(r.value);
  return out;
}

describe("stream do widget", () => {
  it("não manda dados do lead ao navegador e troca o pedido de atendente por um sinal", async () => {
    const out = await run([
      { type: "start" },
      { type: "tool-input-start", toolCallId: "1", toolName: "registrar_lead" },
      { type: "tool-input-available", toolCallId: "1", toolName: "registrar_lead", input: { nome: "Ana", whatsapp: "21999999999" } },
      { type: "tool-output-available", toolCallId: "1", output: { ok: true } },
      { type: "tool-input-available", toolCallId: "2", toolName: "chamar_atendente", input: { motivo: "reclamação" } },
      { type: "text-delta", id: "t", delta: "Anotado!" },
      { type: "finish" },
    ]);
    expect(out.map((c) => c.type)).toEqual(["start", "data-handoff", "text-delta", "finish"]);
    expect(JSON.stringify(out)).not.toMatch(/Ana|2199|reclama/);
  });
});

describe("ações no histórico do modelo", () => {
  it("resume o que o assistente já fez", async () => {
    const { actionsNote } = await import("../chat");
    expect(actionsNote(null)).toBeNull();
    expect(actionsNote([{ name: "registrar_lead", output: { ok: true } }, { name: "chamar_atendente", output: { ok: false } }])).toBe("(ações desta resposta: registrar_lead ok, chamar_atendente falhou)");
  });
});
