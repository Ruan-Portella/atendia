import type { SupabaseClient } from "@supabase/supabase-js";
import { SYSTEM_AUTHOR } from "./chat";
import { igHash, instagramContact } from "./contacts";
import { openNullable, scopeOfBot, sealNullable } from "./field-cipher";
import { channelMsgHash } from "./hash";
import { markOwnMessage } from "./inbound-queue";
import { commentKeyword } from "./instagram-keywords";
import { InstagramError, commentsEnabled, isCommentsPermissionError, isInstagramAccessError, replyToComment, sendCommentPrivateReply, type IgChannel } from "./instagram";
import { saveMessage } from "./messages";

/*
 * Comentários dos posts (E1, parte 4a; spec Peça 9). O webhook "comments" entra na fila como os
 * outros eventos e cada comentário fica registrado (o texto cifrado, com a chave do cliente), com o
 * que o BoaVoz fez:
 *  - palavra-chave no comentário (instagram-keywords.ts): a resposta privada no direct (uma por
 *    comentário, até 7 dias; para quem não segue a conta, cai em Solicitações) e, se a loja quis,
 *    a resposta pública curta. Uma resposta privada por pessoa e post a cada 24 horas: quem comenta
 *    "eu quero" cinco vezes recebe uma;
 *  - sem palavra-chave, nada por enquanto (a IA nos comentários é a parte 4b).
 * A resposta privada entra na conversa do direct da pessoa (é o começo dela): quando ela responder,
 * a IA segue de lá. Comentário da própria conta (a resposta pública do BoaVoz, a equipe pelo app)
 * não é respondido. Tudo atrás de INSTAGRAM_COMMENTS=1 (a permissão pede revisão própria da Meta).
 */

/** O comentário como chega no webhook (campo "comments" da API com login do Instagram). */
export interface IgComment {
  id?: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
  parent_id?: string;
}

export type CommentAction = "privada" | "publica" | "privada_publica" | "nenhuma" | "ignorado" | "erro";

const PRIVATE_EVERY_HOURS = 24;
const COMMENT_MAX = 2200;
export const COMMENTS_KEPT_DAYS = 90;

/** O que deu errado ao responder, em português, para o painel. Pura. */
export function commentErrorText(e: unknown): string {
  if (isCommentsPermissionError(e)) return "A conta não deu a permissão dos comentários: conecte o Instagram de novo (aba Instagram).";
  const m = e instanceof InstagramError ? e.message : (e as Error)?.message;
  return `O Instagram recusou a resposta${m ? `: ${m.slice(0, 160)}` : ""}.`;
}

/** A ação registrada, pelo que saiu. Pura. */
export function commentAction(o: { privateSent: boolean; publicSent: boolean; failed: boolean }): CommentAction {
  if (o.privateSent && o.publicSent) return "privada_publica";
  if (o.privateSent) return "privada";
  if (o.publicSent) return "publica";
  return o.failed ? "erro" : "nenhuma";
}

/** A resposta privada na conversa do direct da pessoa (a da última 24 h, ou uma nova). */
async function recordPrivateReply(db: SupabaseClient, bot: { id: string; agency_id: string }, o: { igsid: string; text: string; messageId: string | null; comment: { id: string; text: string; mediaId: string | null } }) {
  const contact = await instagramContact(db, bot, o.igsid);
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data: recent } = contact ? await db.from("conversations").select("id").eq("bot_id", bot.id).eq("contact_id", contact.id).gt("last_message_at", since).order("last_message_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
  let convId = (recent?.id as string | undefined) ?? null;
  if (!convId) {
    const { data } = await db.from("conversations").insert({ bot_id: bot.id, channel: "instagram", ig_id: o.igsid, contact_id: contact?.id ?? null, visitor_id: null }).select("id").single();
    convId = (data?.id as string | undefined) ?? null;
  }
  if (!convId) return contact?.id ?? null;
  await saveMessage(
    db,
    { conversation_id: convId, role: "assistant", content: o.text, author: SYSTEM_AUTHOR, channel_msg_id: o.messageId, channel_msg_hash: o.messageId ? channelMsgHash("instagram", o.messageId) : null, channel_ref: { kind: "comment", id: o.comment.id, title: o.comment.text.slice(0, 300), media_id: o.comment.mediaId } },
    { touch: "equipe" },
  );
  return contact?.id ?? null;
}

/**
 * Um comentário que chegou: registra e, com palavra-chave, responde. Reentrega do webhook não
 * duplica (o comentário é único por chatbot). Erro de acesso (token recusado) sobe para quem
 * chamou marcar a conta; o resto fica registrado no comentário.
 */
