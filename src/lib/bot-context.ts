/*
 * Contexto fixo do chatbot e fontes por contexto (D', parte 1, 19/10/2026; spec, Peça 4 e "Fonte de
 * conhecimento por contexto").
 *
 * - Contexto fixo (origem "bot"): a loja de uma plataforma, o workspace de um SaaS. Definido pela
 *   agência (painel, aba Ações) ou pela API; vai em toda chamada de ação do chatbot.
 * - Contexto ativo da conversa: o do token, do pareamento ou do roteiro, com o fixo por cima (a loja
 *   do chatbot não muda pelo token). Escolhe as fontes com etiqueta e vai para as ações; a IA nunca
 *   vê o contexto.
 * - Etiqueta de uma fonte: pares chave e valor; a fonte vale quando o contexto ativo tem todos eles
 *   com o mesmo valor e o mesmo tipo (a mesma regra do banco: `contexto @> etiqueta`).
 *
 * Funções puras.
 */

export type ContextValue = string | number | boolean;
export type FlatContext = Record<string, ContextValue>;

/** Contexto fixo: até 10 chaves e 2 KB (o banco confere o tamanho de novo). */
export const FIXED_CONTEXT_MAX_KEYS = 10;
/** Etiqueta de uma fonte: até 5 chaves e 1 KB. */
export const SOURCE_TAG_MAX_KEYS = 5;
const KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const VALUE_MAX = 200;

/**
 * Objeto plano com chaves de letras, números, "_", "." e "-" (até 64) e valores texto (até 200),
 * número ou booleano. Vazio ou null: null (sem contexto).
 */
export function parseFlatContext(raw: unknown, o: { maxKeys: number; maxBytes: number; what: string }): { value: FlatContext | null } | { error: string } {
  if (raw === null || raw === undefined || raw === "") return { value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: `O ${o.what} deve ser um objeto JSON, como {"loja_id": "42"}.` };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.length) return { value: null };
  if (entries.length > o.maxKeys) return { error: `O ${o.what} vai até ${o.maxKeys} chaves.` };
  const out: FlatContext = {};
  for (const [k, v] of entries) {
    if (!KEY.test(k)) return { error: `Chave inválida no ${o.what}: "${k.slice(0, 40)}". Use letras, números, _, . e - (até 64).` };
    if (typeof v === "string") {
      if (!v.trim() || v.length > VALUE_MAX) return { error: `O valor de "${k}" no ${o.what} precisa ter de 1 a ${VALUE_MAX} caracteres.` };
      out[k] = v;
    } else if (typeof v === "number") {
      if (!Number.isFinite(v)) return { error: `O valor de "${k}" no ${o.what} não é um número válido.` };
      out[k] = v;
    } else if (typeof v === "boolean") out[k] = v;
    else return { error: `O valor de "${k}" no ${o.what} deve ser texto, número ou verdadeiro/falso (sem objetos nem listas).` };
  }
  if (new TextEncoder().encode(JSON.stringify(out)).length > o.maxBytes) return { error: `O ${o.what} passou de ${o.maxBytes} bytes.` };
  return { value: out };
}

export const parseFixedContext = (raw: unknown) => parseFlatContext(raw, { maxKeys: FIXED_CONTEXT_MAX_KEYS, maxBytes: 2048, what: "contexto fixo" });
export const parseSourceTag = (raw: unknown) => parseFlatContext(raw, { maxKeys: SOURCE_TAG_MAX_KEYS, maxBytes: 1024, what: "contexto da fonte" });

/** O que veio do banco (jsonb) como objeto, ou null. */
export function asContext(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length ? (v as Record<string, unknown>) : null;
}

/** O contexto ativo da conversa: o da identidade, com o fixo do chatbot por cima; sem nenhum, null. */
export function activeContext(bot: { fixed_context?: unknown }, identity?: { context: Record<string, unknown> | null } | null): Record<string, unknown> | null {
  const fixed = asContext(bot.fixed_context);
  const own = asContext(identity?.context);
  if (!fixed && !own) return null;
  return { ...(own ?? {}), ...(fixed ?? {}) };
}

/** A fonte com esta etiqueta vale no contexto? Sem etiqueta, sempre (a regra do banco). */
export function tagMatches(tag: unknown, context: Record<string, unknown> | null): boolean {
  const t = asContext(tag);
  if (!t) return true;
  if (!context) return false;
  return Object.entries(t).every(([k, v]) => Object.prototype.hasOwnProperty.call(context, k) && context[k] === v);
}

/** "workspace_id: ws_abc · role: admin" */
export function contextLabel(c: unknown): string {
  const o = asContext(c);
  return o ? Object.entries(o).map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : "";
}

/** O contexto como o painel mostra no campo (JSON identado). */
export const contextInput = (c: unknown) => {
  const o = asContext(c);
  return o ? JSON.stringify(o, null, 2) : "";
};
