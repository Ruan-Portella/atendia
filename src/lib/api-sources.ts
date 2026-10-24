import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, invalidRequest, notFound, readJsonBody, withIdempotency, type ApiContext } from "./api-v1";
import { decodeCursor, encodeCursor, pageLimit } from "./api-conversations";
import { ingestSource, type SourceRow } from "./ingest";
import { classifyLater } from "./gate/base";
import { markAnalysisDue } from "./bot-analysis";
import { asContext, parseSourceTag, type FlatContext } from "./bot-context";
import { safeFetch } from "./safe-fetch";
import { SOURCES_BUCKET, removeSourceFiles, sourcePdfPath } from "./source-files";
import { firstExceeded } from "./rate-limit";
import { normalizeUrl } from "./utils";
import { csvToText } from "./csv-source";

/*
 * Fontes pela API (D', parte 1, 19/10/2026; spec, "Fonte de conhecimento por contexto"), permissão
 * sources:
 * - POST /v1/bots/{id}/sources {kind, title?, content | url, context?}: texto, FAQ, planilha CSV (o
 *   texto do arquivo em content), uma página ou um PDF por URL. Com `context`, a fonte só vale nas conversas daquele contexto (o SaaS manda os
 *   documentos de cada cliente dele) e só passa pelo portão, sem a análise do bot.
 * - GET /v1/bots/{id}/sources ?context=<json> | ?tagged=false, cursor, limit.
 * - DELETE /v1/bots/{id}/sources/{source}.
 * O site inteiro fica no painel (a leitura de várias páginas passa do tempo de uma requisição).
 */

export const API_SOURCE_KINDS = ["text", "faq", "csv", "page", "pdf"] as const;
export type ApiSourceKind = (typeof API_SOURCE_KINDS)[number];
const isKind = (v: unknown): v is ApiSourceKind => typeof v === "string" && (API_SOURCE_KINDS as readonly string[]).includes(v);

/** O corpo vai até 32 KB: o texto, até 30 mil caracteres (para mais, um PDF por URL). */
export const API_SOURCE_TEXT_MAX = 30_000;
export const API_SOURCE_PDF_MAX_BYTES = 15 * 1024 * 1024;
/** Fontes novas por chave, por hora (a leitura gasta embeddings). */
const CREATE_PER_HOUR = 300;

const SRC_ID = /^src_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const COLS = "id, bot_id, kind, title, url, status, chunk_count, pages, error, context, created_at";

export interface ApiSourceInput {
  kind: ApiSourceKind;
  title: string;
  content: string | null;
  url: string | null;
  context: FlatContext | null;
}

