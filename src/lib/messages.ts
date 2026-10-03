import type { SupabaseClient } from "@supabase/supabase-js";
import { openField, sealField } from "./field-cipher";

/*
 * Camada única de mensagens (L1; spec "Cifra por campo"): toda leitura e gravação da tabela
 * messages passa por aqui (saveMessage, loadMessages…), para a cifra do conteúdo da leva S
 * entrar num lugar só. Um teste confere que nenhum outro arquivo usa a tabela direto.
 */

export type MessageRole = "user" | "assistant" | "agent";

export interface MessageRow {
  id: number;
  conversation_id: string;
  role: MessageRole;
  content: string;
  author: string | null;
  sources: unknown;
  tool_results: unknown;
  template_category: string | null;
  channel_msg_id: string | null;
  blocked_reason: string | null;
  failed_at: string | null;
  error_code: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  channel_ref: unknown;
  inbound_key: string | null;
  created_at: string;
}
export type MessageColumn = keyof MessageRow;

/** Mensagem nova. Com inbound_key (o evento do canal), é gravada uma vez só. */
export interface NewMessage {
  conversation_id: string;
  role: MessageRole;
  content: string;
  author?: string | null;
  sources?: unknown;
  tool_results?: unknown;
  template_category?: string | null;
  channel_msg_id?: string | null;
  channel_msg_hash?: string | null;
  blocked_reason?: string | null;
  failed_at?: string | null;
  error_code?: string | null;
  channel_ref?: unknown;
  inbound_key?: string | null;
}

/** O que muda numa mensagem já gravada (envio, edição, lápide, referência do post). */
export interface MessagePatch {
  content?: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  channel_ref?: unknown;
  blocked_reason?: string | null;
  failed_at?: string | null;
  error_code?: string | null;
  channel_msg_id?: string | null;
  channel_msg_hash?: string | null;
}

const sealed = <T extends { content?: string }>(row: T): T => (row.content === undefined ? row : { ...row, content: sealField("messages.content", row.content) });
const opened = <T extends object>(row: T): T => {
  const content = (row as { content?: unknown }).content;
  return typeof content === "string" ? { ...row, content: openField("messages.content", content) } : row;
};

/* ------------------------------------------------------------------ gravação */

/**
 * Grava uma mensagem e devolve o id; null quando a chave do evento (inbound_key) já estava
 * gravada (reprocesso). Erro do banco sobe. touch: atualiza a conversa (última mensagem e
 * contador); "visitante" também marca o contato como presente (widget).
 */
export async function saveMessage(db: SupabaseClient, m: NewMessage, opts: { touch?: "visitante" | "equipe" } = {}): Promise<number | null> {
  const row = sealed(m);
  const query = m.inbound_key ? db.from("messages").upsert(row, { onConflict: "inbound_key", ignoreDuplicates: true }) : db.from("messages").insert(row);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`mensagem não gravada: ${error.message}`);
  const id = (data?.[0]?.id as number | undefined) ?? null;
  if (id !== null && opts.touch) await touchConversation(db, m.conversation_id, { visitorSeen: opts.touch === "visitante" });
  return id;
}

/** Quais mensagens mudar: por id, por ids ou pela chave do evento do canal. */
export type MessageTarget = { id: number } | { ids: Array<number | string> } | { inboundKey: string };

/**
 * Muda mensagens já gravadas (o conteúdo novo é cifrado aqui). notDeleted: só as que não foram
 * desfeitas; withoutRef: só as que ainda não têm a referência do post. Devolve os ids mudados.
 */
export async function updateMessages(db: SupabaseClient, target: MessageTarget, patch: MessagePatch, only: { notDeleted?: boolean; withoutRef?: boolean } = {}): Promise<number[]> {
  let q = db.from("messages").update(sealed(patch));
  if ("id" in target) q = q.eq("id", target.id);
  else if ("ids" in target) q = q.in("id", target.ids);
  else q = q.eq("inbound_key", target.inboundKey);
  if (only.notDeleted) q = q.is("deleted_at", null);
  if (only.withoutRef) q = q.is("channel_ref", null);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`mensagem não atualizada: ${error.message}`);
  return (data ?? []).map((r) => r.id as number);
}

