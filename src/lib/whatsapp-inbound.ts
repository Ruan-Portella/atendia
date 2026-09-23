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

/**
 * Uma mensagem do WhatsApp do começo ao fim: acha (ou abre) a conversa do contato, deixa quieto
 * se um atendente assumiu, senão roda o assistente e manda a resposta pelo mesmo número.
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
  if (!typed && !(audioId && canTranscribe())) return reply(ONLY_TEXT);

  // o limite vem antes da transcrição: áudio em massa não gera custo
  const exceeded = await firstExceeded(db, [
    { key: `wa:${bot.id}:${waId}:m`, max: 15, windowSeconds: 60, message: "Você está mandando mensagens rápido demais. Espere um minutinho." },
    { key: `wa:${bot.id}:${waId}:d`, max: 300, windowSeconds: 86400, message: "Limite de mensagens por hoje atingido. Tente de novo amanhã." },
  ]);
  if (exceeded) return reply(exceeded.message);

  await markReadTyping(channel, msg.id);

  let text = typed;
  if (!text && audioId) {
    try {
      const { data } = await downloadMedia(channel, audioId);
      const transcript = await transcribeAudio(data);
      text = transcript ? AUDIO_PREFIX + transcript : null;
    } catch (e) {
      if (isAccessError(e)) throw e;
      console.error("whatsapp: áudio não transcrito", msg.id, e);
    }
    if (!text) return reply(AUDIO_FAILED);
  }
  if (!text) return;

  const since = new Date(Date.now() - RESUME_HOURS * 3_600_000).toISOString();
  const { data: conv } = await db
    .from("conversations")
    .select("id, takeover_at, handled_at")
    .eq("bot_id", bot.id)
    .in("wa_id", waIdVariants(waId)) // conversa aberta pelo painel pode ter o número com o 9
    .gt("last_message_at", since)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const question = text.slice(0, MAX_MESSAGE_CHARS);

  // Uma pessoa da equipe assumiu: o assistente fica quieto e a mensagem vai para o painel.
  if (conv?.takeover_at && !conv.handled_at) {
    await db.from("messages").insert({ conversation_id: conv.id, role: "user", content: question });
    const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id);
    const now = new Date().toISOString();
    await db.from("conversations").update({ last_message_at: now, visitor_seen_at: now, message_count: count ?? 0 }).eq("id", conv.id);
    return;
  }

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