/** O corpo do POST. Pura. */
export function parseSourceBody(body: Record<string, unknown>): ApiSourceInput | { error: string; field: string } {
  if (!isKind(body.kind)) return { error: `kind deve ser ${API_SOURCE_KINDS.join(", ")}.`, field: "kind" };
  const kind = body.kind;
  if (body.title !== undefined && body.title !== null && typeof body.title !== "string") return { error: "title deve ser texto.", field: "title" };
  const rawTitle = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const tag = parseSourceTag(body.context);
  if ("error" in tag) return { error: tag.error, field: "context" };
  if (kind === "text" || kind === "faq") {
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (content.length < 20) return { error: "content precisa de pelo menos 20 caracteres.", field: "content" };
    if (content.length > API_SOURCE_TEXT_MAX) return { error: `content vai até ${API_SOURCE_TEXT_MAX} caracteres; para mais, mande um PDF por URL.`, field: "content" };
    return { kind, title: rawTitle || (kind === "faq" ? "Perguntas frequentes" : "Texto"), content, url: null, context: tag.value };
  }
  if (kind === "csv") {
    const raw = typeof body.content === "string" ? body.content : "";
    if (raw.length > API_SOURCE_TEXT_MAX) return { error: `content vai até ${API_SOURCE_TEXT_MAX} caracteres; para mais, divida a planilha em várias fontes.`, field: "content" };
    const csv = csvToText(raw);
    if ("error" in csv) return { error: csv.error, field: "content" };
    return { kind, title: rawTitle || "Planilha", content: csv.text, url: null, context: tag.value };
  }
  const url = typeof body.url === "string" ? normalizeUrl(body.url) : null;
  if (!url || !/^https?:\/\//i.test(url)) return { error: "url precisa ser um endereço http ou https.", field: "url" };
  return { kind, title: rawTitle || (kind === "pdf" ? (new URL(url).pathname.split("/").pop() || "documento.pdf") : new URL(url).hostname.replace(/^www\./, "")), content: null, url, context: tag.value };
}

interface SourceDbRow {
  id: string;
  bot_id: string;
  kind: string;
  title: string;
  url: string | null;
  status: string;
  chunk_count: number;
  pages: number;
  error: string | null;
  context: unknown;
  created_at: string;
}

/** A fonte como a API devolve. Pura. */
export function sourceApiObject(r: SourceDbRow) {
  return {
    id: `src_${r.id}`,
    bot_id: `bot_${r.bot_id}`,
    kind: r.kind,
    title: r.title,
    url: r.url,
    status: r.status,
    chunks: r.chunk_count,
    pages: r.pages,
    error: r.error,
    context: asContext(r.context),
    created_at: r.created_at,
  };
}

/** A query ?context=<json>: o JSON da etiqueta, ou 400. */
function contextQuery(raw: string | null): FlatContext | null {
  if (raw === null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalidRequest('context deve ser um JSON, como {"workspace_id":"ws_abc"}.', { field: "context" });
  }
  const tag = parseSourceTag(parsed);
  if ("error" in tag) throw invalidRequest(tag.error, { field: "context" });
  return tag.value;
}

/** GET /v1/bots/{id}/sources: as mais novas primeiro. */
export async function listSourcesApi(req: Request, api: ApiContext, rawBotId: string): Promise<Response> {
  const botId = api.requireBot(rawBotId);
  const p = new URL(req.url).searchParams;
  const limit = pageLimit(p.get("limit"));
  const ctx = contextQuery(p.get("context"));
  const tagged = p.get("tagged");
  if (tagged !== null && tagged !== "true" && tagged !== "false") throw invalidRequest("tagged deve ser true ou false.", { field: "tagged" });
  const cursor = decodeCursor(p.get("cursor"), 2) as [string, string] | null;
  let q = api.db.from("sources").select(COLS).eq("bot_id", botId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (ctx) q = q.contains("context", ctx).containedBy("context", ctx);
  else if (tagged === "false") q = q.is("context", null);
  else if (tagged === "true") q = q.not("context", "is", null);
  if (cursor) q = q.or(`created_at.lt."${cursor[0]}",and(created_at.eq."${cursor[0]}",id.lt.${cursor[1]})`);
  const { data, error } = await q;
  if (error) throw new Error(`fontes: ${error.message}`);
  const rows = (data ?? []) as SourceDbRow[];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return Response.json({ data: page.map(sourceApiObject), next_cursor: rows.length > limit && last ? encodeCursor([last.created_at, last.id]) : null });
}

/** Baixa o PDF da URL (pela busca segura), até 15 MB; confere que é um PDF. */
async function downloadPdf(url: string): Promise<ArrayBuffer> {
  let fetched: Awaited<ReturnType<typeof safeFetch>>;
  try {
    fetched = await safeFetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new ApiError(422, "source_unreadable", "Não foi possível baixar o PDF dessa URL.");
  }
  const { res } = fetched;
  if (!res.ok || !res.body) throw new ApiError(422, "source_unreadable", `A URL do PDF respondeu ${res.status}.`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > API_SOURCE_PDF_MAX_BYTES) throw new ApiError(422, "source_too_large", "PDF acima de 15 MB.");
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > API_SOURCE_PDF_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError(422, "source_too_large", "PDF acima de 15 MB.");
    }
    parts.push(value);
  }
  const buf = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    buf.set(p, at);
    at += p.byteLength;
  }
  if (String.fromCharCode(...buf.slice(0, 5)) !== "%PDF-") throw new ApiError(422, "source_unreadable", "O arquivo dessa URL não é um PDF.");
  return buf.buffer;
}

