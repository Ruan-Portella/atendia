import { describe, expect, it } from "vitest";
import { effectiveSignature, signText, startsSequence, withoutSignatureSuffix } from "../signature";
import { memoryDb } from "../memory-db";
import { postAgentMessage } from "../handoff";
import type { Attendant } from "../authors";

const VIVI = "a1000000-0000-4000-8000-000000000001";
const vivi: Attendant = { type: "agency_member", id: VIVI, name: "Viviane", legacy: "agência" };

describe("assinatura das mensagens da equipe", () => {
  it("o formato: o da pessoa, se o chatbot não trava; senão, o do chatbot", () => {
    expect(effectiveSignature(null, null)).toBe("nenhuma");
    expect(effectiveSignature({ signature: "inicio" }, null)).toBe("inicio");
    expect(effectiveSignature({ signature: "inicio" }, "fim")).toBe("fim");
    expect(effectiveSignature({ signature: "inicio", signature_locked: true }, "fim")).toBe("inicio");
    expect(effectiveSignature({ signature: null, signature_locked: false }, "nenhuma")).toBe("nenhuma");
  });

  it("no começo (negrito no WhatsApp) ou no fim, com o setor; nada no site", () => {
    expect(signText("Seu boleto saiu.", { format: "inicio", name: "Viviane", channel: "whatsapp" })).toEqual({ text: "*Viviane:*\nSeu boleto saiu.", prefixChars: 11 });
    expect(signText("Seu boleto saiu.", { format: "inicio", name: "Viviane", sector: "Financeiro", channel: "instagram" })).toEqual({ text: "Viviane · Financeiro:\nSeu boleto saiu.", prefixChars: 22 });
    expect(signText("Seu boleto saiu.", { format: "fim", name: "Viviane", sector: "Financeiro", channel: "whatsapp" })).toEqual({ text: "Seu boleto saiu.\n\n— Viviane · Financeiro", prefixChars: 0 });
    expect(signText("Oi", { format: "inicio", name: "Viviane", channel: "widget" })).toEqual({ text: "Oi", prefixChars: 0 });
    expect(signText("Oi", { format: "nenhuma", name: "Viviane", channel: "whatsapp" })).toEqual({ text: "Oi", prefixChars: 0 });
  });

  it("assinatura inteligente: só na primeira de cada sequência", () => {
    expect(startsSequence(null, VIVI)).toBe(true);
    expect(startsSequence({ role: "user" }, VIVI)).toBe(true);
    expect(startsSequence({ role: "agent", author_id: "outra" }, VIVI)).toBe(true);
    expect(startsSequence({ role: "agent", author_id: VIVI }, VIVI)).toBe(false);
    expect(startsSequence({ role: "assistant" }, VIVI)).toBe(true);
  });

  it("o aprendizado lê a resposta sem a assinatura do fim", () => {
    expect(withoutSignatureSuffix("Seu boleto saiu.\n\n— Viviane · Financeiro")).toBe("Seu boleto saiu.");
    expect(withoutSignatureSuffix("Sem assinatura — no meio")).toBe("Sem assinatura — no meio");
  });

  it("no chat do site a resposta sai sem assinatura, mesmo com o formato ligado", async () => {
    const tables = {
      bots: [{ id: "b1", client_name: "Loja", human_handoff: { signature: "inicio", signature_smart: false } }],
      agency_members: [{ id: VIVI, signature: null }],
      conversations: [{ id: "c1", bot_id: "b1", channel: "widget", takeover_at: "2026-10-21T10:00:00Z", handled_at: null, assigned_to_id: VIVI, assigned_to_name: "Viviane", announce_pending: false, transfer_from_name: null, sector_id: null }],
      messages: [],
    };
    expect((await postAgentMessage(memoryDb(tables), "c1", "Oi!", vivi)).ok).toBe(true);
    expect(tables.messages.map((m: { content: string }) => m.content)).toEqual(["Oi!"]);
  });
});
