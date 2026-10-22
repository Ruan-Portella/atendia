import type { SupabaseClient } from "@supabase/supabase-js";
import { channelMsgHash } from "./hash";
import { sha256 } from "./inbound-queue";
import { findMessage, loadMessages, updateMessages } from "./messages";

/*
 * Citar e reagir no WhatsApp e no Instagram (Conversa mais natural, parte 1; os pontos de 13/10).
 *   - o contato respondeu em cima de uma mensagem (WhatsApp context.id, Instagram reply_to.mid):
 *     a mensagem dele fica ligada à citada (reply_to_id); o painel mostra o trecho e a IA recebe o
 *     texto citado;
 *   - o contato reagiu (WhatsApp type reaction, Instagram message_reactions): o emoji fica na
 *     mensagem reagida; sem emoji, tirou. A IA não responde a reações;
 *   - o id original de cada mensagem do canal fica cifrado (channel_msg_ref_enc): é o que a Meta
 *     pede para a equipe citar ou reagir (parte 2).
 * A mensagem do canal é achada pelo hash de sempre: a que a empresa mandou pelo id do envio
 * (channel_msg_hash) e a do contato pela chave do evento (inbound_key).
 */

export type MetaChannel = "whatsapp" | "instagram";

/** A chave do evento de uma mensagem do contato (o mesmo hash que a fila usa). Pura. */
export const inboundKeyOf = (channel: MetaChannel, id: string) => sha256(`${channel === "whatsapp" ? "wa" : "ig"}:msg:${id}`);

/** A mensagem do canal: a que a empresa mandou ou a do contato. */
export async function findByChannelId(db: SupabaseClient, channel: MetaChannel, id: string): Promise<{ id: number; conversation_id: string; role: string; content: string } | null> {
  const cols = ["id", "conversation_id", "role", "content"] as const;
  return (await findMessage(db, { channelMsgHash: channelMsgHash(channel, id), newestFirst: true }, cols)) ?? (await findMessage(db, { inboundKey: inboundKeyOf(channel, id) }, cols));
}

/**
 * Depois da rajada (as mensagens já gravadas): o id original de cada uma, cifrado, e a citada,
 * quando o contato respondeu em cima de uma mensagem desta conversa.
 */
export async function linkInbound(db: SupabaseClient, channel: MetaChannel, items: Array<{ key: string; channelId: string | null | undefined; quotedId?: string | null }>): Promise<number> {
  let linked = 0;
  for (const it of items) {
    if (!it.channelId) continue;
    const msg = await findMessage(db, { inboundKey: it.key }, ["id", "conversation_id", "reply_to_id", "channel_msg_ref_enc"] as const);
    if (!msg) continue;
    const patch: { channel_msg_ref?: string; reply_to_id?: number } = {};
    if (!msg.channel_msg_ref_enc) patch.channel_msg_ref = it.channelId;
    if (it.quotedId && !msg.reply_to_id) {
      const quoted = await findByChannelId(db, channel, it.quotedId);
      if (quoted && quoted.conversation_id === msg.conversation_id && quoted.id !== msg.id) patch.reply_to_id = quoted.id;
    }
    if (!Object.keys(patch).length) continue;
    await updateMessages(db, { id: msg.id }, patch);
    if (patch.reply_to_id) linked++;
  }
  return linked;
}

/** Os nomes das reações do Instagram como emoji (o webhook manda o nome e, às vezes, o emoji). Pura. */
const IG_REACTIONS: Record<string, string> = { love: "❤️", like: "👍", laugh: "😂", wow: "😮", sad: "😢", angry: "😠", smile: "😊" };
export function reactionEmoji(r: { emoji?: string | null; reaction?: string | null }): string | null {
  const e = r.emoji?.trim() || (r.reaction ? IG_REACTIONS[r.reaction] : null) || null;
  return e ? e.slice(0, 16) : null;
}

/** A reação do contato na mensagem (null tira). Devolve se achou a mensagem. */
export async function applyContactReaction(db: SupabaseClient, channel: MetaChannel, targetId: string, emoji: string | null, at = new Date()): Promise<boolean> {
  const target = await findByChannelId(db, channel, targetId);
  if (!target) return false;
  await updateMessages(db, { id: target.id }, { contact_reaction: emoji, contact_reaction_at: emoji ? at.toISOString() : null });
  return true;
}

/** O trecho citado: uma linha, até 160 letras. Pura. */
export function quoteSnippet(content: string, deleted = false): string {
  if (deleted) return "(mensagem apagada)";
  const one = content.replace(/\s+/g, " ").trim();
  return one.length > 160 ? `${one.slice(0, 159)}…` : one;
}

/** Como a IA lê a citação (no começo da mensagem do contato). Pura. */
export const quotedNote = (snippet: string) => `[O contato respondeu em cima desta mensagem: "${snippet}"]`;

/** Os trechos citados de várias mensagens (o painel, a área do cliente e o histórico da IA). */
export async function quotesOf(db: SupabaseClient, replyToIds: Array<number | null | undefined>): Promise<Map<number, { snippet: string; fromContact: boolean }>> {
  const ids = [...new Set(replyToIds.filter((x): x is number => typeof x === "number"))];
  const out = new Map<number, { snippet: string; fromContact: boolean }>();
  if (!ids.length) return out;
  const rows = await loadMessages(db, { ids }, ["id", "role", "content", "deleted_at"] as const);
  for (const r of rows) out.set(r.id, { snippet: quoteSnippet(String(r.content), Boolean(r.deleted_at)), fromContact: r.role === "user" });
  return out;
}
