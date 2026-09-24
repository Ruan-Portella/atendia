import type { UIMessage } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runChat, type BotRow } from "./chat";
import { canTranscribe, transcribeAudio } from "./ai";
import { firstExceeded } from "./rate-limit";
import { instagramTyping, isInstagramAccessError, sendInstagramText, toInstagramText, type IgChannel } from "./instagram";
import { AUDIO_PREFIX, phonePauseActive, storeContactMessage } from "./whatsapp-inbound";
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

/** Marca um id de mensagem como já tratado; false se ele já estava (reentrega ou eco nosso). */
async function firstTime(db: SupabaseClient, mid: string): Promise<boolean> {
  const { data } = await db.from("whatsapp_inbound").upsert({ message_id: mid }, { onConflict: "message_id", ignoreDuplicates: true }).select("message_id");
  return Boolean(data?.length);
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
export async function send(db: SupabaseClient, ch: IgChannelRow, to: string, text: string) {
  const mid = await sendInstagramText(ch, to, text);
  if (mid) await firstTime(db, mid);
}

async function transcribeFrom(url: string): Promise<string | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`download do áudio falhou (${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_MEDIA_BYTES) throw new Error("áudio grande demais");
  const transcript = await transcribeAudio(data);
  return transcript ? AUDIO_PREFIX + transcript : null;
}

/**
 * Uma DM do começo ao fim: se alguém da equipe assumiu ou respondeu pelo app do Instagram há
 * pouco, só guarda a mensagem para o painel; senão roda o assistente e responde. Erro de acesso
 * (token recusado) sobe para o webhook marcar a conta como desconectada.
 */
export async function handleInstagramMessage(db: SupabaseClient, ch: IgChannelRow, ev: IgMessagingEvent) {
  const mid = ev.message?.mid ?? ev.postback?.mid;
  const igsid = ev.sender?.id;
  if (!mid || !igsid || ev.message?.is_deleted) {
    return console.log("instagram: DM sem id ou apagada, ignorada", { temMid: Boolean(mid), temRemetente: Boolean(igsid), apagada: Boolean(ev.message?.is_deleted), camposDaMensagem: Object.keys(ev.message ?? {}) });
  }
  // trava: a própria conta nunca é tratada como cliente (o assistente responderia a si mesmo)
  if (igsid === ch.ig_user_id) return console.log("instagram: mensagem da própria conta ignorada", mid);
  if (!(await firstTime(db, mid))) return console.log("instagram: mensagem repetida ignorada", mid);

  const { data: bot } = await db.from("bots").select("*").eq("id", ch.bot_id).maybeSingle<BotRow>();
  if (!bot) return console.warn("instagram: chatbot não encontrado", ch.bot_id);
  if (bot.status !== "live") return console.log("instagram: chatbot não publicado, DM ignorada", bot.id);
  console.log("instagram: DM recebida", { bot: bot.id, mid });

  const reply = (text: string) => send(db, ch, igsid, text);
  const typed = igText(ev);
  const audioUrl = ev.message?.attachments?.find((a) => a.type === "audio")?.payload?.url;

  const exceeded = await firstExceeded(db, [
    { key: `ig:${bot.id}:${igsid}:m`, max: 15, windowSeconds: 60, message: "Você está mandando mensagens rápido demais. Espere um minutinho." },
    { key: `ig:${bot.id}:${igsid}:d`, max: 300, windowSeconds: 86400, message: "Limite de mensagens por hoje atingido. Tente de novo amanhã." },
  ]);
  if (exceeded) return reply(exceeded.message);

  const transcribe = async () => {
    if (!audioUrl || !canTranscribe()) return null;
    try {
      return await transcribeFrom(audioUrl);
    } catch (e) {
      console.error("instagram: áudio não transcrito", mid, e);
      return null;
    }
  };

  const conv = await recentConversation(db, bot.id, igsid);
  const { data: appReply } = conv
    ? await db.from("messages").select("created_at").eq("conversation_id", conv.id).eq("role", "agent").eq("author", IG_APP_AUTHOR).order("id", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  if (conv && ((conv.takeover_at && !conv.handled_at) || phonePauseActive(appReply?.created_at as string | undefined))) {
    const text = typed ?? (await transcribe()) ?? igMediaLabel(ev);
    await storeContactMessage(db, conv.id, text.slice(0, MAX_MESSAGE_CHARS));
    return;
  }

  if (!typed && !(audioUrl && canTranscribe())) return reply(ONLY_TEXT);
  await instagramTyping(ch, igsid);
  const text = typed ?? (await transcribe());
  if (!text) return reply(AUDIO_FAILED);
  const question = text.slice(0, MAX_MESSAGE_CHARS);

  const { data: rows } = conv
    ? await db.from("messages").select("id, role, content").eq("conversation_id", conv.id).order("id", { ascending: false }).limit(HISTORY)
    : { data: [] };
  const history: UIMessage[] = (rows ?? []).reverse().map((r) => ({ id: String(r.id), role: r.role === "user" ? "user" : "assistant", parts: [{ type: "text", text: String(r.content) }] }));
  history.push({ id: mid, role: "user", parts: [{ type: "text", text: question }] });

  try {
    const { result, saved } = await runChat({ db, bot, messages: history, conversationId: conv?.id ?? null, visitorId: null, channel: "instagram", instagram: { igsid } });
    const answer = await result.text;
    await saved;
    if (answer.trim()) await reply(answer);
  } catch (e) {
    if (isInstagramAccessError(e)) throw e;
    const code = (e as Error).message;
    if (code !== "quota_exceeded" && code !== "trial_expired") console.error("instagram: falha ao responder", e);
    await reply(FALLBACK).catch(() => {});
  }
}

/**
 * Eco: mensagem que saiu da conta do cliente. As nossas (assistente ou painel) já estão marcadas
 * e são ignoradas; o resto é alguém da equipe respondendo pelo app do Instagram, que entra na
 * conversa do painel e pausa o assistente naquela conversa por 1 hora.
 */
export async function handleInstagramEcho(db: SupabaseClient, ch: IgChannelRow, ev: IgMessagingEvent) {
  const mid = ev.message?.mid;
  const igsid = ev.recipient?.id;
  if (!mid || !igsid) return;
  console.log("instagram: eco recebido", { mid });
  if (!(await firstTime(db, mid))) return;

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
  await db.from("messages").insert({ conversation_id: conv.id, role: "agent", content, author: IG_APP_AUTHOR });
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id);
  await db.from("conversations").update({ last_message_at: new Date().toISOString(), message_count: count ?? 0 }).eq("id", conv.id);
}
