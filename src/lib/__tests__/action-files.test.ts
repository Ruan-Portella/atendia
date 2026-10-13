import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";
import { FILE_TEXTS, channelFormat, fileGate, filesNote, linkText, readAttachmentList, sentLabel, unsafeFile, widgetFiles, widgetFilesNotice, type ActionFile } from "../action-files";
import { LONG_FILE_LINK_TTL_SECONDS, signedFileUrl, validFileLink } from "../file-links";
import { appendActionFiles } from "../chat";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0x20)]);
const text = (s: string) => new Uint8Array(Buffer.from(s));
const file = (o: Partial<ActionFile>): ActionFile => ({ status: "ok", id: "11111111-1111-4111-8111-111111111111", kind: "document", mime: "application/pdf", filename: "cardapio.pdf", url: "https://loja.com/c.pdf", ...o });

describe("anexos devolvidos pelas ações (C pública, parte 5c)", () => {
  beforeEach(() => vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-dos-links-assinados-0123456789"));
  afterEach(() => vi.unstubAllEnvs());

  it("lista: só HTTPS, nome opcional, no máximo 5", () => {
    const list = readAttachmentList([{ url: "https://a.com/1.pdf", filename: " cardapio.pdf " }, { url: "http://a.com/2.pdf" }, { url: "nada" }, ...Array.from({ length: 6 }, (_, i) => ({ url: `https://a.com/${i}.png` }))]);
    expect(list[0]).toEqual({ url: "https://a.com/1.pdf", filename: "cardapio.pdf" });
    expect(list).toHaveLength(5);
  });

  it("executável, página ou script nunca vão, nem por link", () => {
    expect(unsafeFile(bytes(0x4d, 0x5a), "programa.dat")).toBe(true);
    expect(unsafeFile(bytes(0x7f, 0x45, 0x4c, 0x46), "x")).toBe(true);
    expect(unsafeFile(text("<!DOCTYPE html><html>"), "pagina.txt")).toBe(true);
    expect(unsafeFile(text("<svg onload=x>"), "img")).toBe(true);
    expect(unsafeFile(text("qualquer"), "instalar.apk")).toBe(true);
    expect(unsafeFile(text('<?xml version="1.0"?><tabela/>'), "tabela.xml")).toBe(false);
    expect(unsafeFile(bytes(0x25, 0x50, 0x44, 0x46, 0x2d), "cardapio.pdf")).toBe(false);
  });

  it("formato do canal: imagem no limite, documento aceito, o resto por link", () => {
    expect(channelFormat("image/png", 1_000, "whatsapp")).toEqual({ status: "ok", kind: "image" });
    expect(channelFormat("image/png", 6 * 1024 * 1024, "whatsapp")).toEqual({ status: "link" });
    expect(channelFormat("image/png", 6 * 1024 * 1024, "instagram")).toEqual({ status: "ok", kind: "image" });
    expect(channelFormat("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 1_000, "whatsapp")).toEqual({ status: "ok", kind: "document" });
    expect(channelFormat("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 1_000, "instagram")).toEqual({ status: "link" });
    expect(channelFormat(null, 1_000, "whatsapp")).toEqual({ status: "link" });
    expect(channelFormat("application/pdf", 20 * 1024 * 1024, "whatsapp")).toEqual({ status: "link" });
  });

  it("portão: proibido sempre barra; 18+ só sem o Sim", () => {
    const o = { channel: "whatsapp" as const, contactPhone: "5521999999999" };
    expect(fileGate("promocao-cerveja.pdf", { ...o, age: null })).toContain("bebida");
    expect(fileGate("promocao-cerveja.pdf", { ...o, age: "sim" })).toEqual([]);
    expect(fileGate("cardapio.pdf\nPizza Calabresa R$ 49,90", { ...o, age: null })).toEqual([]);
  });

  it("a IA sabe dos anexos que vão; o rótulo e o link na conversa", () => {
    expect(filesNote([file({}), file({ status: "barrado", filename: "x.pdf" })])).toMatchObject({ anexos: ["cardapio.pdf"] });
    expect(filesNote([file({ status: "falha" })])).toEqual({});
    expect(sentLabel({ kind: "image", filename: "calabresa.png" })).toBe("📷 calabresa.png");
    expect(sentLabel({ kind: "document", filename: null })).toBe("📄 (documento)");
    expect(linkText({ filename: "tabela.xml" }, "https://x/y")).toBe("📎 tabela.xml: https://x/y");
  });

  it("link de 7 dias para o que o canal não aceita; o de 1 hora segue valendo", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    const long = new URL(signedFileUrl("abc", now, LONG_FILE_LINK_TTL_SECONDS).url);
    expect(validFileLink("abc", long.searchParams.get("exp"), long.searchParams.get("sig"), now + 6 * 86_400_000)).toBe(true);
    expect(validFileLink("abc", long.searchParams.get("exp"), long.searchParams.get("sig"), now + 8 * 86_400_000)).toBe(false);
    // nunca mais que 7 dias, mesmo pedindo mais
    const capped = new URL(signedFileUrl("abc", now, 30 * 86_400).url);
    expect(Number(capped.searchParams.get("exp"))).toBe(Math.floor(now / 1000) + LONG_FILE_LINK_TTL_SECONDS);
  });

  it("no widget: os arquivos que vão e o aviso fixo do que falhou", () => {
    const ready = widgetFiles([file({}), file({ status: "link", kind: null, filename: "tabela.xml" }), file({ status: "falha", id: null })]);
    expect(ready.map((f) => [f.name, f.kind])).toEqual([
      ["cardapio.pdf", "document"],
      ["tabela.xml", "document"],
    ]);
    expect(widgetFilesNotice([file({ status: "falha" })])).toBe(FILE_TEXTS.failed);
    expect(widgetFilesNotice([file({})])).toBeNull();
  });

  it("no stream do widget, os anexos e o aviso vão antes do fim", async () => {
    const out: string[] = [];
    const stream = new ReadableStream<UIMessageChunk>({
      start(ctrl) {
        ctrl.enqueue({ type: "start" });
        ctrl.enqueue({ type: "finish" });
        ctrl.close();
      },
    }).pipeThrough(appendActionFiles(() => [file({}), file({ status: "falha", id: null })]));
    const reader = stream.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) out.push(r.value.type === "text-delta" ? `delta:${r.value.delta.trim()}` : r.value.type);
    expect(out).toEqual(["start", "data-files", "text-start", `delta:${FILE_TEXTS.failed}`, "text-end", "finish"]);
  });

  it("aviso de barrado com o canal declarado", () => {
    expect(FILE_TEXTS.blocked({ destino: "pelo site loja.com" })).toBe("Esse arquivo não pode ser enviado por aqui: pelo site loja.com.");
    expect(FILE_TEXTS.blocked(null)).toBe("Esse arquivo não pode ser enviado por aqui.");
  });
});
