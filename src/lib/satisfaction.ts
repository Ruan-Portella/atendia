import type { SupabaseClient } from "@supabase/supabase-js";
import { deliver } from "./send";
import { sendButtons } from "./whatsapp";
import { activeSuppressions, blocks, suppressionScope } from "./suppression";
import type { OptionItem } from "./components";

/*
 * Pesquisa de satisfação (Lançamento, parte 4, 19/10/2026; decisões do usuário no mesmo dia):
 * opcional por chatbot, só no WhatsApp e no Instagram, com 3 botões (Ótimo, Regular, Ruim). Sai no
 * fim do atendimento humano ("Encerrar atendimento e devolver ao assistente") e depois de 30
 * minutos de conversa parada com a IA, uma por conversa por dia, dentro da janela de 24 horas (é
 * mensagem de atendimento: não paga a Meta). O toque grava a nota e a IA não responde a ele.
 */

export const SURVEY_TEXT = "Como foi o seu atendimento hoje?";
export const SURVEY_THANKS = "Obrigado pela avaliação!";
export const SURVEY_OPTIONS = [
  { score: 3, title: "Ótimo" },
  { score: 2, title: "Regular" },
  { score: 1, title: "Ruim" },
] as const;
export const SCORE_LABEL: Record<number, string> = { 3: "Ótimo", 2: "Regular", 1: "Ruim" };

/** Minutos de conversa parada com a IA antes da pesquisa (e o limite para não pegar conversa antiga). */
export const IDLE_MINUTES = 30;
const IDLE_MAX_MINUTES = 120;
/** Texto fixo do sistema: não conta como resposta na conversa (o mesmo SYSTEM_AUTHOR de chat.ts). */
const SYSTEM = "sistema";

export type SurveyTrigger = "equipe" | "ia";

/** Os botões de uma pesquisa (o id leva a nota e a pesquisa). Pura. */
export const surveyButtons = (surveyId: string): OptionItem[] => SURVEY_OPTIONS.map((o) => ({ id: `csat:${o.score}:${surveyId}`, title: o.title }));

