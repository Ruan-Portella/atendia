import type { SupabaseClient } from "@supabase/supabase-js";
import { firstExceeded } from "./rate-limit";

/*
 * Roadmap público com curtidas (Lançamento, parte 5, 19/10/2026): o que estamos fazendo e o que vem
 * por aí, em quatro colunas, sem datas nem detalhes de como. Aberto em /roadmap; no painel, quem tem
 * conta curte (uma curtida por pessoa, dá para desfazer) e manda ideias, que a moderação do
 * backoffice publica em Ideias, junta a um item parecido (a pessoa ganha a curtida nele) ou recusa.
 * Tudo pela service role: as telas conferem quem é. Migração 0119.
 */

export const ROADMAP_STATUSES = ["ideia", "vamos_fazer", "fazendo", "pronto"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];
export const isRoadmapStatus = (v: unknown): v is RoadmapStatus => typeof v === "string" && (ROADMAP_STATUSES as readonly string[]).includes(v);
/** Id de item ou de sugestão (uuid). Pura. */
export const isRoadmapId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const ROADMAP_COLUMNS: Record<RoadmapStatus, { title: string; hint: string }> = {
  ideia: { title: "Ideias", hint: "Pedidos que estamos ouvindo. As mais curtidas sobem." },
  vamos_fazer: { title: "Vamos fazer", hint: "Decidido: está na fila." },
  fazendo: { title: "Fazendo", hint: "Em construção agora." },
  pronto: { title: "Pronto", hint: "Já está no BoaVoz." },
};

export const ROADMAP_TITLE_MAX = 120;
export const ROADMAP_SUMMARY_MAX = 300;
export const SUGGESTION_DETAILS_MAX = 1000;
/** Pronto mostra só os mais recentes. */
export const DONE_SHOWN = 12;

export interface RoadmapItem {
  id: string;
  title: string;
  summary: string | null;
  status: RoadmapStatus;
  likes: number;
  status_changed_at: string;
}

export interface RoadmapColumn {
  status: RoadmapStatus;
  title: string;
  hint: string;
  items: RoadmapItem[];
  /** itens de Pronto que ficaram de fora */
  more: number;
}

const ITEM_COLS = "id, title, summary, status, likes, status_changed_at";

/** As quatro colunas: as mais curtidas em cima; em Pronto, o mais recente. Pura. */
export function boardOf(items: RoadmapItem[]): RoadmapColumn[] {
  return ROADMAP_STATUSES.map((status) => {
    const list = items.filter((i) => i.status === status);
    if (status === "pronto") {
      list.sort((a, b) => b.status_changed_at.localeCompare(a.status_changed_at));
      return { status, ...ROADMAP_COLUMNS[status], items: list.slice(0, DONE_SHOWN), more: Math.max(0, list.length - DONE_SHOWN) };
    }
    list.sort((a, b) => b.likes - a.likes || a.title.localeCompare(b.title, "pt-BR"));
    return { status, ...ROADMAP_COLUMNS[status], items: list, more: 0 };
  });
}

/** Pode curtir: Pronto não recebe curtida. Pura. */
export const likeable = (status: RoadmapStatus) => status !== "pronto";

export async function loadRoadmap(db: SupabaseClient): Promise<RoadmapItem[]> {
  const { data } = await db.from("roadmap_items").select(ITEM_COLS).order("created_at").limit(1000);
  return ((data ?? []) as RoadmapItem[]).filter((i) => isRoadmapStatus(i.status));
}

/** Os itens que a pessoa curtiu. */
export async function likedBy(db: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data } = await db.from("roadmap_likes").select("item_id").eq("user_id", userId).limit(1000);
  return new Set((data ?? []).map((r) => String(r.item_id)));
}

async function addLike(db: SupabaseClient, itemId: string, userId: string): Promise<boolean> {
  const { data: had } = await db.from("roadmap_likes").select("item_id").eq("item_id", itemId).eq("user_id", userId).maybeSingle();
  if (had) return true;
  const { error } = await db.from("roadmap_likes").insert({ item_id: itemId, user_id: userId });
  // dois cliques ao mesmo tempo: a chave primária segura a segunda
  return !error || /duplicate/i.test(error.message);
}

export type LikeResult = { ok: true; liked: boolean } | { ok: false; message: string };

