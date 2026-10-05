import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { openBytes, sealBytes, setCipherIdentityForTests } from "../field-cipher";
import { setClientKeyStore, type ClientKeyStore } from "../keys";
import { downloadName, fileHeaders, opensInline } from "../file-headers";
import { baseMime, docTypeOf } from "../attachments";
import { sourcePdfPath } from "../source-files";

function memoryStore(): { store: ClientKeyStore; rows: Array<{ id: string; client_id: string; key_enc: string }> } {
  const rows: Array<{ id: string; client_id: string; key_enc: string }> = [];
  return {
    rows,
    store: {
      async find(clientId) {
        const r = rows.find((x) => x.client_id === clientId);
        return r ? { id: r.id, key_enc: r.key_enc } : null;
      },
      async byId(keyId) {
        const r = rows.find((x) => x.id === keyId);
        return r ? { key_enc: r.key_enc } : null;
      },
      async create(clientId, keyEnc) {
        rows.push({ id: randomUUID(), client_id: clientId, key_enc: keyEnc });
      },
    },
  };
}

describe("arquivo cifrado", () => {
  let mem: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-de-teste-dos-segredos-123");
    vi.stubEnv("FIELD_MASTER_KEYS", "");
    setCipherIdentityForTests(false);
    mem = memoryStore();
    setClientKeyStore(mem.store);
  });
  afterAll(() => {
    setCipherIdentityForTests(true);
    setClientKeyStore(null);
  });

  it("ida e volta com a chave do cliente; o conteúdo não aparece; outro campo não abre", async () => {
    const data = new Uint8Array(Buffer.from("%PDF-1.7 exame de sangue de Joana"));
    const sealed = await sealBytes("attachments.object", data, { clientId: "c1" });
    expect(Buffer.from(sealed).toString("latin1")).toMatch(/^v2\.c\.[0-9a-f-]{36}\n/);
    expect(Buffer.from(sealed).includes(Buffer.from("Joana"))).toBe(false);
    expect(Buffer.from((await openBytes("attachments.object", sealed))!).toString()).toBe("%PDF-1.7 exame de sangue de Joana");
    expect(await openBytes("attachments.filename_enc", sealed)).toBeNull();
  });

  it("arquivo grande, plataforma, adulterado e chave apagada", async () => {
    const big = randomBytes(2 * 1024 * 1024);
    const p = await sealBytes("attachments.object", big, { clientId: null });
    expect(Buffer.from(p).subarray(0, 5).toString()).toBe("v2.p1");
    expect(Buffer.compare(Buffer.from((await openBytes("attachments.object", p))!), big)).toBe(0);
    const tampered = new Uint8Array(p);
    tampered[tampered.length - 1] ^= 1;
    expect(await openBytes("attachments.object", tampered)).toBeNull();
    const c = await sealBytes("attachments.object", big, { clientId: "c2" });
    mem.rows.length = 0;
    setClientKeyStore(mem.store);
    expect(await openBytes("attachments.object", c)).toBeNull();
    expect(await openBytes("attachments.object", new Uint8Array(Buffer.from("qualquer coisa")))).toBeNull();
  });
});

describe("rota de arquivos", () => {
  it("só imagem (sem SVG), áudio e vídeo abrem na página; o resto baixa", () => {
    expect(opensInline("image/jpeg")).toBe(true);
    expect(opensInline("audio/ogg")).toBe(true);
    for (const m of ["image/svg+xml", "text/html", "application/pdf", "application/octet-stream"]) expect(opensInline(m), m).toBe(false);
    const h = fileHeaders({ id: "abcdef12-0000", mime: "text/html", filename: "página.html", size: 10 });
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["Content-Disposition"]).toMatch(/^attachment; filename="p_gina.html"; filename\*=UTF-8''p%C3%A1gina\.html$/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toContain("sandbox");
    expect(h["Cache-Control"]).toBe("private, no-store");
    expect(fileHeaders({ id: "x", mime: "image/png", filename: null, size: 1 })["Content-Disposition"]).toMatch(/^inline;/);
  });

  it("nome para baixar sem caracteres de controle", () => {
    expect(downloadName({ id: "abcdef1234", mime: "application/pdf", filename: null })).toBe("arquivo-abcdef12.pdf");
    expect(downloadName({ id: "x", mime: "application/pdf", filename: 'a"b\\c/d\r\ne.pdf' })).toBe("abcde.pdf");
  });

  it("tipo do arquivo", () => {
    expect(baseMime("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(baseMime(null)).toBe("application/octet-stream");
    expect(docTypeOf("image/webp", "sticker")).toBe("sticker");
    expect(docTypeOf("image/jpeg")).toBe("image");
    expect(docTypeOf("application/pdf")).toBe("document");
  });

  it("caminho do PDF da fonte", () => {
    expect(sourcePdfPath("bot1", "Cardápio Março 2026.pdf", 1)).toBe("bot1/1-Cardapio_Marco_2026.pdf");
    expect(sourcePdfPath("bot1", "../../etc/passwd", 2)).toBe("bot1/2-etc_passwd");
  });
});
