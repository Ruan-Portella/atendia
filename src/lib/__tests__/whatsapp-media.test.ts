import { describe, expect, it } from "vitest";
import { inboundText } from "../whatsapp-inbound";

describe("texto da mensagem do WhatsApp", () => {
  it("foto, vídeo e documento com legenda: a legenda é o texto, com a marca da mídia", () => {
    expect(inboundText({ id: "1", type: "image", image: { caption: "Quanto custa?" } })).toBe("📷 (foto) Quanto custa?");
    expect(inboundText({ id: "1", type: "video", video: { caption: " tem esse? " } })).toBe("🎬 (vídeo) tem esse?");
    expect(inboundText({ id: "1", type: "document", document: { caption: "segue o orçamento", filename: "a.pdf" } })).toBe("📄 (documento) segue o orçamento");
  });

  it("mídia sem legenda não tem texto (a IA não responde a ela sozinha)", () => {
    expect(inboundText({ id: "1", type: "image", image: {} })).toBeNull();
    expect(inboundText({ id: "1", type: "image" })).toBeNull();
  });

  it("texto, botão e lista continuam como antes", () => {
    expect(inboundText({ id: "1", type: "text", text: { body: " oi " } })).toBe("oi");
    expect(inboundText({ id: "1", type: "interactive", interactive: { button_reply: { id: "x", title: "Sim" } } })).toBe("Sim");
  });
});
