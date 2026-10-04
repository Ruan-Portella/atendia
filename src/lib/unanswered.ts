import type { SupabaseClient } from "@supabase/supabase-js";
import { openField, scopeOfBot, sealField } from "./field-cipher";

/*
 * Perguntas sem resposta (lacuna na base, para a agência ou o cliente responder): só este arquivo
 * usa a tabela (um teste confere). Leva S: a pergunta vem do contato e vai cifrada com a chave do
 * cliente; a antiga, sem cifra, passa igual até a recifra do histórico.
 */

/** Frase que o prompt pede quando a resposta não está na base (ver buildSystemPrompt). */
export const NO_INFO_PHRASE = "Não tenho essa informação";

/** A resposta abre com a frase fixa de "não tenho" (pergunta do negócio que falta na base). */
export const isNoInfoAnswer = (text: string | null | undefined) => Boolean(text?.trim().startsWith(NO_INFO_PHRASE));

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "Vou confirmar com a equipe": a frase que o prompt pede quando falta um dado do negócio na base. */
export function isTeamCheckAnswer(text: string | null | undefined): boolean {
  const t = strip(text ?? "");
  return /\b(vou|vamos|posso|preciso|irei) (confirmar|verificar|checar|consultar)( isso| essa informacao| esse dado)? com a equipe|\bconfirmo com a equipe|\ba equipe (vai|pode|ira) (confirmar|verificar)/.test(t);
}

/**
 * Resposta de lacuna da base ("Não tenho essa informação…" ou "vou confirmar com a equipe"):
 * atende a pessoa, então nunca é recusa, mesmo que a IA tenha chamado registrar_recusa junto.
 */
export const isGapAnswer = (text: string | null | undefined) => isNoInfoAnswer(text) || isTeamCheckAnswer(text);

/**
 * A resposta do assistente admite que não sabe? Rede de segurança para quando o modelo
 * esquece de chamar a ferramenta registrar_pergunta_sem_resposta.
 */
export function looksUnanswered(reply: string): boolean {
  const t = strip(reply);
  return [
    /nao tenho (essa|esta|essas|estas|a|as) informac/,
    /nao tenho informac(ao|oes) (sobre|a respeito)/,
    /nao (encontrei|possuo|disponho de|tenho acesso a) (essa|esta|essas|estas|a|as|informac)/,
    /nao sei (informar|responder|dizer)/,
    /nao consigo (informar|responder|te dizer)/,
    /(essa|esta) informac(ao|oes) nao (esta|estao|consta|constam)/,
  ].some((r) => r.test(t));
}

/**
 * Registra a pergunta para a agência responder no painel, sem duplicar uma pendente igual.
 * Marca a conversa como "precisou de ajuda".
 */
export async function recordUnanswered(db: SupabaseClient, botId: string, conversationId: string, question: string): Promise<void> {
  const q = question.replace(/\s+/g, " ").trim().slice(0, 500);
  if (q.length < 3) return;
  const { data: pending } = await db.from("unanswered").select("id, question").eq("bot_id", botId).eq("resolved", false).order("created_at", { ascending: false }).limit(50);
  const same = (a: string) => strip(a).replace(/[?!.\s]+$/, "") === strip(q).replace(/[?!.\s]+$/, "");
  const opened = await Promise.all((pending ?? []).map((p) => openField("unanswered.question", String(p.question))));
  if (!opened.some(same)) await db.from("unanswered").insert({ bot_id: botId, conversation_id: conversationId, question: await sealField("unanswered.question", q, await scopeOfBot(botId)) });
  await db.from("conversations").update({ needs_human: true }).eq("id", conversationId);
}

export interface UnansweredQuestion {
  id: string;
  bot_id: string;
  question: string;
  created_at: string;
}

/** Perguntas pendentes destes chatbots (sem botIds: de todos, para o backoffice), mais novas primeiro. */
export async function listUnanswered(db: SupabaseClient, opts: { botIds?: string[]; limit: number }): Promise<UnansweredQuestion[]> {
  if (opts.botIds && !opts.botIds.length) return [];
  let q = db.from("unanswered").select("id, bot_id, question, created_at").eq("resolved", false);
  if (opts.botIds) q = q.in("bot_id", opts.botIds);
  const { data } = await q.order("created_at", { ascending: false }).limit(opts.limit);
  return Promise.all(
    ((data ?? []) as Array<Record<string, unknown>>).map(async (r) => ({
      id: r.id as string,
      bot_id: r.bot_id as string,
      question: await openField("unanswered.question", String(r.question)),
      created_at: r.created_at as string,
    })),
  );
}

/** Tira a pergunta da lista (respondida ou ignorada); botId limita ao chatbot. */
export async function markUnansweredResolved(db: SupabaseClient, id: string, author: string, botId?: string): Promise<boolean> {
  const q = db.from("unanswered").update({ resolved: true, resolved_by: author }).eq("id", id);
  const { error } = await (botId ? q.eq("bot_id", botId) : q);
  return !error;
}

/** Retenção: ids das perguntas do chatbot criadas antes do corte. */
export async function unansweredIdsBefore(db: SupabaseClient, botId: string, cutoff: string, limit = 200): Promise<string[]> {
  const { data } = await db.from("unanswered").select("id").eq("bot_id", botId).lt("created_at", cutoff).limit(limit);
  return (data ?? []).map((u) => u.id as string);
}

/** Pedido do titular: ids das perguntas feitas nestas conversas. */
export async function unansweredIdsOfConversations(db: SupabaseClient, conversationIds: string[]): Promise<string[]> {
  if (!conversationIds.length) return [];
  const { data } = await db.from("unanswered").select("id").in("conversation_id", conversationIds);
  return (data ?? []).map((u) => u.id as string);
}

export async function deleteUnanswered(db: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length) await db.from("unanswered").delete().in("id", ids);
}
