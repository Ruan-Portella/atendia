import type { SupabaseClient } from "@supabase/supabase-js";
import { dictionaryHits } from "./gate/match";
import { openField, sealField, scopeOfConversation } from "./field-cipher";
import type { AgeStatus } from "./gate/age";
import type { GateCategory, GateChannel } from "./gate/rules";

/*
 * Portão no retorno das ações (spec "Peça 1", portão das ações e ids). O data que a IA recebe
 * passa pelo portão do canal, como a base: no WhatsApp e no Instagram, objeto com item proibido
 * sai; com item regulamentado (ou marcado regulated: true pelo dev), sai para quem não confirmou
 * 18+. No widget não há trava do BoaVoz. Os objetos que saíram (e o objeto que os contém, o
 * pedido ou carrinho) entram no mapa de ids da conversa por 24 horas: {identificador → categoria,
 * rótulo}, usado pelo portão de parâmetros das ações de pedido (C pública). O mapa guarda também o
 * rótulo dos outros objetos com id (sem categoria), em todos os canais: é com ele que o resumo do
 * Confirmar mostra "2x Pizza Calabresa" no lugar de ["456", "456"].
 */

export interface IdMapEntry {
  /** null: objeto liberado, só o rótulo (para o resumo do Confirmar). */
  categoria: GateCategory | null;
  rotulo: string | null;
  /** Link do objeto que perdeu itens (o pedido completo, fora do chat). */
  link?: string | null;
}
export type IdMap = Record<string, IdMapEntry>;

export interface GatedData {
  data: unknown;
  /** Categorias tiradas do data (para o aviso à IA). */
  hidden: GateCategory[];
  /** Identificadores dos objetos tirados (e dos que os contêm). */
  ids: IdMap;
  /** Links (http/https) dos objetos que perderam itens: onde ver o pedido ou a lista completa. */
  links: string[];
  /** Categorias 18+ que ficaram nos dados (idade confirmada): a IA pode citá-las. */
  shown: GateCategory[];
}

/** Campos de link de um objeto: url, link, *_url, *_link. */
const LINK_FIELD = /^(url|link|.+_url|.+_link)$/i;
const linksOf = (o: Record<string, unknown>) =>
  Object.entries(o)
    .filter(([k, v]) => LINK_FIELD.test(k) && typeof v === "string" && /^https?:\/\//i.test(v))
    .map(([, v]) => v as string);

/** Campos que identificam um objeto: id, *_id, sku, codigo, ref e slug. */
const ID_FIELD = /^(id|.+_id|sku|codigo|ref|slug)$/i;
/** Campos de texto curto que dizem o que o objeto é (nome, título, descrição). */
const LABEL_FIELDS = ["name", "nome", "title", "titulo", "label", "rotulo", "description", "descricao", "categoria", "category"];

const idsOf = (o: Record<string, unknown>) =>
  Object.entries(o)
    .filter(([k, v]) => ID_FIELD.test(k) && (typeof v === "string" || typeof v === "number"))
    .map(([, v]) => String(v));
const labelOf = (o: Record<string, unknown>) => {
  for (const k of ["name", "nome", "title", "titulo", "label"]) if (typeof o[k] === "string") return (o[k] as string).slice(0, 80);
  return null;
};

/** Categorias do próprio objeto (só os campos de texto curto dele, não os filhos). */
function ownCategories(o: Record<string, unknown>, opts: { channel: Exclude<GateChannel, "widget">; contactPhone?: string | null; exempt?: readonly GateCategory[] }) {
  const text = LABEL_FIELDS.map((k) => (typeof o[k] === "string" ? (o[k] as string) : "")).filter(Boolean).join(". ");
  return text ? dictionaryHits(text, { channel: opts.channel, contactPhone: opts.contactPhone, exempt: opts.exempt }) : [];
}

/**
 * Filtra o data de uma ação para esta pessoa. Função pura. Widget: sem trava (devolve igual).
 * O que é tirado: objeto (em lista) com item proibido; com regulamentado (ou regulated: true),
 * se a idade não foi confirmada.
 */
export function gateActionData(data: unknown, o: { channel: GateChannel; contactPhone?: string | null; age: AgeStatus; exempt?: readonly GateCategory[] }): GatedData {
  if (o.channel === "widget") return { data, hidden: [], ids: {}, links: [], shown: [] };
  const channel = o.channel;
  const hidden = new Set<GateCategory>();
  const ids: IdMap = {};
  const links = new Set<string>();
  const shown = new Set<GateCategory>();
  const record = (obj: Record<string, unknown>, categoria: GateCategory, link: string | null = null) => {
    for (const id of idsOf(obj)) ids[id] = { categoria, rotulo: labelOf(obj), ...(link ? { link } : {}) };
  };

  /** Devolve o valor filtrado; blocked: o próprio objeto foi barrado; removed: algo dentro dele saiu. */
  const visit = (v: unknown): { value: unknown; blocked?: GateCategory; removed?: GateCategory } => {
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      let removed: GateCategory | undefined;
      for (const item of v) {
        const r = visit(item);
        if (r.blocked) {
          if (item && typeof item === "object" && !Array.isArray(item)) record(item as Record<string, unknown>, r.blocked);
          hidden.add(r.blocked);
          removed ??= r.blocked;
        } else {
          out.push(r.value);
          removed ??= r.removed;
        }
      }
      return { value: out, removed };
    }
    if (!v || typeof v !== "object") return { value: v };
    const obj = v as Record<string, unknown>;
    const hits = ownCategories(obj, { channel, contactPhone: o.contactPhone, exempt: o.exempt });
    const prohibited = hits.find((h) => h.level === "proibido");
    if (prohibited) return { value: null, blocked: prohibited.category };
    const regulated = hits.find((h) => h.level === "regulamentado")?.category ?? (obj.regulated === true ? ("bebida" as GateCategory) : undefined);
    // ver não é vender: com o "Sim", bebida e remédio aparecem também num pedido (o pagamento
    // nunca sai no chat, e a compra desses itens pelo chat é barrada)
    if (regulated && o.age !== "sim") return { value: null, blocked: regulated };
    if (regulated) shown.add(regulated);
    const out: Record<string, unknown> = {};
    let removed: GateCategory | undefined;
    for (const [k, child] of Object.entries(obj)) {
      const r = visit(child);
      if (r.blocked) {
        hidden.add(r.blocked);
        removed ??= r.blocked;
        continue;
      }
      removed ??= r.removed;
      out[k] = r.value;
    }
    // algo dentro saiu: o objeto que o contém (pedido, carrinho) também entra no mapa, e o link
    // dele (se houver) é onde a pessoa vê o que ficou de fora
    if (removed) {
      const own = linksOf(obj);
      record(obj, removed, own[0] ?? null);
      own.forEach((l) => links.add(l));
    }
    return { value: out, removed };
  };

  const r = visit(data);
  return { data: r.blocked ? null : r.value, hidden: [...hidden], ids, links: [...links], shown: [...shown] };
}

