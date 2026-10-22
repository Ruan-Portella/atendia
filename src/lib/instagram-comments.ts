import type { SupabaseClient } from "@supabase/supabase-js";
import { SYSTEM_AUTHOR } from "./chat";
import { igHash, instagramContact } from "./contacts";
import { openNullable, scopeOfBot, sealNullable } from "./field-cipher";
import { channelMsgHash } from "./hash";
import { markOwnMessage } from "./inbound-queue";
import { commentKeyword } from "./instagram-keywords";
import { InstagramError, commentsEnabled, instagramMediaById, isCommentsPermissionError, isInstagramAccessError, replyToComment, sendCommentPrivateReply, type IgChannel } from "./instagram";
import { saveMessage } from "./messages";
import { aiBlockedReason, type BotRow } from "./chat";
import { ANSWERED_KINDS, COMMENT_KIND_LABEL, classifyComment, commentAiOn, writeCommentReply, type CommentPost } from "./comment-ai";
import { storeMedia } from "./instagram-context";
import { restrictedTerm } from "./instagram-direct";
import { botHasAi } from "./plans";
import { openAtendimento } from "./atendimentos";
import { recordAiUsage, type UsageTokens } from "./ai-usage";
import { withContactId } from "./ai-contact";

/*
 * Comentários dos posts (E1, parte 4a; spec Peça 9). O webhook "comments" entra na fila como os
 * outros eventos e cada comentário fica registrado (o texto cifrado, com a chave do cliente), com o
 * que o BoaVoz fez:
 *  - palavra-chave no comentário (instagram-keywords.ts): a resposta privada no direct (uma por
 *    comentário, até 7 dias; para quem não segue a conta, cai em Solicitações) e, se a loja quis,
 *    a resposta pública curta. Uma resposta privada por pessoa e post a cada 24 horas: quem comenta
 *    "eu quero" cinco vezes recebe uma;
 *  - sem palavra-chave, nos posts em que a loja ligou a IA (parte 4b, comment-ai.ts): a IA
 *    classifica e responde (ofensa e spam ficam sem resposta).
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
    { conversation_id: convId, role: "assistant", content: o.text, author: SYSTEM_AUTHOR, channel_msg_id: o.messageId, channel_msg_hash: o.messageId ? channelMsgHash("instagram", o.messageId) : null, channel_msg_ref: o.messageId, channel_ref: { kind: "comment", id: o.comment.id, title: o.comment.text.slice(0, 300), media_id: o.comment.mediaId } },
    { touch: "equipe" },
  );
  return contact?.id ?? null;
}

/**
 * Um comentário que chegou: registra e, com palavra-chave, responde. Reentrega do webhook não
 * duplica (o comentário é único por chatbot). Erro de acesso (token recusado) sobe para quem
 * chamou marcar a conta; o resto fica registrado no comentário.
 */
/** Um comentário, com o identificador de quem comentou nas chamadas de IA (ai-contact.ts). */
export async function handleInstagramComment(db: SupabaseClient, ch: IgChannel & { bot_id: string }, c: IgComment): Promise<CommentAction | null> {
  return withContactId(ch.bot_id, c.from?.id ?? null, () => instagramComment(db, ch, c));
}

async function instagramComment(db: SupabaseClient, ch: IgChannel & { bot_id: string }, c: IgComment): Promise<CommentAction | null> {
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

  const x: CommentCtx = { bot: { id: bot.id as string, agency_id: bot.agency_id as string }, c: { ...c, id: c.id }, text, mediaId, authorHash, scope, save };
  const kw = await commentKeyword(db, x.bot.id, text, mediaId);
  if (kw) return sendReplies(db, ch, x, { privateText: kw.comment_reply, publicText: kw.comment_public, reason: `palavra-chave “${kw.words[0]}”` });
  // IA nos comentários (parte 4b): nos posts que a loja ligou
  const { data: full } = await db.from("bots").select("*").eq("id", x.bot.id).maybeSingle<BotRow>();
  if (!full || !commentAiOn(full, mediaId)) return "nenhuma";
  return answerWithAi(db, ch, x, full);
}

/** O comentário em tratamento: o chatbot, o texto, o post, quem comentou e como gravar. */
interface CommentCtx {
  bot: { id: string; agency_id: string };
  c: IgComment & { id: string };
  text: string;
  mediaId: string | null;
  authorHash: string;
  scope: Awaited<ReturnType<typeof scopeOfBot>>;
  save: (patch: Record<string, unknown>) => Promise<void>;
}

/**
 * As respostas (da palavra-chave ou da IA): a privada no direct, uma por pessoa e post a cada 24
 * horas, e a pública. Registra o que saiu, o motivo e o erro.
 */
