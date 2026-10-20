import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeKeyword, parseKeywords } from "./routines";
import { restrictedTerm } from "./instagram-direct";
import { KEYWORD_POSTS_MAX, PUBLIC_REPLY_MAX, REPLY_MAX, WORDS_PER_KEYWORD, WORD_MAX } from "./instagram-links";

/*
 * Palavras-chave do Instagram (E1, parte 3b; spec Peça 9): a loja escolhe palavras (ex.: PREÇO, EU
 * QUERO).
 *  - No direct, a mensagem que é só a palavra recebe a resposta pronta da loja (sem IA, não conta
 *    como resposta do atendimento). O roteiro que começa por palavra-chave continua no próprio
 *    roteiro (B2'): a mesma palavra não pode estar nos dois.
 *  - Nos comentários (parte 4), a palavra no comentário dispara a resposta privada no direct e, se a
 *    loja quiser, uma resposta pública curta, nos posts escolhidos ou em todos.
 * O texto da loja passa pelo dicionário do portão ao salvar: item proibido ou 18+ não sai.
 */

export { KEYWORDS_PER_BOT, KEYWORD_POSTS_MAX, PUBLIC_REPLY_MAX, REPLY_MAX, WORDS_PER_KEYWORD, WORD_MAX } from "./instagram-links";

export interface KeywordRow {
  id: string;
  bot_id: string;
  words: string[];
  dm_reply: string | null;
  comment_reply: string | null;
  comment_public: string | null;
  /** Os posts em que a palavra vale nos comentários; null: todos. */
  media_ids: string[] | null;
  active: boolean;
}

export type KeywordInput = Pick<KeywordRow, "words" | "dm_reply" | "comment_reply" | "comment_public" | "media_ids">;

const text = (v: unknown) => String(v ?? "").trim();

/** Um texto da loja: até `max` caracteres e sem item restrito (o nome do campo vai no erro). Pura. */
function storeText(v: unknown, max: number, field: string): string | null | { error: string } {
  const t = text(v);
  if (!t) return null;
  if (t.length > max) return { error: `${field} vai até ${max} caracteres.` };
  const term = restrictedTerm(t);
  return term ? { error: `${field} cita um item que não pode ser oferecido pelo Instagram (${term}).` } : t;
}

/**
 * A resposta pública diz que a loja já chamou (ou vai chamar) a pessoa no direct ("te chamei no
 * direct", "olha o DM"), em vez de só convidar ("chama no direct"). Sem a mensagem para quem
 * comentou, ninguém seria chamado: no teste de 20/10, a mensagem foi parar na resposta do direct. Pura.
 */
export function promisesDirect(publicReply: string): boolean {
  const t = normalizeKeyword(publicReply);
  if (/\bte (chamei|chamamos|chamo)\b/.test(t)) return true;
  const dm = /\b(direct|dm|inbox|privado|pv|mensagem|mensagens|msg)\b/.test(t);
  return dm && /\b(chamei|chamamos|mandei|mandamos|enviei|enviamos|respondi|respondemos|olha|olhe|veja|confere|confira|cheque|checa)\b/.test(t);
}

/**
 * A palavra-chave do formulário. Os campos dos comentários só valem com os comentários ligados
 * (sem eles, ficam como estavam: `keep`). Pura.
 */