/** O toque num botão da pesquisa. Pura. */
export function parseSurveyButton(id: string | null | undefined): { score: 1 | 2 | 3; surveyId: string } | null {
  const m = /^csat:([123]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(id ?? "");
  return m ? { score: Number(m[1]) as 1 | 2 | 3, surveyId: m[2].toLowerCase() } : null;
}

type ConvRow = { id: string; bot_id: string; channel: string; wa_id: string | null; ig_id: string | null; last_contact_at: string | null };

/**
 * Manda a pesquisa numa conversa, se valer: chatbot com a pesquisa ligada e no ar, canal da Meta,
 * contato que escreveu nas últimas 23 horas, sem pesquisa nas últimas 24 horas e sem ter pedido
 * para não receber mensagens. A linha só fica se o envio saiu.
 */
export async function sendSatisfactionSurvey(db: SupabaseClient, i: { conversationId: string; trigger: SurveyTrigger; now?: number }): Promise<"sent" | "skipped" | "failed"> {
  const now = i.now ?? Date.now();
  const { data } = await db.from("conversations").select("id, bot_id, channel, wa_id, ig_id, last_contact_at").eq("id", i.conversationId).maybeSingle();
  const conv = data as ConvRow | null;
  if (!conv || (conv.channel !== "whatsapp" && conv.channel !== "instagram")) return "skipped";
  const to = conv.channel === "whatsapp" ? conv.wa_id : conv.ig_id;
  if (!to || !conv.last_contact_at || Date.parse(conv.last_contact_at) < now - 23 * 3_600_000) return "skipped";
  const { data: bot } = await db.from("bots").select("satisfaction_survey, paused_at, status").eq("id", conv.bot_id).maybeSingle();
  if (!bot?.satisfaction_survey || bot.paused_at || bot.status !== "live") return "skipped";
  const { data: recent } = await db.from("satisfaction_surveys").select("id").eq("conversation_id", conv.id).gte("sent_at", new Date(now - 86_400_000).toISOString()).limit(1);
  if (recent?.length) return "skipped";

  // canal e quem pediu para não receber nada (SAIR)
  const waChannel = conv.channel === "whatsapp" ? (await db.from("whatsapp_channels").select("phone_number_id, access_token_enc, waba_id, disconnected_at").eq("bot_id", conv.bot_id).maybeSingle()).data : null;
  const igChannel = conv.channel === "instagram" ? (await db.from("instagram_channels").select("bot_id, ig_user_id, access_token_enc, disconnected_at").eq("bot_id", conv.bot_id).maybeSingle()).data : null;
  const ch = waChannel ?? igChannel;
  if (!ch || ch.disconnected_at) return "skipped";
  const scope = suppressionScope({ wabaId: (waChannel?.waba_id as string | null | undefined) ?? null, botId: conv.bot_id });
  const kinds = (await activeSuppressions(db, { channel: conv.channel as "whatsapp" | "instagram", scope, contact: to })).map((s) => s.kind);
  if (blocks(kinds, "UTILITY")) return "skipped";

  const { data: row, error } = await db.from("satisfaction_surveys").insert({ bot_id: conv.bot_id, conversation_id: conv.id, channel: conv.channel, trigger: i.trigger, sent_at: new Date(now).toISOString() }).select("id").single();
  if (error || !row) return "failed";
  const surveyId = String(row.id);
  const options = surveyButtons(surveyId);
  try {
    const r = await deliver(db, {
      botId: conv.bot_id,
      channel: conv.channel as "whatsapp" | "instagram",
      conversationId: conv.id,
      kind: "sistema",
      recordFailures: false,
      record: { insert: { role: "assistant", content: SURVEY_TEXT, author: SYSTEM, components: { type: "options", options } } },
      transport: async () => {
        if (waChannel) return (await sendButtons(waChannel as { phone_number_id: string; access_token_enc: string | null }, to, SURVEY_TEXT, options)).messages?.[0]?.id ?? null;
        // o envio do Instagram vem na hora (evita o ciclo com o inbound)
        const { send } = await import("./instagram-inbound");
        return send(db, igChannel as Parameters<typeof send>[1], to, SURVEY_TEXT, options.map((o) => ({ title: o.title, payload: o.id })));
      },
    });
    if (r.status === "blocked") throw new Error(`barrada pela regra de estado: ${r.reason}`);
    return "sent";
  } catch (e) {
    await db.from("satisfaction_surveys").delete().eq("id", surveyId);
    console.warn("pesquisa de satisfação não saiu", conv.id, (e as Error).message);
    return "failed";
  }
}

/**
 * A cada minuto (cron das campanhas): conversas com a IA paradas há 30 minutos (até 2 horas), em
 * que a última fala foi da IA, com pelo menos 2 mensagens do contato e sem atendimento humano
 * aberto. Cada uma passa por sendSatisfactionSurvey (uma por conversa por dia).
 */
export async function runIdleSurveys(db: SupabaseClient, o: { now?: number; hasTime?: () => boolean } = {}): Promise<number> {
  const now = o.now ?? Date.now();
  const { data: bots } = await db.from("bots").select("id").eq("satisfaction_survey", true).is("paused_at", null).limit(500);
  if (!bots?.length) return 0;
  const iso = (ms: number) => new Date(ms).toISOString();
  const { data: convs } = await db
    .from("conversations")
    .select("id, last_reply_at, last_contact_at, message_count, takeover_at, handled_at, handoff_requested_at")
    .in("bot_id", bots.map((b) => String(b.id)))
    .in("channel", ["whatsapp", "instagram"])
    .lte("last_reply_at", iso(now - IDLE_MINUTES * 60_000))
    .gte("last_reply_at", iso(now - IDLE_MAX_MINUTES * 60_000))
    .gte("last_contact_at", iso(now - 23 * 3_600_000))
    .order("last_reply_at")
    .limit(50);
  let sent = 0;
  for (const c of (convs ?? []) as Array<{ id: string; last_reply_at: string; last_contact_at: string; message_count: number | null; takeover_at: string | null; handled_at: string | null; handoff_requested_at: string | null }>) {
    if (o.hasTime && !o.hasTime()) break;
    // a última fala foi da IA, e a conversa teve conversa de verdade (2 mensagens do contato, ao menos)
    if (Date.parse(c.last_reply_at) <= Date.parse(c.last_contact_at) || (c.message_count ?? 0) < 4) continue;
    // atendimento humano aberto, ou pedido de atendente esperando: a pesquisa espera o fim dele
    const open = (at: string | null) => Boolean(at && (!c.handled_at || Date.parse(c.handled_at) < Date.parse(at)));
    if (open(c.takeover_at) || open(c.handoff_requested_at)) continue;
    if ((await sendSatisfactionSurvey(db, { conversationId: c.id, trigger: "ia", now })) === "sent") sent++;
  }
  return sent;
}

/** O que a resposta precisa do canal (WhatsApp ou Instagram), como nos outros botões fixos. */
export interface SurveyReplyIO {
  db: SupabaseClient;
  conversation: () => Promise<string | null>;
  store: (i: number, convId: string) => Promise<void>;
  reply: (convId: string, text: string) => Promise<void>;
}

/**
 * Toques nos botões da pesquisa: grava a nota (só a primeira de cada pesquisa vale), guarda a
 * mensagem na conversa e agradece uma vez. A IA não responde a eles (devolve os índices tratados).
 */
export async function handleSatisfactionReplies(io: SurveyReplyIO, items: Array<{ text: string | null; buttonId: string | null }>): Promise<number[]> {
  const handled: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const tap = parseSurveyButton(items[i].buttonId);
    if (!tap) continue;
    handled.push(i);
    await io.db.from("satisfaction_surveys").update({ score: tap.score, answered_at: new Date().toISOString() }).eq("id", tap.surveyId).is("score", null);
  }
  if (!handled.length) return handled;
  const convId = await io.conversation();
  if (convId) {
    for (const i of handled) await io.store(i, convId);
    await io.reply(convId, SURVEY_THANKS);
  }
  return handled;
}

export interface SatisfactionSummary {
  sent: number;
  answered: number;
  good: number;
  regular: number;
  bad: number;
  /** % de "Ótimo" entre as respostas (null sem resposta). */
  goodPct: number | null;
}

/** As pesquisas dos chatbots desde a data: enviadas, respondidas e a nota. */
export async function satisfactionSummary(db: SupabaseClient, botIds: string[], since: string): Promise<SatisfactionSummary> {
  if (!botIds.length) return { sent: 0, answered: 0, good: 0, regular: 0, bad: 0, goodPct: null };
  const { data } = await db.from("satisfaction_surveys").select("score").in("bot_id", botIds).gte("sent_at", since).limit(10_000);
  const scores = (data ?? []).map((r) => Number(r.score) || 0);
  const count = (s: number) => scores.filter((x) => x === s).length;
  const answered = scores.filter(Boolean).length;
  return { sent: scores.length, answered, good: count(3), regular: count(2), bad: count(1), goodPct: answered ? Math.round((count(3) / answered) * 100) : null };
}
