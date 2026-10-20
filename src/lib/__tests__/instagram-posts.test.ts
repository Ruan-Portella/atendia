import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";
import type { IgMedia } from "../instagram";

/*
 * Posts do Instagram como fonte (E1, parte 1): o que vira texto de cada post, e a leitura da fonte
 * em partes (posts novos descritos uma vez, legenda mudada refaz só o trecho, post fora da janela
 * sai da base, a trava, a conta desconectada e o chatbot sem IA). O Instagram, a foto, o modelo de
 * visão e os embeddings são simulados.
 */

const fake = vi.hoisted(() => ({ media: [] as unknown[], vision: true, describes: 0, embeds: 0, failPhoto: false }));
vi.mock("ai", async (orig) => ({
  ...(await orig<typeof import("ai")>()),
  generateText: vi.fn(async () => {
    fake.describes += 1;
    if (fake.failPhoto) throw new Error("tempo esgotado");
    return { output: { descricao: "Vestido midi floral azul, de alça. Veja em https://loja.com/v", texto: "R$ 129,90 · chame no 21 99999-0000" }, totalUsage: { inputTokens: 120, outputTokens: 40 }, response: { modelId: "gpt-6-luna" } };
  }),
}));
vi.mock("../ai", async (orig) => ({
  ...(await orig<typeof import("../ai")>()),
  canReadPhotos: () => fake.vision,
  embedTexts: vi.fn(async (texts: string[]) => {
    fake.embeds += texts.length;
    return { embeddings: texts.map(() => [0.1, 0.2]), usage: { model: "text-embedding-3-small", tokens: texts.length * 50 } };
  }),
}));
vi.mock("../instagram", async (orig) => ({ ...(await orig<typeof import("../instagram")>()), instagramMedia: vi.fn(async () => fake.media) }));
// um JPEG: os primeiros bytes bastam para o tipo
vi.mock("../media-capture", () => ({ fetchIgMedia: vi.fn(async () => ({ data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(1)]), mime: "image/jpeg" })) }));

import { isReel, photoLine, postImageUrls, postText, readableMedia, syncInstagramSource } from "../instagram-posts";

const AGENCY = "aaaaaaaa-0000-4000-8000-000000000001";
const BOT = "aaaaaaaa-0000-4000-8000-0000000000b1";
const SOURCE = "aaaaaaaa-0000-4000-8000-0000000000f1";

const photo: IgMedia = { id: "m1", media_type: "IMAGE", caption: "Vestido midi floral por R$ 129,90. Tamanhos P ao G.", media_url: "https://cdn.ig/m1.jpg", permalink: "https://www.instagram.com/p/AAA/", timestamp: "2026-10-18T14:00:00+0000" };
const album: IgMedia = {
  id: "m2",
  media_type: "CAROUSEL_ALBUM",
  caption: "Coleção de verão",
  permalink: "https://www.instagram.com/p/BBB/",
  timestamp: "2026-10-15T14:00:00+0000",
  children: { data: [{ id: "c1", media_type: "IMAGE", media_url: "https://cdn.ig/c1.jpg" }, { id: "c2", media_type: "VIDEO", thumbnail_url: "https://cdn.ig/c2.jpg" }] },
};
const reel: IgMedia = { id: "m3", media_type: "VIDEO", caption: "Bastidores", thumbnail_url: "https://cdn.ig/m3.jpg", permalink: "https://www.instagram.com/reel/CCC/", timestamp: "2026-10-10T14:00:00+0000" };

let tables: Record<string, MemRow[]>;
let db: SupabaseClient;
let lockFree: boolean;

beforeEach(() => {
  Object.assign(fake, { media: [photo, album, reel], vision: true, describes: 0, embeds: 0, failPhoto: false });
  lockFree = true;
  tables = {
    bots: [{ id: BOT, agency_id: AGENCY, client_name: "Loja da Ana", size: "P", quota_override: null, is_demo: false }],
    sources: [{ id: SOURCE, bot_id: BOT, kind: "instagram", title: "Posts do Instagram (@lojadaana)", status: "pending", pages: 0, chunk_count: 0, sync_requested_at: "2026-10-20T10:00:00Z", sync_total: null, error: null, refresh_error: null }],
    instagram_channels: [{ bot_id: BOT, ig_user_id: "1784", access_token_enc: "selado", disconnected_at: null }],
    instagram_posts: [],
    chunks: [],
    ai_usage: [],
  };
  const mem = memoryDb(tables);
  // a trava da fonte (claim_source_sync): livre ou com outro leitor
  db = { from: mem.from.bind(mem), rpc: async (fn: string) => (fn === "claim_source_sync" ? { data: lockFree ? true : null, error: null } : mem.rpc(fn)) } as unknown as SupabaseClient;
});

