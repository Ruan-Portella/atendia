import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { findMessage } from "./messages";
import { queueHandoffReturned } from "./message-events";
import { isOptOutKeyword } from "./suppression";
import { audit } from "./audit";
import { REARM_PREFIX } from "./inbound-queue";

/*
 * Pausa da IA pela integração (C pública, parte 3a; spec Peça 3, "Pausar a IA"): estado próprio
 * na conversa (ai_paused_until, ai_paused_by = api), separado do atendimento humano. Não avisa a
 * equipe nem vira pedido de atendente; na regra de estados é o degrau "humano na conversa".
 *   - toda pausa tem prazo: sem minutes, 24 horas renovadas a cada mensagem enviada pela API
 *     naquela conversa; com minutes, de 1 a 10.080 (7 dias), renovável pedindo de novo;
 *   - volta para a IA pelo POST /resume, pela faixa do painel ("Devolver para a IA"), quando
 *     alguém da equipe assume, ou quando vence (o tique do minuto); downgrade sem Integrações e fim
 *     do teste encerram todas as pausas da conta de uma vez, com registro na auditoria;
 *   - quando volta (menos na troca de plano), a IA responde a última mensagem do contato se ela
 *     ficou sem resposta dentro da janela de 24 horas (WhatsApp e Instagram; no site, a próxima).
 */

export const API_PAUSE_DEFAULT_MINUTES = 24 * 60;
export const API_PAUSE_MAX_MINUTES = 7 * 24 * 60;

/** Prazo da pausa pedida: sem minutes, 24 h renováveis; senão inteiro de 1 a 10.080. Pura. */
export function pausePlan(minutes: unknown, now = Date.now()): { until: string; renews: boolean } | { error: string } {
  if (minutes === undefined || minutes === null) return { until: new Date(now + API_PAUSE_DEFAULT_MINUTES * 60_000).toISOString(), renews: true };
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > API_PAUSE_MAX_MINUTES) return { error: `minutes deve ser um número inteiro de 1 a ${API_PAUSE_MAX_MINUTES} (7 dias).` };
  return { until: new Date(now + minutes * 60_000).toISOString(), renews: false };
}

/** Campos que zeram a pausa (o anúncio pedido fica: decide o "Voltei!" da próxima resposta da IA). */
export const API_PAUSE_CLEAR = { ai_paused_until: null, ai_paused_by: null, ai_paused_at: null, ai_pause_key_id: null, ai_pause_renews: false, ai_pause_agent: null } as const;

/**
 * Pausa (ou renova) a IA nesta conversa. Já pausada, mantém a hora em que começou. announce: a
 * primeira mensagem enviada pela API leva o anúncio de entrada (com agent_name), e a volta da IA,
 * o "Voltei!".
 */
export async function pauseConversationAi(db: SupabaseClient, conversationId: string, o: { until: string; renews: boolean; announce: boolean; agentName: string | null; keyId: string }): Promise<string> {
  const { data: current } = await db.from("conversations").select("ai_paused_at, ai_paused_until").eq("id", conversationId).maybeSingle();
  const active = Boolean(current?.ai_paused_until && Date.parse(current.ai_paused_until as string) > Date.now());
  const { error } = await db
    .from("conversations")
    .update({
      ai_paused_until: o.until,
      ai_paused_by: "api",
      ai_paused_at: active ? current!.ai_paused_at : new Date().toISOString(),
      ai_pause_key_id: o.keyId,
      ai_pause_renews: o.renews,
      ai_pause_announce: o.announce,
      ai_pause_agent: o.agentName,
      // o anúncio de entrada sai na primeira mensagem da API (a mesma marca do "Assumir")
      ...(o.announce ? { announce_pending: true } : {}),
    })
    .eq("id", conversationId);
  if (error) throw new Error(`pausa da IA: ${error.message}`);
  return o.until;
}

export type ApiResumeReason = "api" | "agent_resumed" | "timeout";

/**
 * Devolve a conversa para a IA (se estava pausada pela integração): handoff.returned com o motivo
 * e, se a última mensagem do contato ficou sem resposta, a IA responde. onlyExpired: só se a pausa
 * já venceu (o tique não encerra uma pausa renovada no meio do caminho). background: a resposta da
 * IA roda depois da resposta a quem chamou (API e painel; o tique espera). Devolve se estava pausada.
 */
export async function resumeConversationAi(db: SupabaseClient, conversationId: string, o: { reason: ApiResumeReason; announce?: boolean; agent?: { id: string; name: string; type: string } | null; onlyExpired?: boolean; background?: boolean }): Promise<boolean> {
  const { data: current } = await db.from("conversations").select("ai_paused_until").eq("id", conversationId).maybeSingle();
  const until = (current?.ai_paused_until as string | null) ?? null;
  if (!until || (o.onlyExpired && Date.parse(until) > Date.now())) return false;
  const { data: cleared } = await db
    .from("conversations")
    .update({ ...API_PAUSE_CLEAR, ...(o.announce !== undefined ? { ai_pause_announce: o.announce } : {}) })
    .eq("id", conversationId)
    .eq("ai_paused_until", until)
    .select("id");
  if (!cleared?.length) return false;
  const at = o.reason === "timeout" ? until : new Date().toISOString();
  await queueHandoffReturned(db, conversationId, { reason: o.reason, agent: o.agent ?? null, at });
  const pending = () => answerPending(db, conversationId).catch((e) => console.error("pausa da IA: resposta pendente", (e as Error).message));
  if (!o.background) await pending();
  else {
    try {
      after(pending);
    } catch {
      void pending();
    }
  }
  return true;
}

