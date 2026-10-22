import { RESERVED_HEADERS } from "./custom-headers";

/*
 * Importar uma ação de um comando cURL (redesenho, etapa 5): o endereço, os cabeçalhos e os
 * parâmetros do corpo em JSON (ou formulário) viram os campos da ação. Os cabeçalhos reservados
 * (assinatura, transporte, Content-Type) e os de navegador ficam de fora. Pura.
 */

export type CurlParamType = "string" | "number" | "integer" | "boolean" | "array";
export interface CurlImport {
  url: string;
  headers: Array<{ name: string; value: string }>;
  params: Array<{ name: string; type: CurlParamType }>;
  /** um nome sugerido a partir do caminho do endereço (snake_case) */
  name: string;
}

const SKIP_HEADERS = /^(accept|accept-encoding|accept-language|user-agent|origin|referer|cookie|cache-control|pragma)$/i;
const DATA_FLAGS = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--json"]);
const WITH_VALUE = new Set(["-X", "--request", "-u", "--user", "-A", "--user-agent", "-e", "--referer", "-b", "--cookie", "-o", "--output", "-m", "--max-time", "--connect-timeout", "-x", "--proxy", "--data-urlencode", "-F", "--form"]);

/** As palavras do comando, como o shell separa: aspas simples e duplas, barra no fim da linha. */
export function shellWords(text: string): string[] {
  const src = text.replace(/\\\r?\n/g, " ").replace(/\^\r?\n/g, " ");
  const words: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  let any = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < src.length && /["\\$`]/.test(src[i + 1])) cur += src[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      any = true;
    } else if (/\s/.test(c)) {
      if (cur || any) words.push(cur);
      cur = "";
      any = false;
    } else if (c === "\\" && i + 1 < src.length) {
      cur += src[++i];
    } else cur += c;
  }
  if (cur || any) words.push(cur);
  return words;
}

const typeOf = (v: unknown): CurlParamType => (typeof v === "boolean" ? "boolean" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : Array.isArray(v) ? "array" : "string");
const snake = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "p_$1")
    .slice(0, 40);

/** O comando em campos da ação; null quando não acha um endereço HTTPS. */
export function parseCurl(text: string): CurlImport | null {
  const words = shellWords(text.trim());
  let url = "";
  const headers: CurlImport["headers"] = [];
  let body: string | null = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === "curl") continue;
    if (w === "-H" || w === "--header") {
      const h = words[++i] ?? "";
      const at = h.indexOf(":");
      if (at > 0) {
        const name = h.slice(0, at).trim();
        if (!RESERVED_HEADERS.test(name) && !SKIP_HEADERS.test(name)) headers.push({ name, value: h.slice(at + 1).trim() });
      }
    } else if (DATA_FLAGS.has(w)) body = words[++i] ?? "";
    else if (w === "--url") url = words[++i] ?? url;
    else if (WITH_VALUE.has(w)) i++;
    else if (/^https?:\/\//i.test(w) && !url) url = w;
  }
  if (!/^https:\/\//i.test(url)) return null;

  const params: CurlImport["params"] = [];
  if (body) {
    let obj: unknown = null;
    try {
      obj = JSON.parse(body);
    } catch {
      // formulário (a=1&b=2)
      if (/^[^=&\s]+=/.test(body)) obj = Object.fromEntries(new URLSearchParams(body));
    }
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const name = snake(k);
        if (name && !name.startsWith("boavoz_") && !params.some((p) => p.name === name)) params.push({ name, type: typeOf(v) });
      }
    }
  }
  return { url, headers, params: params.slice(0, 10), name: nameFromUrl(url) };
}

/** Um nome de ação a partir do endereço: as duas últimas partes do caminho, em snake_case. */
export function nameFromUrl(url: string): string {
  try {
    return snake(new URL(url).pathname.split("/").filter(Boolean).slice(-2).join("_"));
  } catch {
    return "";
  }
}
