import type { UIMessage } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runChat, type BotRow } from "./chat";
import { firstExceeded } from "./rate-limit";
import { canTranscribe, transcribeAudio } from "./ai";
import { downloadMedia, markReadTyping, sendText, toWhatsAppText, waIdVariants, type WaChannel } from "./whatsapp";
import { isAccessError } from "./whatsapp-access";

/** Até quando uma mensagem nova continua a conversa anterior (a janela de atendimento da Meta). */
const RESUME_HOURS = 24;
const MAX_MESSAGE_CHARS = 2000;
const HISTORY = 12;

const FALLBACK = "No momento não consigo responder por aqui. A equipe vai retornar sua mensagem em breve.";
const ONLY_TEXT = "Por enquanto eu entendo mensagens de texto e áudios. Fotos, vídeos e documentos ainda não. Pode escrever sua dúvida?";
const AUDIO_FAILED = "Não consegui entender o áudio. Pode mandar de novo ou escrever?";
/** Marca a mensagem que chegou como áudio (no painel e para o assistente). */
export const AUDIO_PREFIX = "🎤 ";

/** Autor das respostas mandadas pelo app WhatsApp Business do celular (coexistência). */
export const PHONE_AUTHOR = "celular";
/** Depois de uma resposta pelo celular, o assistente fica quieto na conversa por este tempo. */
export const PHONE_PAUSE_MINUTES = 60;

/** Alguém respondeu pelo celular há pouco? Então é gente atendendo: o assistente não fala por cima. */
export function phonePauseActive(lastPhoneReplyAt: string | null | undefined, now = Date.now()): boolean {
  return Boolean(lastPhoneReplyAt) && now - new Date(lastPhoneReplyAt!).getTime() < PHONE_PAUSE_MINUTES * 60_000;
}

/** Como uma mensagem sem texto aparece no painel (quando o assistente está quieto). */
const MEDIA_LABEL: Record<string, string> = {
  image: "📷 (foto)",
  video: "🎬 (vídeo)",
  document: "📄 (documento)",
  sticker: "(figurinha)",
  location: "📍 (localização)",
  contacts: "👤 (contato)",
  audio: "🎤 (áudio)",
};
const mediaLabel = (type: string) => MEDIA_LABEL[type] ?? "(mensagem sem texto)";

/** O que interessa de uma mensagem recebida no webhook (value.messages[]). */
export interface InboundMessage {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  audio?: { id?: string; mime_type?: string; voice?: boolean };
}

export interface ChannelRow extends WaChannel {
  bot_id: string;
}

/**
 * Quando o contato escreveu por último para este chatbot, em qualquer conversa (a janela de 24 h
 * da Meta é por número, não por conversa). null se ele nunca escreveu, ou se as conversas em que
 * escreveu foram apagadas.
 */
export async function lastContactMessageAt(db: SupabaseClient, botId: string, waId: string): Promise<string | null> {
  const { data: convs } = await db.from("conversations").select("id").eq("bot_id", botId).in("wa_id", waIdVariants(waId));
  const ids = (convs ?? []).map((c) => c.id as string);
  if (!ids.length) return null;
  const { data } = await db.from("messages").select("created_at").in("conversation_id", ids).eq("role", "user").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.created_at as string | undefined) ?? null;
}

/** Texto da mensagem (texto, botão ou item de lista); null para áudio, imagem, figurinha… */
export function inboundText(m: InboundMessage): string | null {
  const t = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
  return t?.trim() ? t.trim() : null;
}

/** Grava uma mensagem do contato numa conversa e atualiza contadores (sem o assistente responder). */
async function storeContactMessage(db: SupabaseClient, conversationId: string, content: string) {
  await db.from("messages").insert({ conversation_id: conversationId, role: "user", content });
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
  const now = new Date().toISOString();
  await db.from("conversations").update({ last_message_at: now, visitor_seen_at: now, message_count: count ?? 0 }).eq("id", conversationId);
}