/** Apaga uma mensagem gravada (ex.: a resposta trocada pela pergunta de idade). */
export async function deleteMessage(db: SupabaseClient, id: number): Promise<void> {
  const { error } = await db.from("messages").delete().eq("id", id);
  if (error) throw new Error(`mensagem não apagada: ${error.message}`);
}

/** Total de mensagens da conversa. */
export async function countMessages(db: SupabaseClient, conversationId: string): Promise<number> {
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
  return count ?? 0;
}

/** Depois de gravar: hora da última mensagem e contador da conversa (e outros campos, se vierem). */
export async function touchConversation(db: SupabaseClient, conversationId: string, o: { visitorSeen?: boolean; extra?: Record<string, unknown> } = {}): Promise<void> {
  const count = await countMessages(db, conversationId);
  const now = new Date().toISOString();
  await db
    .from("conversations")
    .update({ last_message_at: now, ...(o.visitorSeen ? { visitor_seen_at: now } : {}), message_count: count, ...o.extra })
    .eq("id", conversationId);
}

/* ------------------------------------------------------------------ leitura */

export interface MessageQuery {
  conversationId?: string;
  conversationIds?: string[];
  inboundKey?: string;
  roles?: MessageRole[];
  notRole?: MessageRole;
  authors?: string[];
  /** Fora as deste autor (autor vazio conta como outro). */
  notAuthor?: string;
  afterId?: number;
  createdAfter?: string;
  /** Só o que chegou ao contato e continua valendo: fora o barrado, o não entregue e o desfeito. */
  delivered?: boolean;
  /** Só modelos do WhatsApp (com categoria). */
  templates?: boolean;
  /** Da mais nova para a mais antiga (padrão: na ordem da conversa). */
  newestFirst?: boolean;
  limit?: number;
}

/** Lê mensagens (o conteúdo é decifrado aqui). Com o cliente da sessão, a RLS continua valendo. */
export async function loadMessages<K extends MessageColumn>(db: SupabaseClient, q: MessageQuery, columns: readonly K[]): Promise<Array<Pick<MessageRow, K>>> {
  let r = db.from("messages").select(columns.join(", "));
  if (q.conversationId) r = r.eq("conversation_id", q.conversationId);
  if (q.conversationIds) r = r.in("conversation_id", q.conversationIds);
  if (q.inboundKey) r = r.eq("inbound_key", q.inboundKey);
  if (q.roles) r = q.roles.length === 1 ? r.eq("role", q.roles[0]) : r.in("role", q.roles);
  if (q.notRole) r = r.neq("role", q.notRole);
  if (q.authors) r = r.in("author", q.authors);
  if (q.notAuthor) r = r.or(`author.is.null,author.neq.${q.notAuthor}`);
  if (q.afterId !== undefined) r = r.gt("id", q.afterId);
  if (q.createdAfter) r = r.gt("created_at", q.createdAfter);
  if (q.delivered) r = r.is("blocked_reason", null).is("failed_at", null).is("deleted_at", null);
  if (q.templates) r = r.not("template_category", "is", null);
  r = r.order("id", { ascending: !q.newestFirst });
  if (q.limit) r = r.limit(q.limit);
  const { data, error } = await r;
  if (error) throw new Error(`mensagens não lidas: ${error.message}`);
  return ((data ?? []) as unknown as Array<Pick<MessageRow, K>>).map(opened);
}

/** A primeira mensagem que atende à busca (na ordem pedida), ou null. */
export async function findMessage<K extends MessageColumn>(db: SupabaseClient, q: MessageQuery, columns: readonly K[]): Promise<Pick<MessageRow, K> | null> {
  return (await loadMessages(db, { ...q, limit: 1 }, columns))[0] ?? null;
}