/** Curte ou desfaz a curtida. */
export async function toggleLike(db: SupabaseClient, itemId: string, userId: string): Promise<LikeResult> {
  const over = await firstExceeded(db, [{ key: `roadmap-curtida:${userId}`, max: 60, windowSeconds: 600, message: "Muitas curtidas seguidas. Espere uns minutos e tente de novo." }]);
  if (over) return { ok: false, message: over.message };
  const { data: item } = await db.from("roadmap_items").select("id, status").eq("id", itemId).maybeSingle();
  if (!item || !likeable(item.status as RoadmapStatus)) return { ok: false, message: "Este item não recebe curtidas." };
  const { data: had } = await db.from("roadmap_likes").select("item_id").eq("item_id", itemId).eq("user_id", userId).maybeSingle();
  if (had) {
    const { error } = await db.from("roadmap_likes").delete().eq("item_id", itemId).eq("user_id", userId);
    return error ? { ok: false, message: "Não foi possível desfazer a curtida. Tente de novo." } : { ok: true, liked: false };
  }
  return (await addLike(db, itemId, userId)) ? { ok: true, liked: true } : { ok: false, message: "Não foi possível curtir. Tente de novo." };
}

/* ------------------------------------------------------------------ sugestões */

export type SuggestionStatus = "nova" | "publicada" | "juntada" | "recusada";

export const SUGGESTION_STATUS_LABEL: Record<SuggestionStatus, string> = {
  nova: "Recebida",
  publicada: "No roadmap",
  juntada: "Juntamos a uma ideia parecida",
  recusada: "Não vai entrar agora",
};

const oneLine = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** A ideia mandada pelo painel. Pura. */
export function parseSuggestion(input: { title: unknown; details: unknown }): { title: string; details: string | null } | { error: string } {
  const title = oneLine(input.title);
  const details = typeof input.details === "string" ? input.details.trim() : "";
  if (title.length < 3) return { error: "Escreva a ideia em poucas palavras." };
  if (title.length > ROADMAP_TITLE_MAX) return { error: `A ideia passou de ${ROADMAP_TITLE_MAX} caracteres. O resto vai nos detalhes.` };
  if (details.length > SUGGESTION_DETAILS_MAX) return { error: `Os detalhes passaram de ${SUGGESTION_DETAILS_MAX} caracteres.` };
  return { title, details: details || null };
}

export async function submitSuggestion(db: SupabaseClient, s: { userId: string; agencyId: string; title: string; details: string | null }): Promise<{ ok: true } | { ok: false; message: string }> {
  const over = await firstExceeded(db, [{ key: `roadmap-sugestao:${s.userId}`, max: 5, windowSeconds: 86_400, message: "Você já mandou 5 ideias hoje. Mande as próximas amanhã." }]);
  if (over) return { ok: false, message: over.message };
  const { error } = await db.from("roadmap_suggestions").insert({ user_id: s.userId, agency_id: s.agencyId, title: s.title, details: s.details, status: "nova" });
  return error ? { ok: false, message: "Não foi possível mandar a ideia. Tente de novo." } : { ok: true };
}

export interface MySuggestion {
  id: string;
  title: string;
  status: SuggestionStatus;
  /** o item em que a ideia entrou ou foi juntada */
  itemTitle: string | null;
}

