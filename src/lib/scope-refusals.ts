import type { SupabaseClient } from "@supabase/supabase-js";
import { openNullable, scopeOfBot, sealNullable } from "./field-cipher";

/*
 * Pedidos fora do assunto (trava de escopo), separados das perguntas sem resposta: só este
 * arquivo usa a tabela (um teste confere). Leva S: o pedido vem do contato e vai cifrado com a
 * chave do cliente; o antigo, sem cifra, passa igual até a recifra do histórico.
 */

export interface ScopeRefusal {
  id: number;
  bot_id: string;
  conversation_id: string | null;
  level: string;
  request: string | null;
  created_at: string;
}

/** Registra a recusa; devolve o id (para desfazer se a resposta acabar sendo lacuna da base). */
export async function recordRefusal(db: SupabaseClient, r: { botId: string; conversationId: string; level: string; request: string | null | undefined }): Promise<number | null> {
  const request = await sealNullable("scope_refusals.request", r.request?.slice(0, 300), await scopeOfBot(r.botId));
  const { data, error } = await db.from("scope_refusals").insert({ bot_id: r.botId, conversation_id: r.conversationId, level: r.level, request }).select("id").single();
  if (error) {
    console.error("recusa não registrada", error.message);
    return null;
  }
  return data.id as number;
}

export async function deleteRefusals(db: SupabaseClient, ids: number[]): Promise<void> {
  if (ids.length) await db.from("scope_refusals").delete().in("id", ids);
}

/** Recusas desde a data (de um chatbot, ou de todos para o backoffice), mais novas primeiro. */
export async function listRefusals(db: SupabaseClient, opts: { botId?: string; since: string; limit: number }): Promise<ScopeRefusal[]> {
  let q = db.from("scope_refusals").select("id, bot_id, conversation_id, level, request, created_at").gte("created_at", opts.since);
  if (opts.botId) q = q.eq("bot_id", opts.botId);
  const { data } = await q.order("created_at", { ascending: false }).limit(opts.limit);
  return Promise.all(
    ((data ?? []) as Array<Record<string, unknown>>).map(async (r) => ({
      id: r.id as number,
      bot_id: r.bot_id as string,
      conversation_id: (r.conversation_id as string | null) ?? null,
      level: r.level as string,
      request: await openNullable("scope_refusals.request", r.request),
      created_at: r.created_at as string,
    })),
  );
}
