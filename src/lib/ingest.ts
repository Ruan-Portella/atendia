import * as cheerio from "cheerio";
import { extractText, getDocumentProxy } from "unpdf";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts } from "./ai";

/* ------------------------------------------------------------------------ */
/* Extração de texto                                                         */
/* ------------------------------------------------------------------------ */

export interface PageText {
  url: string;
  title: string;
  text: string;
  links: string[];
}

const UA = "Mozilla/5.0 (compatible; AtendiaBot/1.0; +https://atendia.com.br/bot)";

export async function fetchPage(url: string, timeoutMs = 12000): Promise<PageText | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, redirect: "follow", signal: ctrl.signal });
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok || !ct.includes("text/html")) return null;
    const html = await res.text();
    return parseHtml(url, html);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function parseHtml(url: string, html: string): PageText {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, nav, footer, header, form, [aria-hidden='true'], .cookie, #cookie").remove();
  const title = ($("title").first().text() || $("h1").first().text() || url).trim().slice(0, 200);
  const root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  const text = root
    .text()
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();

  const base = new URL(url);
  const links = new Set<string>();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    try {
      const u = new URL(href, base);
      if (u.hostname !== base.hostname) return;
      if (!/^https?:$/.test(u.protocol)) return;
      if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|mp4|mp3|docx?|xlsx?)$/i.test(u.pathname)) return;
      if (/\/(wp-admin|wp-login|cart|carrinho|checkout|login|logout|admin|tag|tags|feed)\b/i.test(u.pathname)) return;
      u.hash = "";
      u.search = "";
      links.add(u.toString());
    } catch {
      /* ignora */
    }
  });
  return { url, title, text, links: [...links] };
}

/** Rastreia o site a partir da URL inicial, mesmo domínio, até `maxPages` páginas. */
export async function crawlSite(startUrl: string, maxPages = Number(process.env.CRAWL_MAX_PAGES ?? 40)): Promise<PageText[]> {
  const seen = new Set<string>([startUrl]);
  const queue = [startUrl];
  const pages: PageText[] = [];
  while (queue.length && pages.length < maxPages) {
    const batch = queue.splice(0, 5);
    const results = await Promise.all(batch.map((u) => fetchPage(u)));
    for (const p of results) {
      if (!p || p.text.length < 80) continue;
      pages.push(p);
      for (const l of p.links) {
        if (!seen.has(l) && seen.size < maxPages * 4) {
          seen.add(l);
          queue.push(l);
        }
      }
    }
  }
  return pages;
}

export async function extractPdfText(buffer: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { text: (Array.isArray(text) ? text.join("\n") : text).replace(/[ \t]+/g, " ").trim(), pages: totalPages };
}

/* ------------------------------------------------------------------------ */
/* Chunking                                                                  */
/* ------------------------------------------------------------------------ */

/** Quebra texto em trechos de ~1200 caracteres respeitando parágrafos, com pequena sobreposição. */
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const paras = text.split(/\n{2,}|\n(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/).map((p) => p.trim()).filter((p) => p.length > 0);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n" + p).length > size && cur) {
      chunks.push(cur.trim());
      cur = cur.slice(-overlap) + "\n" + p;
    } else {
      cur = cur ? cur + "\n" + p : p;
    }
    while (cur.length > size * 1.5) {
      chunks.push(cur.slice(0, size).trim());
      cur = cur.slice(size - overlap);
    }
  }
  if (cur.trim().length > 40) chunks.push(cur.trim());
  return chunks.filter((c) => c.length > 40);
}

/* ------------------------------------------------------------------------ */
/* Ingestão completa de uma fonte                                            */
/* ------------------------------------------------------------------------ */

export interface SourceRow {
  id: string;
  bot_id: string;
  kind: "site" | "page" | "pdf" | "text" | "faq";
  title: string;
  url: string | null;
  content: string | null;
}

/**
 * Processa uma fonte: extrai texto, quebra em trechos, gera embeddings e grava.
 * Usa o client com service role (roda em Route Handler ou Server Action).
 */
export async function ingestSource(db: SupabaseClient, source: SourceRow, pdfBuffer?: ArrayBuffer): Promise<{ chunks: number; pages: number }> {
  await db.from("sources").update({ status: "pending", error: null }).eq("id", source.id);
  try {
    const docs: Array<{ text: string; meta: Record<string, unknown> }> = [];
    let pages = 0;

    if (source.kind === "site" && source.url) {
      const crawled = await crawlSite(source.url);
      if (!crawled.length) throw new Error("Não consegui ler nenhuma página desse site. Ele bloqueia robôs ou depende de JavaScript.");
      pages = crawled.length;
      for (const p of crawled) docs.push({ text: `${p.title}\n${p.text}`, meta: { url: p.url, title: p.title } });
    } else if (source.kind === "page" && source.url) {
      const p = await fetchPage(source.url);
      if (!p) throw new Error("Não consegui ler essa página.");
      pages = 1;
      docs.push({ text: `${p.title}\n${p.text}`, meta: { url: p.url, title: p.title } });
    } else if (source.kind === "pdf") {
      if (!pdfBuffer) throw new Error("PDF não recebido.");
      const r = await extractPdfText(pdfBuffer);
      if (r.text.length < 40) throw new Error("O PDF não tem texto extraível (pode ser imagem escaneada).");
      pages = r.pages;
      docs.push({ text: r.text, meta: { title: source.title } });
    } else {
      if (!source.content || source.content.trim().length < 20) throw new Error("Texto vazio.");
      pages = 1;
      docs.push({ text: source.content, meta: { title: source.title } });
    }

    const pieces: Array<{ content: string; metadata: Record<string, unknown> }> = [];
    for (const d of docs) for (const c of chunkText(d.text)) pieces.push({ content: c, metadata: d.meta });
    if (!pieces.length) throw new Error("Nenhum conteúdo aproveitável encontrado.");

    const embeddings = await embedTexts(pieces.map((p) => p.content));

    await db.from("chunks").delete().eq("source_id", source.id);
    for (let i = 0; i < pieces.length; i += 200) {
      const rows = pieces.slice(i, i + 200).map((p, j) => ({
        bot_id: source.bot_id,
        source_id: source.id,
        content: p.content,
        embedding: JSON.stringify(embeddings[i + j]),
        metadata: p.metadata,
      }));
      const { error } = await db.from("chunks").insert(rows);
      if (error) throw new Error(error.message);
    }

    await db.from("sources").update({ status: "ready", chunk_count: pieces.length, pages, content: source.kind === "site" || source.kind === "pdf" ? null : source.content }).eq("id", source.id);
    return { chunks: pieces.length, pages };
  } catch (e) {
    const message = (e as Error).message ?? "erro desconhecido";
    await db.from("sources").update({ status: "error", error: message.slice(0, 500) }).eq("id", source.id);
    throw e;
  }
}
