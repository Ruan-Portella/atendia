import { CATEGORIES, DICTIONARY, EXCEPTIONS, effectiveLevel, type GateCategory, type GateChannel, type GateLevel } from "./rules";
import { normalizeGateText } from "./payment";

/*
 * Etapa 1 do portão: dicionário, em toda mensagem, custo quase zero. Acusa candidatos; quem decide
 * se o negócio está OFERECENDO o item (entrada: "o contato pede?"; saída: "o negócio oferece?")
 * é a etapa 2, com IA, que só roda quando o dicionário acusa.
 */

/** Sem acento, minúsculas, pontuação vira espaço, espaços simples, com espaço nas pontas (payment.ts, leve para o navegador). */
export { normalizeGateText };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Termo como palavra(s) inteira(s), com plural simples (s, es). */
const termPattern = (term: string) => new RegExp(` ${escape(term)}(?:s|es)? `);

const COMPILED = (Object.keys(DICTIONARY) as GateCategory[]).map((category) => ({
  category,
  terms: DICTIONARY[category].map((term) => ({ term, re: termPattern(term) })),
  exceptions: (EXCEPTIONS[category] ?? []).map((e) => new RegExp(` ${escape(e)} `, "g")),
}));

export interface GateHit {
  category: GateCategory;
  level: GateLevel;
  term: string;
}

/**
 * Termos do dicionário presentes no texto, já sem as exceções da categoria ("frango na cerveja"
 * não acusa bebida). `extraTerms`: nomes classificados naquele bot (ex.: remédios da base).
 */
export function dictionaryHits(text: string, opts: { channel?: GateChannel; contactPhone?: string | null; extraTerms?: Array<{ category: GateCategory; term: string }> } = {}): GateHit[] {
  const channel = opts.channel ?? "whatsapp";
  const base = normalizeGateText(text);
  const hits: GateHit[] = [];
  const seen = new Set<string>();
  const add = (category: GateCategory, term: string) => {
    const key = `${category}:${term}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ category, level: effectiveLevel(category, channel, opts.contactPhone), term });
  };
  for (const c of COMPILED) {
    // as exceções valem só para a própria categoria: "frango na cerveja" não esconde "vodka"
    let t = base;
    for (const e of c.exceptions) t = t.replace(e, " ");
    for (const { term, re } of c.terms) if (re.test(t)) add(c.category, term);
  }
  for (const x of opts.extraTerms ?? []) if (termPattern(normalizeGateText(x.term).trim()).test(base)) add(x.category, x.term);
  return hits.filter((h) => h.level !== "permitido");
}

/** Resumo por nível: o que a etapa 2 (IA) precisa conferir. */
export function hitSummary(hits: GateHit[]) {
  return {
    proibidos: [...new Set(hits.filter((h) => h.level === "proibido").map((h) => h.category))],
    regulamentados: [...new Set(hits.filter((h) => h.level === "regulamentado").map((h) => h.category))],
  };
}

/** Rótulo para textos fixos e logs ("bebida alcoólica"). */
export const categoryLabel = (c: GateCategory) => CATEGORIES[c].label;