/** Tique do minuto: as pausas que venceram voltam para a IA. */
export async function expireApiPauses(db: SupabaseClient, o: { hasTime?: () => boolean; limit?: number } = {}): Promise<number> {
  const { data } = await db.from("conversations").select("id").not("ai_paused_until", "is", null).lte("ai_paused_until", new Date().toISOString()).order("ai_paused_until").limit(o.limit ?? 50);
  let done = 0;
  for (const c of data ?? []) {
    if (o.hasTime && !o.hasTime()) break;
    if (await resumeConversationAi(db, c.id as string, { reason: "timeout", onlyExpired: true })) done++;
  }
  return done;
}

/**
 * Downgrade sem Integrações ou fim do teste: todas as pausas da integração na conta acabam num
 * passo só, com registro na auditoria (sem evento: os webhooks também param, e sem responder as
 * pendentes: a regra de estado decide o que a IA faz dali em diante).
 */
export async function endApiPauses(db: SupabaseClient, agencyId: string, why: "plano" | "teste"): Promise<number> {
  const { data: bots } = await db.from("bots").select("id").eq("agency_id", agencyId);
  const botIds = (bots ?? []).map((b) => b.id as string);
  if (!botIds.length) return 0;
  const { data, error } = await db.from("conversations").update(API_PAUSE_CLEAR).in("bot_id", botIds).not("ai_paused_until", "is", null).select("id");
  if (error) throw new Error(`pausas da integração: ${error.message}`);
  const n = data?.length ?? 0;
  if (n) await audit(db, { agencyId, actorType: "system", actorId: null, action: "conversa.pausas_api_encerradas", targetType: "agency", targetId: agencyId, after: { conversas: n, motivo: why === "plano" ? "plano sem Integrações" : "fim do teste grátis" } });
  return n;
}

/* ------------------------------------------------------------------ a pergunta que ficou sem resposta */

/** Rótulo de mídia sem texto ("📷 (foto)", "(figurinha)"): a IA não responde a isso. */
const MEDIA_ONLY = /^(\p{Extended_Pictographic}️?\s)?\([^()]+\)$/u;

/**
 * A última mensagem da conversa é do contato, chegou pelo canal (com a chave do evento), dentro da
 * janela de 24 horas, tem texto e não é descadastro: a IA pode responder. Pura.
 */
export function pendingQuestion(last: { role: string; content: string; inbound_key: string | null; created_at: string; deleted_at: string | null } | null, now = Date.now()): last is { role: "user"; content: string; inbound_key: string; created_at: string; deleted_at: null } {
  if (!last || last.role !== "user" || !last.inbound_key || last.deleted_at) return false;
  if (now - Date.parse(last.created_at) > 24 * 3_600_000) return false;
  const text = last.content.trim();
  return Boolean(text) && !MEDIA_ONLY.test(text) && !isOptOutKeyword(text);
}

/**
 * A IA responde a última mensagem do contato que ficou sem resposta: o evento dela volta para a
 * fila com um corpo de texto, e o reprocesso responde a pergunta já gravada (sem gravar de novo).
 * Só WhatsApp e Instagram (no site, a IA responde a próxima mensagem do visitante).
 */
export async function answerPending(db: SupabaseClient, conversationId: string): Promise<boolean> {
  const { data: conv } = await db.from("conversations").select("id, bot_id, channel, wa_id, ig_id").eq("id", conversationId).maybeSingle();
  if (!conv || (conv.channel !== "whatsapp" && conv.channel !== "instagram")) return false;
  const last = await findMessage(db, { conversationId, newestFirst: true }, ["id", "role", "content", "inbound_key", "created_at", "deleted_at"] as const);
  if (!pendingQuestion(last)) return false;
  const at = Math.floor(Date.parse(last.created_at) / 1000);
  let payload: unknown = null;
  if (conv.channel === "whatsapp") {
    const { data: ch } = await db.from("whatsapp_channels").select("phone_number_id").eq("bot_id", conv.bot_id).maybeSingle();
    const waId = conv.wa_id as string | null;
    if (!ch || !waId) return false;
    // o id da Meta não é guardado (só o hash): o reprocesso não precisa dele
    const who = /[a-z]/i.test(waId) ? { from_user_id: waId } : { from: waId };
    payload = { type: "msg", phoneNumberId: ch.phone_number_id, msg: { id: `${REARM_PREFIX}${last.id}`, ...who, type: "text", text: { body: last.content }, timestamp: String(at) }, profileName: null, identityKeyHash: null };
  } else {
    const { data: ch } = await db.from("instagram_channels").select("ig_user_id").eq("bot_id", conv.bot_id).is("disconnected_at", null).maybeSingle();
    const igsid = conv.ig_id as string | null;
    if (!ch || !igsid) return false;
    payload = { type: "msg", igUserId: ch.ig_user_id, ev: { sender: { id: igsid }, recipient: { id: ch.ig_user_id }, timestamp: at * 1000, message: { mid: `${REARM_PREFIX}${last.id}`, text: last.content } } };
  }
  const { processGroup, rearmInbound } = await import("./inbound-queue");
  const group = await rearmInbound(db, last.inbound_key, conv.channel, payload);
  if (!group) return false;
  const { inboundHandlers } = await import("./inbound-process");
  await processGroup(db, group, inboundHandlers[group.source]);
  return true;
}
