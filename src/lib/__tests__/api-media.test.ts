import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileNameOf, sniffMime } from "../outbound-file";
import { signedFileUrl, validFileLink, widgetFile } from "../file-links";
import { mediaObject, messageObject, splitMediaText } from "../api-conversations";
import { fileLabel, parseSendBody } from "../api-messages";
import { attachmentExpired, streamBytes } from "../attachments";
import { fileHeaders } from "../file-headers";
import { ApiError } from "../api-v1";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0x20)]);
const text = (s: string) => new TextEncoder().encode(s);
const NOW = Date.parse("2026-10-12T12:00:00Z");
const ID = "0b7a6c1e-1111-4222-8333-444455556666";

describe("arquivo mandado pela API: o tipo vem dos primeiros bytes (C pública, parte 3c)", () => {
  it("imagem e PDF pela assinatura, seja qual for o nome", () => {
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0), "foto.png")).toBe("image/jpeg");
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), null)).toBe("image/png");
    expect(sniffMime(text("%PDF-1.7 ..."), "boleto.txt")).toBe("application/pdf");
  });

  it("Office: zip ou OLE por dentro, a extensão diz qual", () => {
    expect(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04), "contrato.docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04), "planilha.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04), "arquivo.zip")).toBeNull();
    expect(sniffMime(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), "antigo.doc")).toBe("application/msword");
  });

  it("texto só com extensão de texto e sem cara de HTML; SVG e HTML nunca passam", () => {
    expect(sniffMime(text("nome;valor\nAna;10"), "lista.csv")).toBe("text/csv");
    expect(sniffMime(text("<!DOCTYPE html><html>"), "pagina.txt")).toBeNull();
    expect(sniffMime(text("<svg xmlns='http://www.w3.org/2000/svg'>"), "logo.svg")).toBeNull();
    expect(sniffMime(text("<html>"), "pagina.html")).toBeNull();
  });

  it("nome do arquivo: o informado, senão o fim da URL, sem caracteres perigosos", () => {
    expect(fileNameOf(new URL("https://x.com/docs/Boleto%20Maio.pdf?token=1"), null)).toBe("Boleto Maio.pdf");
    expect(fileNameOf(new URL("https://x.com/a.pdf"), "recibo/../x.pdf")).toBe("recibo_.._x.pdf");
    expect(fileNameOf(new URL("https://x.com/"), null)).toBeNull();
  });

  it("legenda vira text; sem legenda, o rótulo que fica na conversa", () => {
    expect(fileLabel({ kind: "image", filename: null })).toBe("📷 (foto)");
    expect(fileLabel({ kind: "document", filename: "boleto.pdf" })).toBe("📄 boleto.pdf");
  });
});

describe("POST /v1/messages com imagem e documento", () => {
  const err = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e as ApiError;
    }
    throw new Error("não lançou");
  };

  it("documento com nome e legenda; imagem só com a URL", () => {
    expect(parseSendBody({ to: "phone:5521999999999", type: "document", document: { url: "https://x.com/boleto.pdf", filename: "Boleto.pdf" }, text: "Seu boleto" })).toMatchObject({
      type: "document",
      text: "Seu boleto",
      file: { kind: "document", url: "https://x.com/boleto.pdf", filename: "Boleto.pdf" },
    });
    expect(parseSendBody({ to: "ctc_x", type: "image", image: { url: "https://x.com/a.png" } })).toMatchObject({ type: "image", text: null, file: { kind: "image", filename: null } });
  });

  it("no chat do site também, menos modelo", () => {
    const conv = `conv_${ID}`;
    expect(parseSendBody({ conversation_id: conv, type: "image", image: { url: "https://x.com/a.png" } })).toMatchObject({ target: "widget", type: "image" });
    expect(err(() => parseSendBody({ conversation_id: conv, type: "template", template: { name: "x" } })).details).toEqual({ field: "type" });
  });

  it("só HTTPS, legenda até 1.024 caracteres e nome até 200", () => {
    expect(err(() => parseSendBody({ to: "x", type: "image", image: { url: "http://x.com/a.png" } })).details).toEqual({ field: "image.url" });
    expect(err(() => parseSendBody({ to: "x", type: "image", image: { url: "nada" } })).details).toEqual({ field: "image.url" });
    expect(err(() => parseSendBody({ to: "x", type: "image", image: {} })).details).toEqual({ field: "image.url" });
    expect(err(() => parseSendBody({ to: "x", type: "document", document: { url: "https://x.com/a.pdf", filename: "a".repeat(201) } })).details).toEqual({ field: "document.filename" });
    expect(err(() => parseSendBody({ to: "x", type: "image", image: { url: "https://x.com/a.png" }, text: "a".repeat(1025) })).details).toEqual({ field: "text" });
  });
});

