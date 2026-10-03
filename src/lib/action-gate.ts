import type { SupabaseClient } from "@supabase/supabase-js";
import { dictionaryHits } from "./gate/match";
import type { AgeStatus } from "./gate/age";
import type { GateCategory, GateChannel } from "./gate/rules";

/*
 * Portão no retorno das ações (spec "Peça 1", portão das ações e ids). O data que a IA recebe
 * passa pelo portão do canal, como a base: no WhatsApp e no Instagram, objeto com item proibido
 * sai; com item regulamentado (ou marcado regulated: true pelo dev), sai para quem não confirmou
 * 18+. No widget não há trava do BoaVoz. Os objetos que saíram (e o objeto que os contém, o
 * pedido ou carrinho) entram no mapa de ids da conversa por 24 horas: {identificador → categoria,
 * rótulo}, usado pelo portão de parâmetros das ações de pedido (C pública).
 */

export interface IdMapEntry {
  categoria: GateCategory;
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
export function idMapCategories(row: IdMapRow, now = Date.now()): GateCategory[] {
  return [...new Set(activeIdMap(row, now).map((e) => e.categoria))];
}

/** Links dos pedidos que perderam itens nesta conversa (onde ver o que não sai no chat). Função pura. */
export function idMapLinks(row: IdMapRow, now = Date.now()): string[] {
  return [...new Set(activeIdMap(row, now).flatMap((e) => (e.link ? [e.link] : [])))];
}

type IdMapRow = { gate_id_map_enc?: unknown; gate_id_map_expires_at?: unknown } | null | undefined;

function activeIdMap(row: IdMapRow, now: number): IdMapEntry[] {
  if (typeof row?.gate_id_map_enc !== "string" || typeof row.gate_id_map_expires_at !== "string" || Date.parse(row.gate_id_map_expires_at) <= now) return [];
  try {
    return Object.values(JSON.parse(row.gate_id_map_enc) as IdMap);
  } catch {
    return [];
  }
}

/** Grava o mapa de ids da conversa por 24 horas (junta com o que ainda vale). */
export async function saveIdMap(db: SupabaseClient, conversationId: string, ids: IdMap): Promise<void> {
  if (!Object.keys(ids).length) return;
  const { data } = await db.from("conversations").select("gate_id_map_enc, gate_id_map_expires_at").eq("id", conversationId).maybeSingle();
  const current: IdMap = data?.gate_id_map_enc && data.gate_id_map_expires_at && Date.parse(data.gate_id_map_expires_at as string) > Date.now() ? (JSON.parse(data.gate_id_map_enc as string) as IdMap) : {};
  const merged = { ...current, ...ids };
  // sem cifra até a leva S (como as outras colunas _enc)
  const { error } = await db
    .from("conversations")
    .update({ gate_id_map_enc: JSON.stringify(merged), gate_id_map_expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString() })
    .eq("id", conversationId);
  if (error) console.error("mapa de ids: não gravado", error.message);
}