const source = () => tables.sources[0];
const always = () => true;

describe("o texto de cada post", () => {
  it("as fotos a descrever: a foto, a capa do vídeo e as do carrossel", () => {
    expect(postImageUrls(photo)).toEqual(["https://cdn.ig/m1.jpg"]);
    expect(postImageUrls(album)).toEqual(["https://cdn.ig/c1.jpg", "https://cdn.ig/c2.jpg"]);
    expect(postImageUrls(reel)).toEqual(["https://cdn.ig/m3.jpg"]);
    // vídeo sem capa (música com direitos): nada a descrever, fica a legenda
    expect(postImageUrls({ id: "x", media_type: "VIDEO" })).toEqual([]);
  });

  it("reel é vídeo com o link /reel/; post sem data ou de tipo estranho não entra", () => {
    expect(isReel(reel)).toBe(true);
    expect(isReel({ media_type: "VIDEO", permalink: "https://www.instagram.com/p/DDD/" })).toBe(false);
    expect(readableMedia(photo)).toBe(true);
    expect(readableMedia({ id: "x", media_type: "IMAGE" })).toBe(false);
    expect(readableMedia({ id: "x", media_type: "STORY", timestamp: "2026-10-18T14:00:00+0000" })).toBe(false);
  });

  it("a foto descrita sai sem link nem telefone", () => {
    expect(photoLine({ descricao: "Vestido azul. Veja em https://loja.com/v", texto: "R$ 129,90 · chame no 21 99999-0000" })).toBe('Vestido azul. Veja em (link) Texto na foto: "R$ 129,90 · chame no (número)".');
    expect(photoLine({ descricao: "", texto: "R$ 10" })).toBe("");
  });

  it("legenda, tipo, cada foto e o link do post", () => {
    const text = postText({ caption: album.caption!, mediaType: "CAROUSEL_ALBUM", reel: false, permalink: album.permalink!, photos: ["Vestido azul.", "", "Saia rosa."], items: 3 });
    expect(text).toBe(["Legenda: Coleção de verão", "Tipo: carrossel com 3 itens", "Foto 1 do carrossel (descrição automática): Vestido azul.", "Foto 3 do carrossel (descrição automática): Saia rosa.", "Link do post: https://www.instagram.com/p/BBB/"].join("\n"));
    expect(postText({ caption: null, mediaType: "VIDEO", reel: true, permalink: null, photos: ["Uma pessoa costurando."] })).toBe("Legenda: (sem legenda)\nTipo: reel\nCapa do reel (descrição automática): Uma pessoa costurando.");
  });
});

