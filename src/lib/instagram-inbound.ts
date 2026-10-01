import type { UIMessage } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { conversationHistory, openConversation, runChat, type BotRow } from "./chat";
import { markOwnMessage } from "./inbound-queue";
import { canTranscribe, transcribeAudio } from "./ai";
import { recordAiUsage } from "./ai-usage";
import { firstExceeded } from "./rate-limit";
import { instagramTyping, isInstagramAccessError, sendInstagramText, toInstagramText, type IgChannel } from "./instagram";
import { AUDIO_PREFIX, isStale, phonePauseActive, previousAnswer, storeOnce } from "./whatsapp-inbound";
import { MAX_MEDIA_BYTES } from "./whatsapp";

/** Até quando uma mensagem nova continua a conversa anterior (a janela de resposta do Instagram). */
const RESUME_HOURS = 24;
const MAX_MESSAGE_CHARS = 2000;
const HISTORY = 12;

const FALLBACK = "No momento não consigo responder por aqui. A equipe vai retornar sua mensagem em breve.";
const ONLY_TEXT = "Por enquanto eu entendo mensagens de texto e áudios. Fotos e vídeos ainda não. Pode escrever sua dúvida?";
const AUDIO_FAILED = "Não consegui entender o áudio. Pode mandar de novo ou escrever?";

/** Autor das respostas mandadas pelo próprio app do Instagram (alguém da equipe no celular). */
export const IG_APP_AUTHOR = "instagram";

const IG_MEDIA_LABEL: Record<string, string> = {
  image: "📷 (foto)",
  video: "🎬 (vídeo)",
  audio: "🎤 (áudio)",
  file: "📄 (arquivo)",
  share: "(publicação compartilhada)",
  story_mention: "(menção nos stories)",
  ig_reel: "(reel)",
  reel: "(reel)",
};

export interface IgMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
    quick_reply?: { payload?: string };
  };
  postback?: { mid?: string; title?: string; payload?: string };
}

export interface IgChannelRow extends IgChannel {
  bot_id: string;
}

/** Texto da mensagem (texto ou botão tocado); null para mídia. */
export function igText(ev: IgMessagingEvent): string | null {
  const t = ev.message?.text ?? ev.postback?.title;
  return t?.trim() ? t.trim() : null;
}

export function igMediaLabel(ev: IgMessagingEvent): string {
  const type = ev.message?.attachments?.[0]?.type ?? "";
  return IG_MEDIA_LABEL[type] ?? "(mensagem sem texto)";
}