/**
 * Categorias do mapa de ids que ainda vale: o que saiu dos dados das ações nesta conversa. A
 * entrada do portão usa como "a empresa tem o item" ("e a cerveja?" depois de um pedido com
 * cerveja vira a pergunta de 18+). Função pura.
 */
export function idMapCategories(entries: IdMapEntry[]): GateCategory[] {
  return [...new Set(entries.flatMap((e) => (e.categoria ? [e.categoria] : [])))];
}

/** Teto do mapa: os barrados ficam sempre; dos só-rótulo, os mais novos. */
export const ID_MAP_MAX = 400;

/**
 * Rótulos dos objetos com id no data que a IA recebeu (já filtrado): {id → nome}, sem categoria.
 * Função pura.
 */
export function idLabels(data: unknown): IdMap {
  const out: IdMap = {};
  const visit = (v: unknown, depth: number) => {
    if (depth > 8 || Object.keys(out).length >= ID_MAP_MAX) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const label = labelOf(o);
    if (label) for (const id of idsOf(o)) out[id] = { categoria: null, rotulo: label };
    for (const child of Object.values(o)) visit(child, depth + 1);
  };
  visit(data, 0);
  return out;
}

/** Junta o mapa guardado com o novo (o novo vence), no teto. Função pura. */
export function mergeIdMap(current: IdMap, next: IdMap): IdMap {
  const merged: IdMap = { ...current };
  for (const [k, v] of Object.entries(next)) {
    // um id barrado continua barrado, mesmo que outra consulta traga só o rótulo
    if (v.categoria === null && merged[k]?.categoria) continue;
    delete merged[k];
    merged[k] = v;
  }
  const keys = Object.keys(merged);
  if (keys.length <= ID_MAP_MAX) return merged;
  const plain = keys.filter((k) => !merged[k].categoria);
  for (const k of plain.slice(0, keys.length - ID_MAP_MAX)) delete merged[k];
  return merged;
}

/** Valores dos parâmetros de uma chamada (listas abertas), como texto. Função pura. */
export function paramValues(params: Record<string, unknown>): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const [name, v] of Object.entries(params)) {
    for (const x of Array.isArray(v) ? v : [v]) if (typeof x === "string" || typeof x === "number") out.push({ name, value: String(x) });
  }
  return out;
}