/** POST /v1/bots/{id}/sources: grava e lê na hora (a resposta já diz quantos trechos entraram). */
export async function createSourceApi(req: Request, api: ApiContext, rawBotId: string): Promise<Response> {
  const botId = api.requireBot(rawBotId);
  const { raw, body } = await readJsonBody(req);
  const input = parseSourceBody(body);
  if ("error" in input) throw invalidRequest(input.error, { field: input.field });
  return withIdempotency(api, req, raw, async () => {
    const over = await firstExceeded(api.db, [{ key: `api-fontes:${api.key.id}`, max: CREATE_PER_HOUR, windowSeconds: 3600, message: "rate_limited" }]);
    if (over) throw new ApiError(429, "rate_limited", `Até ${CREATE_PER_HOUR} fontes novas por hora com esta chave. Tente de novo mais tarde.`, undefined, { "Retry-After": "600" });
    const source = await createSource(api.db, botId, input, { apiKeyId: api.key.id, author: `API · ${api.key.name}` });
    return { status: 201, body: sourceApiObject(source) };
  });
}

/** Grava a fonte, lê e classifica; falhou a leitura: a fonte sai e a resposta diz o motivo (422). */
export async function createSource(db: SupabaseClient, botId: string, input: ApiSourceInput, by: { apiKeyId: string | null; author: string }): Promise<SourceDbRow> {
  const pdf = input.kind === "pdf" && input.url ? await downloadPdf(input.url) : undefined;
  const filePath = pdf ? sourcePdfPath(botId, input.title.toLowerCase().endsWith(".pdf") ? input.title : `${input.title}.pdf`) : null;
  if (pdf && filePath) {
    const { error } = await db.storage.from(SOURCES_BUCKET).upload(filePath, pdf, { contentType: "application/pdf", upsert: false });
    if (error) throw new Error(`PDF da fonte: ${error.message}`);
  }
  const { data: row, error } = await db
    .from("sources")
    .insert({ bot_id: botId, kind: input.kind, title: input.title, url: input.url, content: input.content, context: input.context, api_key_id: by.apiKeyId, created_by: by.author, file_path: filePath })
    .select(`${COLS}, content, file_path`)
    .single();
  if (error || !row) {
    await removeSourceFiles(db, [filePath]);
    throw new Error(`fonte não gravada: ${error?.message ?? "sem linha"}`);
  }
  try {
    await ingestSource(db, row as unknown as SourceRow, pdf);
  } catch (e) {
    await db.from("sources").delete().eq("id", row.id);
    await removeSourceFiles(db, [filePath]);
    throw new ApiError(422, "source_unreadable", (e as Error).message.slice(0, 300));
  }
  classifyLater(db, botId);
  // a fonte geral muda o que o chatbot sabe: a análise do bot roda de novo; a com etiqueta, não
  if (!input.context) await markAnalysisDue(db, botId);
  const { data: done } = await db.from("sources").select(COLS).eq("id", row.id).single();
  return (done ?? row) as SourceDbRow;
}

/** DELETE /v1/bots/{id}/sources/{source}. */
export async function deleteSourceApi(api: ApiContext, rawBotId: string, rawSourceId: string): Promise<Response> {
  const botId = api.requireBot(rawBotId);
  const m = SRC_ID.exec(rawSourceId);
  if (!m) throw notFound();
  const { data: before } = await api.db.from("sources").select("id, context, file_path").eq("id", m[1].toLowerCase()).eq("bot_id", botId).maybeSingle();
  if (!before) throw notFound();
  const { error } = await api.db.from("sources").delete().eq("id", before.id);
  if (error) throw new Error(`fonte não apagada: ${error.message}`);
  await removeSourceFiles(api.db, [before.file_path as string | null], botId);
  if (!asContext(before.context)) await markAnalysisDue(api.db, botId);
  return new Response(null, { status: 204 });
}