describe("link assinado e a mídia nas respostas da API", () => {
  beforeEach(() => vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16"));
  afterEach(() => vi.unstubAllEnvs());

  it("vale 1 hora, só para aquele arquivo e com a assinatura certa", () => {
    const { url, expiresAt } = signedFileUrl(ID, NOW);
    const u = new URL(url);
    expect(u.pathname).toBe(`/api/files/${ID}`);
    expect(Date.parse(expiresAt) - NOW).toBe(3600_000);
    const exp = u.searchParams.get("exp");
    const sig = u.searchParams.get("sig");
    expect(validFileLink(ID, exp, sig, NOW)).toBe(true);
    expect(validFileLink(ID, exp, sig, NOW + 3601_000)).toBe(false);
    expect(validFileLink("0b7a6c1e-1111-4222-8333-444455550000", exp, sig, NOW)).toBe(false);
    expect(validFileLink(ID, String(Number(exp) + 1), sig, NOW)).toBe(false);
    expect(validFileLink(ID, exp, `${sig}0`, NOW)).toBe(false);
    expect(validFileLink(ID, null, sig, NOW)).toBe(false);
  });

  it("com o link assinado, o arquivo pode abrir em outro domínio (widget); com a sessão, não", () => {
    const f = { id: ID, mime: "image/png", filename: null, size: 1 };
    expect(fileHeaders(f)["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(fileHeaders(f, { crossOrigin: true })["Cross-Origin-Resource-Policy"]).toBe("cross-origin");
  });

  it("texto de mensagem com arquivo: rótulo sai, legenda fica, transcrição do áudio à parte", () => {
    expect(splitMediaText("🎤 quero marcar um horário amanhã")).toEqual({ text: null, transcript: "quero marcar um horário amanhã" });
    expect(splitMediaText("🎤 (áudio)")).toEqual({ text: null, transcript: null });
    expect(splitMediaText("📷 (foto) olha o defeito")).toEqual({ text: "olha o defeito", transcript: null });
    expect(splitMediaText("📷 (foto)")).toEqual({ text: null, transcript: null });
    expect(splitMediaText("📄 boleto.pdf")).toEqual({ text: null, transcript: null });
    expect(splitMediaText("Segue o seu boleto")).toEqual({ text: "Segue o seu boleto", transcript: null });
  });

  it("media no formato da spec, com o link de 1 hora", () => {
    const file = { id: ID, mime: "application/pdf", size: 1234, doc_type: "document" as const, filename: "boleto.pdf" };
    expect(mediaObject(file, null, NOW)).toMatchObject({ id: `med_${ID}`, type: "document", mime: "application/pdf", size: 1234, filename: "boleto.pdf", transcript: null, url_expires_at: new Date(NOW + 3600_000).toISOString() });
    const m = { id: 9, conversation_id: "c1", role: "user" as const, content: "🎤 oi, tudo bem?", author: null, author_type: null, author_id: null, author_display_name: null, channel_msg_id: null, delivery_status: null, blocked_reason: null, failed_at: null, error_code: null, deleted_at: null, edited_at: null, created_at: new Date(NOW).toISOString() };
    const out = messageObject(m, "whatsapp", [{ ...file, mime: "audio/ogg", doc_type: "audio", filename: null }]);
    expect(out.text).toBeNull();
    expect(out.media).toMatchObject({ type: "audio", transcript: "oi, tudo bem?" });
    // sem arquivo, o texto fica como está
    expect(messageObject(m, "whatsapp").text).toBe("🎤 oi, tudo bem?");
  });

  it("widget: o primeiro arquivo da mensagem do atendente, imagem ou documento", () => {
    expect(widgetFile(undefined)).toBeNull();
    expect(widgetFile([{ id: ID, doc_type: "image", filename: null }], NOW)).toMatchObject({ kind: "image", name: null });
    expect(widgetFile([{ id: ID, doc_type: "document", filename: "a.pdf" }], NOW)?.url).toContain(`/api/files/${ID}?exp=`);
  });

  it("prazo de guarda vencido e o arquivo em blocos", async () => {
    expect(attachmentExpired({ expires_at: new Date(NOW - 1).toISOString() }, NOW)).toBe(true);
    expect(attachmentExpired({ expires_at: null }, NOW)).toBe(false);
    const data = new Uint8Array(150_000).map((_, i) => i % 251);
    const chunks: Uint8Array[] = [];
    const reader = streamBytes(data, 64 * 1024).getReader();
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      chunks.push(r.value);
    }
    expect(chunks.map((c) => c.byteLength)).toEqual([65536, 65536, 18928]);
    expect(Buffer.concat(chunks).equals(Buffer.from(data))).toBe(true);
  });
});