export interface ParamsGateFacts {
  /** Parâmetros que batem com um objeto barrado do mapa. */
  mapHits: IdMapEntry[];
  /** Categorias do dicionário nos valores, nos rótulos resolvidos e na prévia. */
  dictionary: GateCategory[];
  /** Algum texto dos parâmetros que o mapa não resolveu. */
  unresolved: boolean;
}

/**
 * Portão de parâmetros (spec "Peça 1"): o que a chamada leva, olhado pelo mapa de ids e pelo
 * dicionário (nos valores, nos rótulos que o mapa resolveu e no resumo da prévia). Função pura.
 */
export function paramsGateFacts(params: Record<string, unknown>, map: IdMap, o: { channel: Exclude<GateChannel, "widget">; contactPhone?: string | null; exempt?: readonly GateCategory[]; preview?: string[] }): ParamsGateFacts {
  const values = paramValues(params);
  const mapHits: IdMapEntry[] = [];
  const texts: string[] = [...(o.preview ?? [])];
  let unresolved = false;
  for (const { value } of values) {
    const hit = map[value];
    if (hit?.categoria && !o.exempt?.includes(hit.categoria)) mapHits.push(hit);
    if (hit?.rotulo) texts.push(hit.rotulo);
    else if (!hit && /[a-zà-ú]/i.test(value)) unresolved = true;
    texts.push(value);
  }
  const hits = texts.length ? dictionaryHits(texts.join(". "), { channel: o.channel, contactPhone: o.contactPhone, exempt: o.exempt }) : [];
  return { mapHits, dictionary: [...new Set(hits.filter((h) => h.level === "proibido" || h.level === "regulamentado").map((h) => h.category))], unresolved };
}

/**
 * O que fazer com a chamada (pura): pedido, reserva ou cobrança com item barrado do mapa ou do
 * dicionário é barrado direto (o rótulo só aperta); dicionário numa outra "executa", ou pedido com
 * parâmetro que o mapa não resolveu, vai para a etapa de IA.
 */
export function paramsGateDecision(f: ParamsGateFacts, createsOrder: boolean): "liberar" | "barrar" | "perguntar_ia" {
  if (createsOrder && (f.mapHits.length || f.dictionary.length)) return "barrar";
  if (f.dictionary.length || (createsOrder && f.unresolved)) return "perguntar_ia";
  return "liberar";
}

/** Links dos pedidos que perderam itens nesta conversa (onde ver o que não sai no chat). Função pura. */
export function idMapLinks(entries: IdMapEntry[]): string[] {
  return [...new Set(entries.flatMap((e) => (e.link ? [e.link] : [])))];
}

type IdMapRow = { gate_id_map_enc?: unknown; gate_id_map_expires_at?: unknown } | null | undefined;

/** O mapa de ids que ainda vale (aberto: vai cifrado com a chave do cliente). */
export async function openIdMap(row: IdMapRow, now = Date.now()): Promise<IdMapEntry[]> {
  return Object.values(await openIdMapObject(row, now));
}

/** O mapa da conversa como objeto {id → entrada} (resumo do Confirmar e portão de parâmetros). */
export async function conversationIdMap(db: SupabaseClient, conversationId: string): Promise<IdMap> {
  const { data } = await db.from("conversations").select("gate_id_map_enc, gate_id_map_expires_at").eq("id", conversationId).maybeSingle();
  return openIdMapObject(data, Date.now());
}

async function openIdMapObject(row: IdMapRow, now = Date.now()): Promise<IdMap> {
  if (typeof row?.gate_id_map_enc !== "string" || typeof row.gate_id_map_expires_at !== "string" || Date.parse(row.gate_id_map_expires_at) <= now) return {};
  try {
    return JSON.parse(await openField("conversations.gate_id_map_enc", row.gate_id_map_enc)) as IdMap;
  } catch {
    return {};
  }
}

/** Grava o mapa de ids da conversa por 24 horas (junta com o que ainda vale), cifrado com a chave do cliente. */
export async function saveIdMap(db: SupabaseClient, conversationId: string, ids: IdMap): Promise<void> {
  if (!Object.keys(ids).length) return;
  const { data } = await db.from("conversations").select("gate_id_map_enc, gate_id_map_expires_at").eq("id", conversationId).maybeSingle();
  const merged = mergeIdMap(await openIdMapObject(data, Date.now()), ids);
  const sealed = await sealField("conversations.gate_id_map_enc", JSON.stringify(merged), await scopeOfConversation(conversationId));
  const { error } = await db
    .from("conversations")
    .update({ gate_id_map_enc: sealed, gate_id_map_expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString() })
    .eq("id", conversationId);
  if (error) console.error("mapa de ids: não gravado", error.message);
}
