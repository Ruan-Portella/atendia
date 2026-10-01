import type { UIMessage } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { conversationHistory, openConversation, runChat, type BotRow } from "./chat";
import { firstExceeded } from "./rate-limit";
import { canTranscribe, transcribeAudio } from "./ai";
import { recordAiUsage } from "./ai-usage";
import { downloadMedia, markReadTyping, sendText, toWhatsAppText, waIdVariants, type WaChannel } from "./whatsapp";
import { isAccessError, isPaymentError } from "./whatsapp-access";

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
export const mediaLabel = (type: string) => MEDIA_LABEL[type] ?? "(mensagem sem texto)";

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
export async function lastContactMessageAt(db: SupabaseClient, botId: string, contact: { waId: string } | { igsid: string }): Promise<string | null> {
  const base = db.from("conversations").select("id").eq("bot_id", botId);
  const { data: convs } = await ("waId" in contact ? base.in("wa_id", waIdVariants(contact.waId)) : base.eq("ig_id", contact.igsid));
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
export async function storeContactMessage(db: SupabaseClient, conversationId: string, content: string) {
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

/** Uma mensagem recebida, já na fila (inbound_events), com a chave que a grava uma vez só. */
export interface QueuedMessage {
  key: string;
  msg: InboundMessage;
  profileName: string | null;
  /** Quando o evento chegou: com mais de 24 h, a IA não responde (vira pedido de atendente). */
  receivedAt: string;
}

/** Evento antigo demais para a IA responder (fila parada por instabilidade). */
export const STALE_HOURS = 24;
export const isStale = (receivedAt: string, now = Date.now()) => now - new Date(receivedAt).getTime() > STALE_HOURS * 3_600_000;

/** Grava a mensagem do contato numa conversa uma vez só (a chave do evento segura o reprocesso). */
export async function storeOnce(db: SupabaseClient, conversationId: string, content: string, key: string) {
  const { data } = await db.from("messages").upsert({ conversation_id: conversationId, role: "user", content, inbound_key: key }, { onConflict: "inbound_key", ignoreDuplicates: true }).select("id");
  if (!data?.length) return;
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
  const now = new Date().toISOString();
  await db.from("conversations").update({ last_message_at: now, visitor_seen_at: now, message_count: count ?? 0 }).eq("id", conversationId);
}

/**
 * Reprocesso: a pergunta deste evento já foi gravada? Então ou a resposta já saiu (nada a
 * fazer), ou foi gerada e não enviada (só envia), ou não foi gerada (a IA roda de novo).
 */
export async function previousAnswer(db: SupabaseClient, key: string): Promise<{ state: "new" } | { state: "sent" } | { state: "unsent"; id: number; content: string } | { state: "unanswered" }> {
  const { data: q } = await db.from("messages").select("id, conversation_id").eq("inbound_key", key).maybeSingle();
  if (!q) return { state: "new" };
  const { data: a } = await db.from("messages").select("id, content, channel_msg_id").eq("conversation_id", q.conversation_id).eq("role", "assistant").gt("id", q.id).order("id").limit(1).maybeSingle();
  if (!a) return { state: "unanswered" };
  return a.channel_msg_id ? { state: "sent" } : { state: "unsent", id: a.id as number, content: String(a.content) };
}

/**
 * As mensagens de um contato que chegaram juntas (a rajada "oi", "quanto custa?", "e a barba?"):
 * todas são gravadas e o assistente responde uma vez, à última. Se um atendente assumiu ou alguém
 * respondeu pelo celular há pouco, só guarda para o painel. Erro de acesso ou de pagamento sobe
 * para quem chamou marcar o número.
 */
export async function handleInboundBurst(db: SupabaseClient, channel: ChannelRow, burst: QueuedMessage[]) {
  if (!burst.length) return;
  const { data: bot } = await db.from("bots").select("*").eq("id", channel.bot_id).maybeSingle<BotRow>();
  if (!bot || bot.status !== "live") return;

  const last = burst[burst.length - 1];
  const waId = last.msg.from;
  const profileName = last.profileName;
  const reply = (body: string) => sendText(channel, waId, toWhatsAppText(body));

  // o limite vem antes de qualquer custo (transcrição, IA); cada mensagem conta
  for (let i = 0; i < burst.length; i++) {
    const exceeded = await firstExceeded(db, [
      { key: `wa:${bot.id}:${waId}:m`, max: 15, windowSeconds: 60, message: "Você está mandando mensagens rápido demais. Espere um minutinho." },
      { key: `wa:${bot.id}:${waId}:d`, max: 300, windowSeconds: 86400, message: "Limite de mensagens por hoje atingido. Tente de novo amanhã." },
    ]);
    if (exceeded) return void (await reply(exceeded.message));
  }

  const transcribe = async (m: InboundMessage): Promise<string | null> => {
    const audioId = m.type === "audio" ? m.audio?.id : undefined;
    if (!audioId || !canTranscribe()) return null;
    try {
      const { data } = await downloadMedia(channel, audioId);
      const transcript = await transcribeAudio(data, (u) => void recordAiUsage(db, { agencyId: bot.agency_id, botId: bot.id, kind: "transcricao", channel: "whatsapp", ...u }));
      return transcript ? AUDIO_PREFIX + transcript : null;
    } catch (e) {
      if (isAccessError(e)) throw e;
      console.error("whatsapp: áudio não transcrito", m.id, e);
      return null;
    }
  };
  // texto de cada mensagem: digitado, áudio transcrito ou null (mídia sem texto)
  const texts: Array<string | null> = [];
  for (const q of burst) texts.push((inboundText(q.msg) ?? (await transcribe(q.msg)))?.slice(0, MAX_MESSAGE_CHARS) ?? null);
  const shown = (i: number) => texts[i] ?? mediaLabel(burst[i].msg.type);

  let conv = await recentConversation(db, bot.id, waId);
  const { data: phoneReply } = conv
    ? await db.from("messages").select("created_at").eq("conversation_id", conv.id).eq("role", "agent").eq("author", PHONE_AUTHOR).order("id", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  // gente atendendo: o assistente fica quieto, sem "digitando…", e as mensagens vão para o painel
  if (conv && ((conv.takeover_at && !conv.handled_at) || phonePauseActive(phoneReply?.created_at as string | undefined))) {
    for (let i = 0; i < burst.length; i++) await storeOnce(db, conv.id, shown(i), burst[i].key);
    return;
  }

  // a fila ficou parada mais de 24 h: não responde com IA, vira pedido de atendente
  if (isStale(burst[0].receivedAt)) {
    const convId = conv?.id ?? (await db.from("conversations").insert({ bot_id: bot.id, channel: "whatsapp", wa_id: waId, visitor_id: null }).select("id").single()).data?.id;
    if (!convId) return;
    for (let i = 0; i < burst.length; i++) await storeOnce(db, convId, shown(i), burst[i].key);
    await db.from("conversations").update({ needs_human: true, handoff_requested_at: new Date().toISOString(), handled_at: null }).eq("id", convId);
    return;
  }

  // a resposta vai para a última mensagem com texto; as de antes (e a mídia) só entram no histórico
  const qi = texts.map((t, i) => (t ? i : -1)).filter((i) => i >= 0).pop();
  if (qi === undefined) {
    const lastAudio = last.msg.type === "audio" && canTranscribe();
    return void (await reply(lastAudio ? AUDIO_FAILED : ONLY_TEXT));
  }
  const q = burst[qi];

  const before = await previousAnswer(db, q.key);
  if (before.state === "sent") return;
  if (before.state === "unsent") {
    const sent = await reply(before.content);
    await db.from("messages").update({ channel_msg_id: sent.messages?.[0]?.id ?? "enviada" }).eq("id", before.id);
    return;
  }

  await markReadTyping(channel, last.msg.id);
  try {
    if (!conv) conv = { id: await openConversation(db, bot, { channel: "whatsapp", waId }), takeover_at: null, handled_at: null };
    for (let i = 0; i < burst.length; i++) if (i !== qi) await storeOnce(db, conv.id, shown(i), burst[i].key);

    // histórico do banco (com a rajada já gravada) + a pergunta, que o runChat grava uma vez só
    // (no reprocesso "unanswered" a pergunta já está no banco, então já vem no histórico)
    const history: UIMessage[] = await conversationHistory(db, conv.id, HISTORY);
    if (before.state !== "unanswered") history.push({ id: q.msg.id, role: "user", parts: [{ type: "text", text: texts[qi]! }] });
    const { result, saved } = await runChat({ db, bot, messages: history, conversationId: conv.id, visitorId: null, channel: "whatsapp", whatsapp: { waId, profileName }, questionKey: q.key });
    const answer = await result.text;
    const answerId = await saved;
    if (answer.trim()) {
      const sent = await reply(answer);
      if (answerId) await db.from("messages").update({ channel_msg_id: sent.messages?.[0]?.id ?? "enviada" }).eq("id", answerId);
    }
  } catch (e) {
    // sem acesso ao número ou sem pagamento: quem chamou marca (e não adianta tentar o aviso)
    if (isAccessError(e) || isPaymentError(e)) throw e;
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
 * Se ainda não havia conversa com o contato, abre uma. A chave do evento evita gravar duas vezes.
 */
export async function handleEcho(db: SupabaseClient, channel: ChannelRow, echo: EchoMessage, key: string) {
  const content = (echo.text?.body?.trim() || mediaLabel(echo.type)).slice(0, MAX_MESSAGE_CHARS);
  let conv = await recentConversation(db, channel.bot_id, echo.to);
  if (!conv) {
    const { data: created } = await db.from("conversations").insert({ bot_id: channel.bot_id, channel: "whatsapp", wa_id: echo.to, visitor_id: null }).select("id, takeover_at, handled_at").single();
    conv = created;
  }
  if (!conv) return;
  const { data } = await db.from("messages").upsert({ conversation_id: conv.id, role: "agent", content, author: PHONE_AUTHOR, inbound_key: key }, { onConflict: "inbound_key", ignoreDuplicates: true }).select("id");
  if (!data?.length) return;
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id);
  await db.from("conversations").update({ last_message_at: new Date().toISOString(), message_count: count ?? 0 }).eq("id", conv.id);
}