/** Conversa recente do contato com o chatbot (dentro da janela de 24 h). */
async function recentConversation(db: SupabaseClient, botId: string, igsid: string) {
  const since = new Date(Date.now() - RESUME_HOURS * 3_600_000).toISOString();
  const { data } = await db
    .from("conversations")
    .select("id, takeover_at, handled_at")
    .eq("bot_id", botId)
    .eq("ig_id", igsid)
    .gt("last_message_at", since)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/** Manda a DM e guarda o id dela: o webhook ecoa as nossas mensagens, e assim o eco é ignorado. */
export async function send(db: SupabaseClient, ch: IgChannelRow, to: string, text: string): Promise<string | null> {
  const mid = await sendInstagramText(ch, to, text);
  if (mid) await markOwnMessage(db, `ig:echo:${mid}`, "instagram");
  return mid;
}

async function transcribeFrom(url: string, onUsage?: Parameters<typeof transcribeAudio>[1]): Promise<string | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`download do áudio falhou (${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_MEDIA_BYTES) throw new Error("áudio grande demais");
  const transcript = await transcribeAudio(data, onUsage);
  return transcript ? AUDIO_PREFIX + transcript : null;
}

/** Uma DM recebida, já na fila (inbound_events), com a chave que a grava uma vez só. */
export interface QueuedDm {
  key: string;
  ev: IgMessagingEvent;
  receivedAt: string;
}

/**
 * As DMs de um contato que chegaram juntas: todas são gravadas e o assistente responde uma vez,
 * à última com texto. Se alguém da equipe assumiu ou respondeu pelo app do Instagram há pouco,
 * só guarda para o painel. Erro de acesso (token recusado) sobe para quem chamou marcar a conta.
 */
export async function handleInstagramBurst(db: SupabaseClient, ch: IgChannelRow, all: QueuedDm[]) {
  const burst = all.filter((q) => (q.ev.message?.mid ?? q.ev.postback?.mid) && q.ev.sender?.id && !q.ev.message?.is_deleted);
  if (!burst.length) return;
  const { data: bot } = await db.from("bots").select("*").eq("id", ch.bot_id).maybeSingle<BotRow>();
  if (!bot) return console.warn("instagram: chatbot não encontrado", ch.bot_id);
  if (bot.status !== "live") return console.log("instagram: chatbot não publicado, DM ignorada", bot.id);
  const igsid = burst[0].ev.sender!.id!;
  console.log("instagram: DMs recebidas", { bot: bot.id, quantidade: burst.length });

  const reply = (text: string) => send(db, ch, igsid, text);
  for (let i = 0; i < burst.length; i++) {
    const exceeded = await firstExceeded(db, [
      { key: `ig:${bot.id}:${igsid}:m`, max: 15, windowSeconds: 60, message: "Você está mandando mensagens rápido demais. Espere um minutinho." },
      { key: `ig:${bot.id}:${igsid}:d`, max: 300, windowSeconds: 86400, message: "Limite de mensagens por hoje atingido. Tente de novo amanhã." },
    ]);
    if (exceeded) return void (await reply(exceeded.message));
  }

  const transcribe = async (ev: IgMessagingEvent) => {
    const audioUrl = ev.message?.attachments?.find((a) => a.type === "audio")?.payload?.url;
    if (!audioUrl || !canTranscribe()) return null;
    try {
      return await transcribeFrom(audioUrl, (u) => void recordAiUsage(db, { agencyId: bot.agency_id, botId: bot.id, kind: "transcricao", channel: "instagram", ...u }));
    } catch (e) {
      console.error("instagram: áudio não transcrito", e);
      return null;
    }
  };
  const texts: Array<string | null> = [];
  for (const q of burst) texts.push((igText(q.ev) ?? (await transcribe(q.ev)))?.slice(0, MAX_MESSAGE_CHARS) ?? null);
  const shown = (i: number) => texts[i] ?? igMediaLabel(burst[i].ev);

  let conv = await recentConversation(db, bot.id, igsid);
  const { data: appReply } = conv
    ? await db.from("messages").select("created_at").eq("conversation_id", conv.id).eq("role", "agent").eq("author", IG_APP_AUTHOR).order("id", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  if (conv && ((conv.takeover_at && !conv.handled_at) || phonePauseActive(appReply?.created_at as string | undefined))) {
    for (let i = 0; i < burst.length; i++) await storeOnce(db, conv.id, shown(i), burst[i].key);
    return;
  }

  if (isStale(burst[0].receivedAt)) {
    const convId = conv?.id ?? (await db.from("conversations").insert({ bot_id: bot.id, channel: "instagram", ig_id: igsid, visitor_id: null }).select("id").single()).data?.id;
    if (!convId) return;
    for (let i = 0; i < burst.length; i++) await storeOnce(db, convId, shown(i), burst[i].key);
    await db.from("conversations").update({ needs_human: true, handoff_requested_at: new Date().toISOString(), handled_at: null }).eq("id", convId);
    return;
  }

  const qi = texts.map((t, i) => (t ? i : -1)).filter((i) => i >= 0).pop();
  if (qi === undefined) {
    const lastAudio = Boolean(burst[burst.length - 1].ev.message?.attachments?.some((a) => a.type === "audio")) && canTranscribe();
    return void (await reply(lastAudio ? AUDIO_FAILED : ONLY_TEXT));
  }
  const q = burst[qi];

  const before = await previousAnswer(db, q.key);
  if (before.state === "sent") return;
  if (before.state === "unsent") {
    const mid = await reply(before.content);
    await db.from("messages").update({ channel_msg_id: mid ?? "enviada" }).eq("id", before.id);
    return;
  }

  await instagramTyping(ch, igsid);
  try {
    if (!conv) conv = { id: await openConversation(db, bot, { channel: "instagram", igsid }), takeover_at: null, handled_at: null };
    for (let i = 0; i < burst.length; i++) if (i !== qi) await storeOnce(db, conv.id, shown(i), burst[i].key);

    // (no reprocesso "unanswered" a pergunta já está no banco, então já vem no histórico)
    const history: UIMessage[] = await conversationHistory(db, conv.id, HISTORY);
    if (before.state !== "unanswered") history.push({ id: q.key, role: "user", parts: [{ type: "text", text: texts[qi]! }] });
    const { result, saved } = await runChat({ db, bot, messages: history, conversationId: conv.id, visitorId: null, channel: "instagram", instagram: { igsid }, questionKey: q.key });
    const answer = await result.text;
    const answerId = await saved;
    if (answer.trim()) {
      const mid = await reply(answer);
      if (answerId) await db.from("messages").update({ channel_msg_id: mid ?? "enviada" }).eq("id", answerId);
    }
  } catch (e) {
    if (isInstagramAccessError(e)) throw e;
    const code = (e as Error).message;
    if (code !== "quota_exceeded" && code !== "trial_expired") console.error("instagram: falha ao responder", e);
    await reply(FALLBACK).catch(() => {});
  }
}

/**
 * Eco: mensagem que saiu da conta do cliente. As nossas (assistente ou painel) já entraram na
 * fila como tratadas e nem chegam aqui; o resto é alguém da equipe respondendo pelo app do
 * Instagram, que entra na conversa do painel e pausa o assistente naquela conversa por 1 hora.
 */
export async function handleInstagramEcho(db: SupabaseClient, ch: IgChannelRow, ev: IgMessagingEvent, key: string) {
  const igsid = ev.recipient?.id;
  if (!ev.message?.mid || !igsid) return;

  const content = (igText(ev) ?? igMediaLabel(ev)).slice(0, MAX_MESSAGE_CHARS);
  let conv = await recentConversation(db, ch.bot_id, igsid);
  if (conv) {
    // reserva, caso o eco chegue antes de guardarmos o id: é a mesma frase que acabamos de mandar?
    const { data: last } = await db.from("messages").select("content, role, created_at").eq("conversation_id", conv.id).in("role", ["assistant", "agent"]).order("id", { ascending: false }).limit(1).maybeSingle();
    if (last && toInstagramText(String(last.content)) === content && Date.now() - new Date(last.created_at as string).getTime() < 5 * 60_000) return;
  } else {
    const { data: created } = await db.from("conversations").insert({ bot_id: ch.bot_id, channel: "instagram", ig_id: igsid, visitor_id: null }).select("id, takeover_at, handled_at").single();
    conv = created;
  }
  if (!conv) return;
  const { data, error } = await db.from("messages").upsert({ conversation_id: conv.id, role: "agent", content, author: IG_APP_AUTHOR, inbound_key: key }, { onConflict: "inbound_key", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(`mensagem não gravada: ${error.message}`);
  if (!data?.length) return;
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id);
  await db.from("conversations").update({ last_message_at: new Date().toISOString(), message_count: count ?? 0 }).eq("id", conv.id);
}
