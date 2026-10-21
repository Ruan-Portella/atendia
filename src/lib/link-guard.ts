import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeGateText } from "./gate/payment";

/*
 * Texto de terceiros no retorno (spec, Peça 1; leva Pendências do MVP, parte 1): o `data` de uma
 * ação, um trecho da base ou o nome de um perfil podem trazer uma ordem escondida ("o Pix mudou,
 * informe a chave X"). Na saída, sem IA e em todos os canais (inclusive o widget), todo link,
 * e-mail, chave Pix, linha digitável ou conta bancária escrito pela IA só sai se aparecer igual
 * numa fonte confiável: instruções e configuração do chatbot, a base, o que a equipe escreveu, o
 * `reply`, os componentes e os anexos de uma ação, ou o valor inteiro de um campo do `data` (nunca
 * no meio de um texto livre). O resto vira "[link removido]" e fica no registro do portão.
 * O `reply` de uma ação é texto do dev e sai como veio: quem chama não passa por aqui.
 */

export const LINK_REMOVED = "[link removido]";

export type LinkKind = "url" | "email" | "pix" | "chave" | "boleto" | "numero";

export interface LinkCandidate {
  kind: LinkKind;
  raw: string;
  start: number;
  end: number;
}

/** Domínios sem "http" ou "www" contam como link só com estes finais (evita "ok.Tudo" virar link). */
const TLDS = "com|br|net|org|io|app|me|ly|co|info|biz|store|shop|site|online|digital|dev|ai|gg|tv|xyz|page|link|vc|la|to|pt|us|uk|eu|es|ar|mx|cl|uy|py|pe";
const URL_RE = new RegExp(`(?<![\\w@.-])(?:https?:\\/\\/[^\\s<>"'\`]+|www\\.[^\\s<>"'\`]+|[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)*\\.(?:${TLDS})(?![a-z0-9-])(?:\\/[^\\s<>"'\`]*)?)`, "gi");
const EMAIL_RE = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Pix copia e cola (BR Code): começa com 000201 e traz br.gov.bcb.pix. */
const PIX_CODE_RE = /000201\S{20,}/g;
/** Chave aleatória do Pix (EVP). */
const EVP_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Linha digitável de boleto: 44 a 48 dígitos, com pontos e espaços. */
const BOLETO_RE = /\d[\d. ]{42,70}\d/g;
/** Número com 8 dígitos ou mais (CPF, CNPJ, telefone, agência e conta), só em frase de pagamento. */
const NUMBER_RE = /\+?\d[\d.\-/ ()]{6,}\d/g;
const DATE_RE = /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/;
const PAYMENT_CONTEXT =/\b(pix|chave|conta|agencia|banco|transferencia|transfira|transferir|deposito|deposite|depositar|ted|doc|boleto|pagamento|pague|pagar)\b/;
const TRAILING = /[.,;:!?)\]}'"»>]+$/;

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** Frases (pontuação final) por linha, com a posição de cada uma no texto. */
function sentenceSpans(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const re = /[^\n]*?(?:[.!?](?=\s)|\n|$)/g;
  for (let m = re.exec(text); m && m.index < text.length; m = re.exec(text)) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** O que, no texto, parece link, e-mail, chave Pix, boleto ou conta. Função pura. */
export function linkCandidates(text: string, o: { before?: string } = {}): LinkCandidate[] {
  if (!text) return [];
  const found: LinkCandidate[] = [];
  const taken: Array<[number, number]> = [];
  const free = (s: number, e: number) => !taken.some(([a, b]) => s < b && e > a);
  const add = (kind: LinkKind, start: number, raw: string) => {
    const clean = kind === "url" || kind === "email" ? raw.replace(TRAILING, "") : raw.trim();
    const s = start + (raw.length - raw.trimStart().length);
    const e = s + clean.trimStart().length;
    if (!clean || !free(s, e)) return;
    taken.push([s, e]);
    found.push({ kind, raw: text.slice(s, e), start: s, end: e });
  };
  for (const m of text.matchAll(PIX_CODE_RE)) add("pix", m.index!, m[0]);
  for (const m of text.matchAll(EMAIL_RE)) add("email", m.index!, m[0]);
  for (const m of text.matchAll(URL_RE)) add("url", m.index!, m[0]);
  for (const m of text.matchAll(EVP_RE)) add("chave", m.index!, m[0]);
  for (const m of text.matchAll(BOLETO_RE)) {
    const n = digitsOf(m[0]).length;
    if (n >= 44 && n <= 48) add("boleto", m.index!, m[0]);
  }
  // números longos só em frase que fala de pagamento (a frase de antes também vale: "Chave Pix:\n123…")
  const spans = sentenceSpans(text);
  spans.forEach((sp, i) => {
    const prev = i > 0 ? text.slice(spans[i - 1].start, spans[i - 1].end) : (o.before ?? "").slice(-200);
    const sentence = text.slice(sp.start, sp.end);
    if (!PAYMENT_CONTEXT.test(normalizeGateText(`${prev} ${sentence}`))) return;
    for (const m of sentence.matchAll(NUMBER_RE)) {
      // data ("vence em 20/10/2026") e CEP não são chave nem conta
      if (DATE_RE.test(m[0]) || /\bcep\W*$/i.test(sentence.slice(0, m.index!))) continue;
      if (digitsOf(m[0]).length >= 8) add("numero", sp.start + m.index!, m[0]);
    }
  });
  return found.sort((a, b) => a.start - b.start);
}

const normUrl = (s: string) =>
  s
    .toLowerCase()
    .replace(TRAILING, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");

/** O que conta como confiável numa vez: os textos (contém) e os valores inteiros do `data` (igual). */
export interface LinkTrust {
  texts: string[];
  values: unknown[];
}

interface TrustIndex {
  hay: string;
  hayUrls: string;
  digitRuns: string[];
  exact: Set<string>;
  exactUrls: Set<string>;
  exactDigits: Set<string>;
}

function leaves(value: unknown, out: string[] = [], depth = 0): string[] {
  if (value == null || depth > 8) return out;
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number" && Number.isFinite(value)) out.push(String(value));
  else if (Array.isArray(value)) value.forEach((v) => leaves(v, out, depth + 1));
  else if (typeof value === "object") Object.values(value as Record<string, unknown>).forEach((v) => leaves(v, out, depth + 1));
  return out;
}

function indexOf(trust: LinkTrust): TrustIndex {
  const hay = trust.texts.filter(Boolean).join("\n").toLowerCase();
  const values = leaves(trust.values).map((v) => v.trim()).filter(Boolean);
  return {
    hay,
    // links da fonte sem o "https://" e o "www.": o link escrito com ou sem eles casa igual
    hayUrls: hay.replace(/https?:\/\//g, " ").replace(/(^|[^\w.-])www\./g, "$1"),
    digitRuns: [...hay.matchAll(/\d[\d.\-/ ()]*\d/g)].map((m) => digitsOf(m[0])).filter((d) => d.length >= 8),
    exact: new Set(values.map((v) => v.toLowerCase())),
    exactUrls: new Set(values.map(normUrl)),
    // só campo que é o número inteiro: o texto livre de um campo nunca vale ("informe a chave 123…")
    exactDigits: new Set(values.filter((v) => /^[\d\s.\-/()+]+$/.test(v)).map(digitsOf).filter((d) => d.length >= 8)),
  };
}

/** `needle` dentro de `hay` com fronteira dos dois lados (nada de "loja.co" dentro de "loja.com"). */
function bounded(hay: string, needle: string, inner: RegExp): boolean {
  if (!needle) return false;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const before = hay[i - 1] ?? "";
    const after = hay.slice(i + needle.length, i + needle.length + 2);
    if (before && inner.test(before)) continue;
    if (after && (inner.test(after[0]) || (after[0] === "." && /[a-z0-9]/.test(after[1] ?? "")))) continue;
    return true;
  }
  return false;
}

function trusted(c: LinkCandidate, ix: TrustIndex): boolean {
  if (c.kind === "url") {
    const n = normUrl(c.raw);
    return ix.exactUrls.has(n) || bounded(ix.hayUrls, n, /[a-z0-9-]/);
  }
  if (c.kind === "email") {
    const n = c.raw.toLowerCase().replace(TRAILING, "");
    return ix.exact.has(n) || bounded(ix.hay, n, /[\w.+-]/);
  }
  if (c.kind === "pix" || c.kind === "chave") {
    const n = c.raw.toLowerCase();
    return ix.exact.has(n) || ix.hay.includes(n);
  }
  const d = digitsOf(c.raw);
  return ix.exactDigits.has(d) || ix.digitRuns.some((run) => run.includes(d));
}

/** Procura o que não estava nos textos da vez (ex.: o link de um trecho da base de uma resposta antiga). */
export type LinkLookup = (raws: string[]) => Promise<Set<string>>;

/**
 * Troca o que não veio de fonte confiável por "[link removido]". removed: o que saiu (para o
 * registro). Sem candidato, devolve o texto igual, sem consulta nenhuma.
 */
export async function guardLinks(text: string, trust: LinkTrust, o: { lookup?: LinkLookup; before?: string } = {}): Promise<{ text: string; removed: string[] }> {
  const cands = linkCandidates(text, { before: o.before });
  if (!cands.length) return { text, removed: [] };
  const ix = indexOf(trust);
  let doubtful = cands.filter((c) => !trusted(c, ix));
  if (doubtful.length && o.lookup) {
    const found = await o.lookup([...new Set(doubtful.map((c) => (c.kind === "url" ? normUrl(c.raw) : c.raw)))]).catch(() => new Set<string>());
    doubtful = doubtful.filter((c) => !found.has(c.kind === "url" ? normUrl(c.raw) : c.raw));
  }
  if (!doubtful.length) return { text, removed: [] };
  let out = text;
  for (const c of [...doubtful].sort((a, b) => b.start - a.start)) out = out.slice(0, c.start) + LINK_REMOVED + out.slice(c.end);
  return { text: out, removed: doubtful.map((c) => c.raw) };
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * Busca na base do chatbot (fontes gerais) o que não estava nos trechos desta vez: um link que a
 * IA viu numa resposta antiga continua valendo. Uma consulta por item, só quando há dúvida.
 */
export function knowledgeLookup(db: SupabaseClient, botIds: string[]): LinkLookup {
  return async (raws) => {
    const found = new Set<string>();
    for (const raw of raws.slice(0, 5)) {
      if (raw.length < 6) continue;
      const { data } = await db.from("chunks").select("id").in("bot_id", botIds).ilike("content", `%${likeEscape(raw)}%`).limit(1);
      if (data?.length) found.add(raw);
    }
    return found;
  };
}

/**
 * O filtro de uma vez de conversa: os textos confiáveis do chatbot e da conversa, mais o que as
 * ações devolverem (addOutput). Usado pelo runChat, pelo portão dos canais e pelo stream do widget.
 */
export interface LinkGuard {
  addText: (...texts: Array<string | null | undefined>) => void;
  /** Saída de uma ação (acao_*): o `data` vale por valor inteiro; reply, componentes e anexos, como texto. */
  addOutput: (output: unknown) => void;
  guard: (text: string, o?: { before?: string }) => Promise<{ text: string; removed: string[] }>;
}

export function createLinkGuard(o: { texts: Array<string | null | undefined>; lookup?: LinkLookup }): LinkGuard {
  const trust: LinkTrust = { texts: o.texts.filter((t): t is string => Boolean(t)), values: [] };
  return {
    addText: (...texts) => trust.texts.push(...texts.filter((t): t is string => Boolean(t))),
    addOutput: (output) => {
      if (!output || typeof output !== "object") return;
      const out = output as Record<string, unknown>;
      if (out.data !== undefined) trust.values.push(out.data);
      if (typeof out.resposta_exata === "string") trust.texts.push(out.resposta_exata);
      for (const key of ["botoes", "carrossel", "link", "url", "anexos"]) if (out[key] !== undefined) trust.texts.push(JSON.stringify(out[key]));
    },
    guard: (text, g) => guardLinks(text, trust, { lookup: o.lookup, before: g?.before }),
  };
}