describe("a leitura da fonte", () => {
  it("primeira leitura: cada post vira trechos com a data, a foto é descrita uma vez e a fonte fica pronta", async () => {
    const r = await syncInstagramSource(db, SOURCE, { hasTime: always });
    expect(r).toMatchObject({ status: "pronta", added: 3, updated: 0, removed: 0, total: 3 });
    // 1 foto + 2 do carrossel + a capa do reel
    expect(fake.describes).toBe(4);
    expect(tables.instagram_posts).toHaveLength(3);
    const p1 = tables.instagram_posts.find((p) => p.media_id === "m1")!;
    expect(p1).toMatchObject({ media_type: "IMAGE", is_reel: false, images: 1, permalink: "https://www.instagram.com/p/AAA/", posted_at: "2026-10-18T14:00:00.000Z" });
    expect(String(p1.description)).toContain("(link)");
    expect(tables.instagram_posts.find((p) => p.media_id === "m3")).toMatchObject({ is_reel: true });
    const chunk = tables.chunks.find((c) => (c.metadata as { ig_media_id?: string }).ig_media_id === "m1")!;
    expect(chunk.metadata).toEqual({ title: "Post do Instagram de 18/10/2026", url: "https://www.instagram.com/p/AAA/", kind: "instagram_post", ig_media_id: "m1", posted_at: "2026-10-18T14:00:00.000Z" });
    expect(String(chunk.content)).toContain("R$ 129,90");
    expect(String(chunk.content)).toContain("Link do post: https://www.instagram.com/p/AAA/");
    expect(p1.chunk_ids).toEqual([chunk.id]);
    expect(source()).toMatchObject({ status: "ready", pages: 3, sync_total: 3, sync_requested_at: null, error: null });
    expect(source().chunk_count).toBe(tables.chunks.length);
    // a visão e os embeddings contam como leitura da base
    expect(tables.ai_usage.filter((u) => u.kind === "leitura" && u.model === "gpt-6-luna")).toHaveLength(4);
    expect(tables.ai_usage.some((u) => u.kind === "leitura" && u.embedding_tokens)).toBe(true);
  });

  it("relendo: legenda mudada refaz o trecho sem descrever a foto, post fora da janela sai e post novo entra", async () => {
    await syncInstagramSource(db, SOURCE, { hasTime: always });
    const reelChunks = tables.instagram_posts.find((p) => p.media_id === "m3")!.chunk_ids as string[];
    fake.describes = 0;
    const fresh: IgMedia = { id: "m4", media_type: "IMAGE", caption: "Bolsa de palha", media_url: "https://cdn.ig/m4.jpg", permalink: "https://www.instagram.com/p/EEE/", timestamp: "2026-10-19T14:00:00+0000" };
    fake.media = [fresh, { ...photo, caption: "Vestido midi floral por R$ 99,90 (baixou!)" }, album];
    const r = await syncInstagramSource(db, SOURCE, { hasTime: always });
    expect(r).toMatchObject({ status: "pronta", added: 1, updated: 1, removed: 1, total: 3 });
    // só a foto do post novo foi descrita
    expect(fake.describes).toBe(1);
    expect(tables.instagram_posts.map((p) => p.media_id).sort()).toEqual(["m1", "m2", "m4"]);
    expect(tables.chunks.some((c) => reelChunks.includes(c.id as string))).toBe(false);
    const m1 = tables.chunks.filter((c) => (c.metadata as { ig_media_id?: string }).ig_media_id === "m1");
    expect(m1).toHaveLength(1);
    expect(String(m1[0].content)).toContain("R$ 99,90");
    // a descrição da foto ficou (não foi paga de novo)
    expect(String(m1[0].content)).toContain("Vestido midi floral azul");
    expect(source()).toMatchObject({ status: "ready", pages: 3 });
  });

  it("sem tempo: lê o que dá, a fonte já vale com o que leu e o resto fica para o tique seguinte", async () => {
    let calls = 0;
    const r = await syncInstagramSource(db, SOURCE, { hasTime: () => calls++ < 1 });
    expect(r.status).toBe("parcial");
    expect(r.added).toBe(1);
    expect(source()).toMatchObject({ status: "ready", pages: 1, sync_total: 3 });
    expect(source().sync_requested_at).not.toBeNull();
    // o tique seguinte termina
    const next = await syncInstagramSource(db, SOURCE, { hasTime: always });
    expect(next).toMatchObject({ status: "pronta", added: 2 });
    expect(source()).toMatchObject({ pages: 3, sync_requested_at: null });
  });

  it("outro leitor na fonte: não faz nada", async () => {
    lockFree = false;
    expect((await syncInstagramSource(db, SOURCE, { hasTime: always })).status).toBe("ocupada");
    expect(tables.instagram_posts).toHaveLength(0);
    expect(fake.describes).toBe(0);
  });

  it("foto que não dá para descrever: o post entra com a legenda", async () => {
    fake.failPhoto = true;
    const r = await syncInstagramSource(db, SOURCE, { hasTime: always });
    expect(r).toMatchObject({ status: "pronta", added: 3 });
    expect(tables.instagram_posts.every((p) => p.description === null && p.images === 0)).toBe(true);
    expect(tables.chunks.length).toBeGreaterThan(0);
  });

  it("leitura de fotos desligada na plataforma: só as legendas, sem chamar o modelo", async () => {
    fake.vision = false;
    await syncInstagramSource(db, SOURCE, { hasTime: always });
    expect(fake.describes).toBe(0);
    expect(tables.instagram_posts).toHaveLength(3);
  });

  it("conta desconectada: a primeira leitura fica com o erro", async () => {
    tables.instagram_channels[0].disconnected_at = "2026-10-20T09:00:00Z";
    const r = await syncInstagramSource(db, SOURCE, { hasTime: always });
    expect(r.status).toBe("erro");
    expect(source()).toMatchObject({ status: "error", sync_requested_at: null });
    expect(String(source().error)).toContain("desconectado");
  });

  it("chatbot sem IA (Atendimento): os posts não entram", async () => {
    tables.bots[0].size = "atendimento";
    expect((await syncInstagramSource(db, SOURCE, { hasTime: always })).status).toBe("erro");
    expect(tables.instagram_posts).toHaveLength(0);
    expect(String(source().error)).toContain("chatbot com IA");
  });

  it("a Meta não devolve nenhum post com a base cheia: a base fica como estava", async () => {
    await syncInstagramSource(db, SOURCE, { hasTime: always });
    const before = tables.chunks.length;
    fake.media = [];
    expect((await syncInstagramSource(db, SOURCE, { hasTime: always })).status).toBe("erro");
    expect(tables.chunks).toHaveLength(before);
    expect(source()).toMatchObject({ status: "ready", pages: 3 });
    expect(String(source().refresh_error)).toContain("não devolveu nenhum post");
  });
});