/** Conversa recente do contato com o chatbot (dentro da janela), procurando com e sem o 9. */
async function recentConversation(db: SupabaseClient, botId: string, waId: string) {
  const since = new Date(Date.now() - RESUME_HOURS * 3_600_000).toISOString();
  const { data } = await db
    .from("conversations")
    .select("id, takeover_at, handled_at")
    .eq("bot_id", botId)
    .in("wa_id", waIdVariants(waId))
    .gt("last_message_at", since)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Uma mensagem do WhatsApp do começo ao fim: acha a conversa do contato; se um atendente assumiu
 * ou alguém respondeu pelo celular há pouco, só guarda a mensagem para o painel; senão roda o
 * assistente e manda a resposta pelo mesmo número.
 */
export async function handleInbound(db: SupabaseClient, channel: ChannelRow, msg: InboundMessage, profileName: string | null) {
  // a Meta reentrega o mesmo evento se demorarmos: só a primeira entrega passa daqui
  const { data: fresh } = await db.from("whatsapp_inbound").upsert({ message_id: msg.id }, { onConflict: "message_id", ignoreDuplicates: true }).select("message_id");
  if (!fresh?.length) return;

  const { data: bot } = await db.from("bots").select("*").eq("id", channel.bot_id).maybeSingle<BotRow>();
  if (!bot || bot.status !== "live") return;

  const waId = msg.from;
  const reply = (body: string) => sendText(channel, waId, toWhatsAppText(body));
  const typed = inboundText(msg);
  const audioId = msg.type === "audio" ? msg.audio?.id : undefined;

  // o limite vem antes de qualquer custo (transcrição, IA)
  const exceeded = await firstExceeded(db, [
    { key: `wa:${bot.id}:${waId}:m`, max: 15, windowSeconds: 60, message: "Você está mandando mensagens rápido demais. Espere um minutinho." },
    { key: `wa:${bot.id}:${waId}:d`, max: 300, windowSeconds: 86400, message: "Limite de mensagens por hoje atingido. Tente de novo amanhã." },
  ]);
  if (exceeded) return reply(exceeded.message);

  const transcribe = async (): Promise<string | null> => {
    if (!audioId || !canTranscribe()) return null;
    try {
      const { data } = await downloadMedia(channel, audioId);
      const transcript = await transcribeAudio(data);
      return transcript ? AUDIO_PREFIX + transcript : null;
    } catch (e) {
      if (isAccessError(e)) throw e;
      console.error("whatsapp: áudio não transcrito", msg.id, e);
      return null;
    }
  };

  const conv = await recentConversation(db, bot.id, waId);
  // Gente atendendo (assumiu no painel, ou respondeu pelo celular há pouco): o assistente fica
  // quieto, sem "digitando…", e a mensagem vai para o painel.
  const { data: phoneReply } = conv
    ? await db.from("messages").select("created_at").eq("conversation_id", conv.id).eq("role", "agent").eq("author", PHONE_AUTHOR).order("id", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  if (conv && ((conv.takeover_at && !conv.handled_at) || phonePauseActive(phoneReply?.created_at as string | undefined))) {
    const text = typed ?? (await transcribe()) ?? mediaLabel(msg.type);
    await storeContactMessage(db, conv.id, text.slice(0, MAX_MESSAGE_CHARS));
    return;
  }

  if (!typed && !(audioId && canTranscribe())) return reply(ONLY_TEXT);
  await markReadTyping(channel, msg.id);
  const text = typed ?? (await transcribe());
  if (!text) return reply(AUDIO_FAILED);
  const question = text.slice(0, MAX_MESSAGE_CHARS);

  // histórico da conversa no formato do chat (o que a equipe escreveu conta como resposta)
  const { data: rows } = conv
    ? await db.from("messages").select("id, role, content").eq("conversation_id", conv.id).order("id", { ascending: false }).limit(HISTORY)
    : { data: [] };
  const history: UIMessage[] = (rows ?? [])
    .reverse()
    .map((r) => ({ id: String(r.id), role: r.role === "user" ? "user" : "assistant", parts: [{ type: "text", text: String(r.content) }] }));
  history.push({ id: msg.id, role: "user", parts: [{ type: "text", text: question }] });

  try {
    const { result, saved } = await runChat({ db, bot, messages: history, conversationId: conv?.id ?? null, visitorId: null, channel: "whatsapp", whatsapp: { waId, profileName } });
    const answer = await result.text;
    await saved;
    if (answer.trim()) await reply(answer);
  } catch (e) {
    // sem acesso ao número: quem chamou marca a desconexão (e não adianta tentar o aviso)
    if (isAccessError(e)) throw e;
    const code = (e as Error).message;
    // sem cota ou teste vencido: o contato não vê assunto de plano, só que a equipe retorna
    if (code !== "quota_exceeded" && code !== "trial_expired") console.error("whatsapp: falha ao responder", e);
    await reply(FALLBACK).catch(() => {});
  }
}

/** Mensagem que o próprio negócio mandou pelo app do celular (webhook smb_message_echoes). */
export interface EchoMessage {
  id: string;
  from: string;
  to: string;
  type: string;
  text?: { body?: string };
}

/**
 * Coexistência: alguém respondeu pelo app WhatsApp Business do celular. A resposta entra na
 * conversa do painel (como da equipe, autor "celular") e pausa o assistente naquela conversa.
 * Se ainda não havia conversa com o contato, abre uma.
 */
export async function handleEcho(db: SupabaseClient, channel: ChannelRow, echo: EchoMessage) {
  const { data: fresh } = await db.from("whatsapp_inbound").upsert({ message_id: echo.id }, { onConflict: "message_id", ignoreDuplicates: true }).select("message_id");
  if (!fresh?.length) return;

  const content = (echo.text?.body?.trim() || mediaLabel(echo.type)).slice(0, MAX_MESSAGE_CHARS);
  let conv = await recentConversation(db, channel.bot_id, echo.to);
  if (!conv) {
    const { data: created } = await db.from("conversations").insert({ bot_id: channel.bot_id, channel: "whatsapp", wa_id: echo.to, visitor_id: null }).select("id, takeover_at, handled_at").single();
    conv = created;
  }
  if (!conv) return;
  await db.from("messages").insert({ conversation_id: conv.id, role: "agent", content, author: PHONE_AUTHOR });
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id);
  await db.from("conversations").update({ last_message_at: new Date().toISOString(), message_count: count ?? 0 }).eq("id", conv.id);
}