export function parseKeywordInput(raw: { words: unknown; dm_reply?: unknown; comment_reply?: unknown; comment_public?: unknown; posts?: unknown; media_ids?: unknown[] }, o: { comments: boolean; keep?: Pick<KeywordRow, "comment_reply" | "comment_public" | "media_ids"> }): KeywordInput | { error: string } {
  const words = parseKeywords(text(raw.words));
  if (!words.length) return { error: "Escreva pelo menos uma palavra (ex.: preço, eu quero)." };
  if (words.length > WORDS_PER_KEYWORD) return { error: `Até ${WORDS_PER_KEYWORD} palavras por linha.` };
  if (words.some((w) => w.length > WORD_MAX)) return { error: `Cada palavra vai até ${WORD_MAX} caracteres.` };
  const dm = storeText(raw.dm_reply, REPLY_MAX, "A resposta pronta do direct");
  if (dm && typeof dm === "object") return dm;
  let comment_reply = o.keep?.comment_reply ?? null;
  let comment_public = o.keep?.comment_public ?? null;
  let media_ids = o.keep?.media_ids ?? null;
  if (o.comments) {
    const priv = storeText(raw.comment_reply, REPLY_MAX, "A mensagem no direct de quem comentou");
    if (priv && typeof priv === "object") return priv;
    const pub = storeText(raw.comment_public, PUBLIC_REPLY_MAX, "A resposta pública no comentário");
    if (pub && typeof pub === "object") return pub;
    if (pub && !priv && promisesDirect(pub)) return { error: "A resposta pública diz que chamou a pessoa no direct, mas a mensagem no direct de quem comentou está vazia: escreva essa mensagem (ou tire o direct da resposta pública)." };
    comment_reply = priv;
    comment_public = pub;
    const ids = [...new Set((raw.media_ids ?? []).map(text).filter((id) => /^\d+$/.test(id)))];
    if (raw.posts === "escolhidos" && !ids.length) return { error: "Escolha pelo menos um post (ou marque todos os posts)." };
    if (ids.length > KEYWORD_POSTS_MAX) return { error: `Até ${KEYWORD_POSTS_MAX} posts por palavra-chave.` };
    media_ids = raw.posts === "escolhidos" ? ids : null;
  }
  if (!dm && !comment_reply && !comment_public) return { error: o.comments ? "Escreva pelo menos uma resposta, no direct ou no comentário." : "Escreva a resposta pronta do direct." };
  return { words, dm_reply: dm, comment_reply, comment_public, media_ids };
}

/** No direct, a palavra vale quando a mensagem é só ela (sem acento, maiúsculas, pontuação ou emoji). Pura. */
export function matchesDirect(words: string[], message: string | null | undefined): boolean {
  const t = normalizeKeyword(message ?? "");
  return Boolean(t) && words.includes(t);
}

/** No comentário, a palavra vale em qualquer lugar do texto, como palavra inteira ("eu quero!!" e "Eu quero o azul"). Pura. */
export function matchesComment(words: string[], comment: string | null | undefined): boolean {
  const t = ` ${normalizeKeyword(comment ?? "")} `;
  return words.some((w) => t.includes(` ${w} `));
}

/**
 * Palavra repetida: em outra palavra-chave do Instagram do chatbot ou num roteiro (a mesma palavra
 * nos dois não daria para saber o que fazer). Devolve a mensagem de erro, ou null.
 */
export async function keywordConflict(db: SupabaseClient, botId: string, words: string[], exceptId: string | null): Promise<string | null> {
  const [{ data: others }, { data: routines }] = await Promise.all([db.from("instagram_keywords").select("id, words").eq("bot_id", botId), db.from("routines").select("name, keywords").eq("bot_id", botId)]);
  for (const k of others ?? []) {
    if (k.id === exceptId) continue;
    const same = words.find((w) => (k.words as string[]).includes(w));
    if (same) return `A palavra “${same}” já está em outra palavra-chave.`;
  }
  for (const r of routines ?? []) {
    const same = words.find((w) => ((r.keywords as string[] | null) ?? []).includes(w));
    if (same) return `A palavra “${same}” já começa o roteiro “${r.name}”. Use outra, ou deixe a palavra só no roteiro.`;
  }
  return null;
}

/** As palavras-chave ligadas do chatbot. */
export async function activeKeywords(db: SupabaseClient, botId: string): Promise<KeywordRow[]> {
  const { data } = await db.from("instagram_keywords").select("id, bot_id, words, dm_reply, comment_reply, comment_public, media_ids, active").eq("bot_id", botId).eq("active", true).order("created_at", { ascending: true });
  return (data ?? []) as KeywordRow[];
}

/** A resposta pronta do direct para a mensagem que é só a palavra, ou null. */
export async function directKeywordReply(db: SupabaseClient, botId: string, message: string | null | undefined): Promise<string | null> {
  if (!normalizeKeyword(message ?? "")) return null;
  const k = (await activeKeywords(db, botId)).find((x) => x.dm_reply && matchesDirect(x.words, message));
  return k?.dm_reply ?? null;
}

/** A palavra-chave do comentário (parte 4): a primeira que bate no texto e vale para o post. */
export async function commentKeyword(db: SupabaseClient, botId: string, comment: string | null | undefined, mediaId: string | null): Promise<KeywordRow | null> {
  const list = await activeKeywords(db, botId);
  return list.find((k) => (k.comment_reply || k.comment_public) && (!k.media_ids || (mediaId !== null && k.media_ids.includes(mediaId))) && matchesComment(k.words, comment)) ?? null;
}