/** As últimas ideias que a pessoa mandou, com o que aconteceu com cada uma. */
export async function suggestionsOf(db: SupabaseClient, userId: string): Promise<MySuggestion[]> {
  const { data } = await db.from("roadmap_suggestions").select("id, title, status, item_id, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(10);
  const rows = (data ?? []) as Array<{ id: string; title: string; status: SuggestionStatus; item_id: string | null }>;
  const ids = [...new Set(rows.map((r) => r.item_id).filter((v): v is string => Boolean(v)))];
  const { data: items } = ids.length ? await db.from("roadmap_items").select("id, title").in("id", ids) : { data: [] };
  const title = new Map((items ?? []).map((i) => [String(i.id), String(i.title)]));
  return rows.map((r) => ({ id: r.id, title: r.title, status: r.status, itemTitle: r.item_id ? (title.get(r.item_id) ?? null) : null }));
}

/* ------------------------------------------------------------------ moderação (backoffice) */

/** Título, resumo e coluna de um item (backoffice). Pura. */
export function parseItemFields(input: { title: unknown; summary: unknown; status: unknown }): { title: string; summary: string | null; status: RoadmapStatus } | { error: string } {
  const title = oneLine(input.title);
  const summary = oneLine(input.summary);
  if (title.length < 3 || title.length > ROADMAP_TITLE_MAX) return { error: `O título vai de 3 a ${ROADMAP_TITLE_MAX} caracteres.` };
  if (summary.length > ROADMAP_SUMMARY_MAX) return { error: `O resumo vai até ${ROADMAP_SUMMARY_MAX} caracteres.` };
  if (!isRoadmapStatus(input.status)) return { error: "Escolha a coluna." };
  return { title, summary: summary || null, status: input.status };
}

/** Cria (id null) ou altera um item; mudar de coluna põe o item no topo de Pronto. */
export async function saveItem(db: SupabaseClient, id: string | null, f: { title: string; summary: string | null; status: RoadmapStatus }, now = new Date()): Promise<string | null> {
  const at = now.toISOString();
  if (!id) {
    const { data, error } = await db.from("roadmap_items").insert({ ...f, status_changed_at: at }).select("id").single();
    return error || !data ? null : String(data.id);
  }
  const { data: before } = await db.from("roadmap_items").select("status").eq("id", id).maybeSingle();
  if (!before) return null;
  const { error } = await db.from("roadmap_items").update({ ...f, ...(before.status !== f.status ? { status_changed_at: at } : {}) }).eq("id", id);
  return error ? null : id;
}

export interface PendingSuggestion {
  id: string;
  title: string;
  details: string | null;
  created_at: string;
  user_id: string | null;
  agencyName: string | null;
}

/** As ideias esperando a moderação, as mais antigas primeiro. */
export async function pendingSuggestions(db: SupabaseClient): Promise<PendingSuggestion[]> {
  const { data } = await db.from("roadmap_suggestions").select("id, title, details, created_at, user_id, agency_id").eq("status", "nova").order("created_at").limit(200);
  const rows = (data ?? []) as Array<Omit<PendingSuggestion, "agencyName"> & { agency_id: string | null }>;
  const ids = [...new Set(rows.map((r) => r.agency_id).filter((v): v is string => Boolean(v)))];
  const { data: agencies } = ids.length ? await db.from("agencies").select("id, name").in("id", ids) : { data: [] };
  const name = new Map((agencies ?? []).map((a) => [String(a.id), String(a.name)]));
  return rows.map(({ agency_id, ...r }) => ({ ...r, agencyName: agency_id ? (name.get(agency_id) ?? null) : null }));
}

async function closeSuggestion(db: SupabaseClient, id: string, status: Exclude<SuggestionStatus, "nova">, itemId: string | null, now: Date): Promise<{ user_id: string | null } | null> {
  const { data } = await db.from("roadmap_suggestions").update({ status, item_id: itemId, reviewed_at: now.toISOString() }).eq("id", id).eq("status", "nova").select("user_id");
  return data?.length ? { user_id: (data[0].user_id as string | null) ?? null } : null;
}

/** Publica a ideia como item novo em Ideias; quem mandou ganha a curtida. */
export async function publishSuggestion(db: SupabaseClient, id: string, f: { title: string; summary: string | null }, now = new Date()): Promise<string | null> {
  const itemId = await saveItem(db, null, { ...f, status: "ideia" }, now);
  if (!itemId) return null;
  const closed = await closeSuggestion(db, id, "publicada", itemId, now);
  if (!closed) {
    // outra pessoa da moderação chegou antes: o item novo não fica
    await db.from("roadmap_items").delete().eq("id", itemId);
    return null;
  }
  if (closed.user_id) await addLike(db, itemId, closed.user_id);
  return itemId;
}

/** Junta a ideia a um item parecido; quem mandou ganha a curtida nele. */
export async function mergeSuggestion(db: SupabaseClient, id: string, itemId: string, now = new Date()): Promise<boolean> {
  const { data: item } = await db.from("roadmap_items").select("id, status").eq("id", itemId).maybeSingle();
  if (!item) return false;
  const closed = await closeSuggestion(db, id, "juntada", itemId, now);
  if (!closed) return false;
  if (closed.user_id && likeable(item.status as RoadmapStatus)) await addLike(db, itemId, closed.user_id);
  return true;
}

export async function rejectSuggestion(db: SupabaseClient, id: string, now = new Date()): Promise<boolean> {
  return Boolean(await closeSuggestion(db, id, "recusada", null, now));
}