async function sendReplies(db: SupabaseClient, ch: IgChannel, x: CommentCtx, o: { privateText: string | null; publicText: string | null; reason: string }): Promise<CommentAction> {
  const since = new Date(Date.now() - PRIVATE_EVERY_HOURS * 3_600_000).toISOString();
  const { data: already } = o.privateText
    ? await db.from("instagram_comments").select("id").eq("bot_id", x.bot.id).eq("author_hash", x.authorHash).eq("media_id", x.mediaId ?? "").in("action", ["privada", "privada_publica"]).gte("created_at", since).limit(1)
    : { data: [] };
  let privateSent = false;
  let publicId: string | null = null;
  let problem: string | null = null;
  if (o.privateText && !already?.length) {
    try {
      const sent = await sendCommentPrivateReply(ch, x.c.id, o.privateText);
      privateSent = true;
      // o eco da nossa mensagem chega depois: já entra como tratado
      if (sent.messageId) await markOwnMessage(db, `ig:echo:${sent.messageId}`, "instagram");
      const contactId = sent.recipientId ? await recordPrivateReply(db, x.bot, { igsid: sent.recipientId, text: o.privateText, messageId: sent.messageId, comment: { id: x.c.id, text: x.text, mediaId: x.mediaId } }).catch((e) => (console.error("instagram: resposta privada na conversa", (e as Error).message), null)) : null;
      if (contactId) await x.save({ contact_id: contactId });
    } catch (e) {
      if (isInstagramAccessError(e)) throw e;
      problem = commentErrorText(e);
    }
  }
  if (o.publicText) {
    try {
      publicId = await replyToComment(ch, x.c.id, o.publicText);
    } catch (e) {
      if (isInstagramAccessError(e)) throw e;
      problem ??= commentErrorText(e);
    }
  }
  const action = commentAction({ privateSent, publicSent: Boolean(publicId), failed: Boolean(problem) });
  await x.save({
    action,
    reason: already?.length ? `${o.reason} (a pessoa já recebeu a resposta privada deste post nas últimas 24 horas)` : o.reason,
    private_reply_enc: privateSent ? await sealNullable("instagram_comments.private_reply_enc", o.privateText, x.scope) : null,
    public_reply_enc: publicId ? await sealNullable("instagram_comments.public_reply_enc", o.publicText, x.scope) : null,
    public_reply_id: publicId,
    error: problem,
    replied_at: privateSent || publicId ? new Date().toISOString() : null,
  });
  return action;
}

/** O post do comentário para a IA: o da fonte do Instagram, o guardado na hora ou a legenda pela API. */
async function commentPost(db: SupabaseClient, ch: IgChannel, botId: string, mediaId: string): Promise<CommentPost | null> {
  const known = await storeMedia(db, botId, mediaId);
  if (known) return { caption: known.caption, postedAt: known.postedAt, photos: known.photos, permalink: known.permalink };
  const m = await instagramMediaById(ch, mediaId);
  return m ? { caption: m.caption ?? null, postedAt: m.timestamp ? new Date(m.timestamp).toISOString() : null, photos: [], permalink: m.permalink ?? null } : null;
}

/**
 * A IA no comentário sem palavra-chave (parte 4b): sem IA no chatbot, com a IA pausada ou com item
 * restrito no comentário, nem chama o modelo. Classifica (sem custo para a cota); ofensa, spam e
 * fora do assunto ficam sem resposta; o resto abre (ou segue) o atendimento de quem comentou e
 * recebe a resposta, conferida pelo portão.
 */
async function answerWithAi(db: SupabaseClient, ch: IgChannel, x: CommentCtx, bot: BotRow): Promise<CommentAction> {
  const skip = async (action: CommentAction, reason: string): Promise<CommentAction> => {
    await x.save({ action, reason });
    return action;
  };
  if (!botHasAi(bot)) return skip("ignorado", "IA: o chatbot não tem IA (Atendimento ou sem tamanho)");
  const blocked = await aiBlockedReason(db, bot.agency_id);
  if (blocked) return skip("ignorado", blocked === "past_due" ? "IA pausada: o pagamento da assinatura está em aberto" : "IA pausada pela equipe BoaVoz");
  if (!x.text) return skip("nenhuma", "IA: comentário sem texto");
  const term = restrictedTerm(x.text);
  if (term) return skip("ignorado", `IA: o comentário cita um item que não pode ser oferecido pelo Instagram (${term}); a equipe vê aqui`);
  const usage = (kind: "classificacao" | "resposta") => (u: UsageTokens) => void recordAiUsage(db, { agencyId: bot.agency_id, botId: bot.id, kind, channel: "instagram", ...u });
  const post = x.mediaId ? await commentPost(db, ch, bot.id, x.mediaId) : null;
  const kind = await classifyComment(x.text, { companyName: bot.client_name, caption: post?.caption, onUsage: usage("classificacao") });
  if (!kind) return skip("erro", "IA: não deu para ler o comentário agora");
  if (!ANSWERED_KINDS.has(kind)) return skip("nenhuma", `IA: ${COMMENT_KIND_LABEL[kind]} (sem resposta)`);
  // a cota: cada resposta da IA no comentário conta como uma resposta do atendimento de quem comentou
  const quota = await openAtendimento(db, bot, { channel: "instagram", contactKey: `comentario:${x.authorHash}`, conversationId: null });
  if (quota.blocked) return skip("ignorado", "IA: o chatbot está sem atendimentos neste mês (cota ou crédito do excedente)");
  const reply = await writeCommentReply(db, bot, { kind, comment: x.text, post, onUsage: usage("resposta") });
  if (!reply || (!reply.publica && !reply.privada)) return skip("erro", "IA: a resposta não passou na conferência do portão e não foi enviada");
  return sendReplies(db, ch, x, { privateText: reply.privada, publicText: reply.publica, reason: `IA: ${COMMENT_KIND_LABEL[kind]}` });
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
