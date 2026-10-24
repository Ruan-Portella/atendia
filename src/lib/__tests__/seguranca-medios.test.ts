import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "../memory-db";
import { saveSector } from "../sectors";
import { canLinkWhatsAppById } from "../platform-admin";
import { looksLikePdf, removeSourceFiles } from "../source-files";
import { isOurLogoUrl } from "../attendants";
import { decodeCursor } from "../api-conversations";
import { safeEqual } from "../safe-equal";

/* Médios e baixos do relatório de segurança de 23/10/2026 (M13, M14 e o arquivo das fontes). */

afterEach(() => vi.unstubAllEnvs());

describe("setor de outro cliente (M13)", () => {
  it("o id de um setor alheio não recebe pessoas", async () => {
    const tables = { sectors: [{ id: "s-outro", client_id: "c-outra-conta", agency_id: "B", name: "Vendas", position: 0, created_at: "2026-10-01" }], sector_members: [] as Array<Record<string, unknown>> };
    const db = memoryDb(tables);
    const r = await saveSector(db, { agencyId: "A", clientId: "c1", id: "s-outro", input: { name: "Vendas", hours: null, distribution: "manual", members: [{ type: "agency_member", id: "m1" }] } as never });
    expect(r).toEqual({ error: "Setor não encontrado." });
    expect(tables.sector_members).toEqual([]);
  });
});

describe("Ligar pelo ID do WhatsApp (M14)", () => {
  it("só o número de teste da lista ou o admin da plataforma", () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "admin@boavoz.com");
    vi.stubEnv("WHATSAPP_TEST_PHONE_IDS", "111222333444, 555666777888");
    expect(canLinkWhatsAppById("ana@agencia.com", "111222333444")).toBe(true);
    expect(canLinkWhatsAppById("ana@agencia.com", "999888777666")).toBe(false);
    expect(canLinkWhatsAppById("admin@boavoz.com", "999888777666")).toBe(true);
    // a linha aparece para quem tem algum número liberado
    expect(canLinkWhatsAppById("ana@agencia.com")).toBe(true);
    vi.stubEnv("WHATSAPP_TEST_PHONE_IDS", "");
    expect(canLinkWhatsAppById("ana@agencia.com")).toBe(false);
  });
});

describe("PDF da fonte e segredos", () => {
  it("o caminho lido do banco só apaga na pasta do próprio chatbot", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const db = { storage: { from: () => ({ remove }) } } as never;
    await removeSourceFiles(db, ["bot-1/1-a.pdf", "bot-2/1-b.pdf", null], "bot-1");
    expect(remove).toHaveBeenCalledWith(["bot-1/1-a.pdf"]);
  });

  it("comparação de segredo", () => {
    expect(safeEqual("Bearer x", "Bearer x")).toBe(true);
    expect(safeEqual("Bearer y", "Bearer x")).toBe(false);
    expect(safeEqual(null, "x")).toBe(false);
    expect(safeEqual("x", undefined)).toBe(false);
  });
});

describe("baixos: PDF, logo e cursor", () => {
  it("PDF pelo começo do arquivo, não pelo nome", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7 ...").buffer)).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("<html><script>").buffer)).toBe(false);
  });

  it("logo só do nosso envio, na pasta da conta", () => {
    const base = "https://abc.supabase.co";
    expect(isOurLogoUrl(`${base}/storage/v1/object/public/logos/ag-1/123-logo.png`, "ag-1", base)).toBe(true);
    expect(isOurLogoUrl(`${base}/storage/v1/object/public/logos/ag-2/123-logo.png`, "ag-1", base)).toBe(false);
    expect(isOurLogoUrl("https://rastreio.exemplo/pixel.png", "ag-1", base)).toBe(false);
  });

  it("cursor da API só com data e id (sem sintaxe do filtro)", () => {
    const enc = (parts: string[]) => Buffer.from(parts.join("|")).toString("base64url");
    expect(decodeCursor(enc(["2026-10-23T12:00:00.000+00:00", "8f1e2d3c-0000-4000-8000-000000000001"]), 2)).toHaveLength(2);
    expect(() => decodeCursor(enc(['2026-10-23"),bot_id.neq.(x', "1"]), 2)).toThrow();
  });
});