export async function handleInstagramComment(db: SupabaseClient, ch: IgChannel & { bot_id: string }, c: IgComment): Promise<CommentAction | null> {
  if (!commentsEnabled() || !c.id || !c.from?.id) return null;
  // da própria conta: a resposta pública do BoaVoz ou alguém da loja pelo app
  if (c.from.id === ch.ig_user_id) return null;
  const { data: bot } = await db.from("bots").select("id, agency_id, status, paused_at").eq("id", ch.bot_id).maybeSingle();
  if (!bot || bot.status !== "live") return null;
  const scope = await scopeOfBot(bot.id as string);
  const text = (c.text ?? "").trim().slice(0, COMMENT_MAX);
  const mediaId = c.media?.id ?? null;
  const authorHash = igHash(c.from.id);
  const { data: row, error } = await db
    .from("instagram_comments")
    .insert({ bot_id: bot.id, comment_id: c.id, media_id: mediaId, parent_id: c.parent_id ?? null, author_hash: authorHash, username: c.from.username ?? null, text_enc: await sealNullable("instagram_comments.text_enc", text, scope), action: "nenhuma", created_at: new Date().toISOString() })
    .select("id")
    .single();
  // reentrega (ou duas entregas juntas): quem gravou primeiro responde
  if (error || !row) return null;
  const save = async (patch: Record<string, unknown>) => {
    await db.from("instagram_comments").update(patch).eq("id", row.id);
  };
  if (bot.paused_at) {
    await save({ action: "ignorado", reason: "chatbot pausado" });
    return "ignorado";
  }

  const kw = await commentKeyword(db, bot.id as string, text, mediaId);
  if (!kw) return "nenhuma";
  const reason = `palavra-chave “${kw.words[0]}”`;
  // uma resposta privada por pessoa e post a cada 24 horas
  const since = new Date(Date.now() - PRIVATE_EVERY_HOURS * 3_600_000).toISOString();
  const { data: already } = kw.comment_reply
    ? await db.from("instagram_comments").select("id").eq("bot_id", bot.id).eq("author_hash", authorHash).eq("media_id", mediaId ?? "").in("action", ["privada", "privada_publica"]).gte("created_at", since).limit(1)
    : { data: [] };
  let privateSent = false;
  let publicId: string | null = null;
  let problem: string | null = null;
  if (kw.comment_reply && !already?.length) {
    try {
      const sent = await sendCommentPrivateReply(ch, c.id, kw.comment_reply);
      privateSent = true;
      // o eco da nossa mensagem chega depois: já entra como tratado
      if (sent.messageId) await markOwnMessage(db, `ig:echo:${sent.messageId}`, "instagram");
      const contactId = sent.recipientId ? await recordPrivateReply(db, { id: bot.id as string, agency_id: bot.agency_id as string }, { igsid: sent.recipientId, text: kw.comment_reply, messageId: sent.messageId, comment: { id: c.id, text, mediaId } }).catch((e) => (console.error("instagram: resposta privada na conversa", (e as Error).message), null)) : null;
      if (contactId) await save({ contact_id: contactId });
    } catch (e) {
      if (isInstagramAccessError(e)) throw e;
      problem = commentErrorText(e);
    }
  }
  if (kw.comment_public) {
    try {
      publicId = await replyToComment(ch, c.id, kw.comment_public);
    } catch (e) {
      if (isInstagramAccessError(e)) throw e;
      problem ??= commentErrorText(e);
    }
  }
  const action = commentAction({ privateSent, publicSent: Boolean(publicId), failed: Boolean(problem) });
  await save({
    action,
    reason: already?.length ? `${reason} (a pessoa já recebeu a resposta privada deste post nas últimas 24 horas)` : reason,
    private_reply_enc: privateSent ? await sealNullable("instagram_comments.private_reply_enc", kw.comment_reply, scope) : null,
    public_reply_enc: publicId ? await sealNullable("instagram_comments.public_reply_enc", kw.comment_public, scope) : null,
    public_reply_id: publicId,
    error: problem,
    replied_at: privateSent || publicId ? new Date().toISOString() : null,
  });
  return action;
}

/** Um comentário na lista do painel. */
export interface CommentItem {
  id: string;
  mediaId: string | null;
  username: string | null;
  text: string | null;
  action: CommentAction;
  reason: string | null;
  privateReply: string | null;
  publicReply: string | null;
  error: string | null;
  createdAt: string;
}

/** Os comentários mais recentes do chatbot, abertos para o painel. */
export async function listComments(db: SupabaseClient, botId: string, limit = 30): Promise<CommentItem[]> {
  const { data } = await db.from("instagram_comments").select("id, media_id, username, text_enc, action, reason, private_reply_enc, public_reply_enc, error, created_at").eq("bot_id", botId).order("created_at", { ascending: false }).limit(limit);
  return Promise.all(
    (data ?? []).map(async (r) => ({
      id: r.id as string,
      mediaId: (r.media_id as string | null) ?? null,
      username: (r.username as string | null) ?? null,
      text: await openNullable("instagram_comments.text_enc", r.text_enc),
      action: r.action as CommentAction,
      reason: (r.reason as string | null) ?? null,
      privateReply: await openNullable("instagram_comments.private_reply_enc", r.private_reply_enc),
      publicReply: await openNullable("instagram_comments.public_reply_enc", r.public_reply_enc),
      error: (r.error as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
  );
}

/** A limpeza diária: os comentários saem depois de 90 dias. */
export async function purgeOldComments(db: SupabaseClient): Promise<void> {
  await db.from("instagram_comments").delete().lt("created_at", new Date(Date.now() - COMMENTS_KEPT_DAYS * 86_400_000).toISOString());
}
