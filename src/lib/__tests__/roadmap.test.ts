import { describe, expect, it } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import {
  DONE_SHOWN,
  boardOf,
  mergeSuggestion,
  parseItemFields,
  parseSuggestion,
  publishSuggestion,
  rejectSuggestion,
  saveItem,
  submitSuggestion,
  suggestionsOf,
  toggleLike,
  type RoadmapItem,
} from "../roadmap";

const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENCY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const item = (id: string, status: RoadmapItem["status"], likes = 0, at = "2026-10-01T12:00:00.000Z", title = id): RoadmapItem => ({ id, title, summary: null, status, likes, status_changed_at: at });

describe("roadmap", () => {
  it("as colunas: as mais curtidas em cima; em Pronto, as mais recentes, com o resto contado", () => {
    const done = Array.from({ length: DONE_SHOWN + 2 }, (_, i) => item(`p${i}`, "pronto", 0, new Date(Date.UTC(2026, 9, 1 + i)).toISOString()));
    const cols = boardOf([item("b", "ideia", 2), item("a", "ideia", 2), item("c", "ideia", 9), item("f", "fazendo", 1), ...done]);
    expect(cols.map((c) => c.title)).toEqual(["Ideias", "Vamos fazer", "Fazendo", "Pronto"]);
    expect(cols[0].items.map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(cols[1].items).toEqual([]);
    expect(cols[3].items).toHaveLength(DONE_SHOWN);
    expect(cols[3].items[0].id).toBe(`p${DONE_SHOWN + 1}`);
    expect(cols[3].more).toBe(2);
  });

  it("a ideia mandada: uma linha só no título, limites e detalhes opcionais", () => {
    expect(parseSuggestion({ title: "  Agenda   com\n o Google ", details: "  " })).toEqual({ title: "Agenda com o Google", details: null });
    expect(parseSuggestion({ title: "ab", details: "" })).toHaveProperty("error");
    expect(parseSuggestion({ title: "x".repeat(121), details: "" })).toHaveProperty("error");
    expect(parseSuggestion({ title: "Agenda", details: "x".repeat(1001) })).toHaveProperty("error");
    expect(parseSuggestion({ title: null, details: null })).toHaveProperty("error");
    expect(parseItemFields({ title: "Pix", summary: "", status: "fazendo" })).toEqual({ title: "Pix", summary: null, status: "fazendo" });
    expect(parseItemFields({ title: "Pix", summary: "", status: "talvez" })).toHaveProperty("error");
    expect(parseItemFields({ title: "Pix", summary: "x".repeat(301), status: "ideia" })).toHaveProperty("error");
  });

  it("curtir e desfazer, uma por pessoa; Pronto não recebe curtida", async () => {
    const t: Record<string, MemRow[]> = { roadmap_items: [{ ...item("i1", "ideia") }, { ...item("i2", "pronto") }], roadmap_likes: [] };
    const db = memoryDb(t);
    expect(await toggleLike(db, "i1", U1)).toEqual({ ok: true, liked: true });
    expect(await toggleLike(db, "i1", U2)).toEqual({ ok: true, liked: true });
    expect(t.roadmap_likes.map((l) => l.user_id).sort()).toEqual([U1, U2]);
    expect(await toggleLike(db, "i1", U1)).toEqual({ ok: true, liked: false });
    expect(t.roadmap_likes.map((l) => l.user_id)).toEqual([U2]);
    expect((await toggleLike(db, "i2", U1)).ok).toBe(false);
    expect((await toggleLike(db, "nao-existe", U1)).ok).toBe(false);
  });

  it("mudar de coluna marca o momento; salvar sem mudar a coluna não", async () => {
    const t: Record<string, MemRow[]> = { roadmap_items: [{ ...item("i1", "ideia") }] };
    const db = memoryDb(t);
    await saveItem(db, "i1", { title: "Pix na assinatura", summary: null, status: "ideia" }, new Date("2026-10-19T12:00:00.000Z"));
    expect(t.roadmap_items[0]).toMatchObject({ title: "Pix na assinatura", status_changed_at: "2026-10-01T12:00:00.000Z" });
    await saveItem(db, "i1", { title: "Pix na assinatura", summary: null, status: "fazendo" }, new Date("2026-10-19T12:00:00.000Z"));
    expect(t.roadmap_items[0]).toMatchObject({ status: "fazendo", status_changed_at: "2026-10-19T12:00:00.000Z" });
    expect(await saveItem(db, "nao-existe", { title: "X", summary: null, status: "ideia" })).toBeNull();
  });

  it("a moderação: publicar cria o item com a curtida de quem mandou; juntar dá a curtida no item; recusar fecha; cada ideia só uma vez", async () => {
    const t: Record<string, MemRow[]> = { roadmap_items: [{ ...item("i1", "vamos_fazer", 3, undefined, "Agenda") }, { ...item("i2", "pronto") }], roadmap_likes: [], roadmap_suggestions: [] };
    const db = memoryDb(t);
    expect(await submitSuggestion(db, { userId: U1, agencyId: AGENCY, title: "Lembrete de aniversário", details: null })).toEqual({ ok: true });
    await submitSuggestion(db, { userId: U2, agencyId: AGENCY, title: "Agendar pelo WhatsApp", details: "como a agenda do Google" });
    await submitSuggestion(db, { userId: U2, agencyId: AGENCY, title: "Pix", details: null });
    await submitSuggestion(db, { userId: U2, agencyId: AGENCY, title: "Spam", details: null });
    const [s1, s2, s3, s4] = t.roadmap_suggestions.map((s) => String(s.id));
    expect(t.roadmap_suggestions.every((s) => s.status === "nova")).toBe(true);

    const created = await publishSuggestion(db, s1, { title: "Lembrete de aniversário", summary: null });
    expect(created).toBeTruthy();
    expect(t.roadmap_items.find((i) => i.id === created)).toMatchObject({ status: "ideia", title: "Lembrete de aniversário" });
    expect(t.roadmap_likes).toEqual([expect.objectContaining({ item_id: created, user_id: U1 })]);
    expect(t.roadmap_suggestions[0]).toMatchObject({ status: "publicada", item_id: created });
    // de novo: nada muda (o item novo não fica)
    expect(await publishSuggestion(db, s1, { title: "Outra", summary: null })).toBeNull();
    expect(t.roadmap_items).toHaveLength(3);

    expect(await mergeSuggestion(db, s2, "i1")).toBe(true);
    expect(t.roadmap_likes.filter((l) => l.item_id === "i1").map((l) => l.user_id)).toEqual([U2]);
    // juntar a um item pronto fecha a ideia sem curtida
    expect(await mergeSuggestion(db, s3, "i2")).toBe(true);
    expect(t.roadmap_likes.filter((l) => l.item_id === "i2")).toEqual([]);

    expect(await rejectSuggestion(db, s4)).toBe(true);
    expect(await rejectSuggestion(db, s4)).toBe(false);

    const mine = await suggestionsOf(db, U2);
    expect(mine.map((m) => [m.title, m.status, m.itemTitle]).sort()).toEqual([
      ["Agendar pelo WhatsApp", "juntada", "Agenda"],
      ["Pix", "juntada", "i2"],
      ["Spam", "recusada", null],
    ]);
  });
});
