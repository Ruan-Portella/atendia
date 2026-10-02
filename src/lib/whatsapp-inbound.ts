import type { SupabaseClient } from "@supabase/supabase-js";
import { SYSTEM_AUTHOR, handleRiskWithoutAi, enterHumanOnly, openConversation, type BotRow } from "./chat";
import { clearNotice, decideMode, markNoticeSent, noticeDue, resolveMode, type Mode } from "./conversation-mode";
import { deliver, type SendKind, type SendRecord } from "./send";
import { changeWhatsAppIdentity, previousBsuid, touchInbound, whatsappContact, whatsappIdentityOf } from "./contacts";
import { firstExceeded, noticeOnce } from "./rate-limit";
import { canTranscribe, transcribeAudio } from "./ai";
import { recordAiUsage } from "./ai-usage";
import { downloadMedia, markReadTyping, sendButtons, sendText, toWhatsAppText, waIdVariants, type WaChannel } from "./whatsapp";
import { OPTOUT_ALSO, OPTOUT_UNDO, activeSuppressions, isOptOutKeyword, optOutConfirmation, revoke, suppress, suppressionScope, type SuppressionKind } from "./suppression";
import { isAccessError, isPaymentError } from "./whatsapp-access";
import { answerWithGate, gateButtons } from "./gate/flow";
import { GATE_TEXTS } from "./gate/rules";

/** Até quando uma mensagem nova continua a conversa anterior (a janela de atendimento da Meta). */
const RESUME_HOURS = 24;
const MAX_MESSAGE_CHARS = 2000;
/** Depois de uma mídia sem legenda, a pergunta costuma chegar logo atrás, em outra mensagem. */
const FOLLOW_UP_WAIT_MS = 3500;
const HISTORY = 12;

const FALLBACK = "No momento não consigo responder por aqui. A equipe vai retornar sua mensagem em breve.";
const ONLY_TEXT = "Por enquanto eu entendo mensagens de texto e áudios. Fotos, vídeos e documentos ainda não. Pode escrever sua dúvida?";
const AUDIO_FAILED = "Não consegui entender o áudio. Pode mandar de novo ou escrever?";
/** Marca a mensagem que chegou como áudio (no painel e para o assistente). */
export const AUDIO_PREFIX = "🎤 ";

// autores do celular e do app e a pausa de 60 minutos moram em authors.ts (a regra de estado usa)
export { PHONE_AUTHOR, PHONE_PAUSE_MINUTES, phonePauseActive } from "./authors";
import { PHONE_AUTHOR } from "./authors";
import { hasPendingFrom } from "./inbound-queue";

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
  /** Telefone do contato. Desde abr/2026 pode faltar: aí só vem o BSUID (from_user_id). */
  from?: string;
  from_user_id?: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
  audio?: { id?: string; mime_type?: string; voice?: boolean };
  /** Aviso do sistema (ex.: a pessoa trocou de número: user_changed_user_id / user_changed_number). */
  system?: { body?: string; type?: string; wa_id?: string; user_id?: string };
}

export interface ChannelRow extends WaChannel {
  bot_id: string;
  /** Número também no app WhatsApp Business do celular: o dono já vê cada mensagem lá. */
  coexistence?: boolean;
  disconnected_at?: string | null;
  /** A Meta recusou por falta de pagamento (a regra de estado segura o envio por 1 hora). */
  payment_issue_at?: string | null;
}

/** Quem mandou: o telefone, ou o BSUID quando a Meta não manda o telefone. null = nenhum dos dois. */
export const contactOf = (m: { from?: string; from_user_id?: string }): string | null => m.from ?? m.from_user_id ?? null;

/** Tipos que nunca recebem resposta: reação ("joinha"), mensagem não suportada e aviso do sistema. */
const SILENT_TYPES = new Set(["reaction", "unsupported", "system", "ephemeral"]);

/**
 * Quando o contato escreveu por último para este chatbot, em qualquer conversa (a janela de 24 h
 * da Meta é por número, não por conversa). null se ele nunca escreveu, ou se as conversas em que
 * escreveu foram apagadas.
 */
export async function lastContactMessageAt(db: SupabaseClient, botId: string, contact: { waId: string } | { igsid: string }, contactId?: string | null): Promise<string | null> {
  if (contactId) {
    const { data: c } = await db.from("contacts").select("last_inbound_at").eq("id", contactId).maybeSingle();
    if (c?.last_inbound_at) return c.last_inbound_at as string;
  }
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

/**
 * Conversa recente do contato com o chatbot (dentro da janela): pelo contato (vale também quando a
 * pessoa passa a aparecer só pelo BSUID); conversa antiga, de antes dos contatos, pelo wa_id com e
 * sem o 9, e ela já passa a apontar para o contato.
 */
async function recentConversation(db: SupabaseClient, botId: string, waId: string, contactId: string | null = null): Promise<RecentConversation | null> {
  const since = new Date(Date.now() - RESUME_HOURS * 3_600_000).toISOString();
  const recent = () => db.from("conversations").select("id, takeover_at, handled_at, unavailable_notice_reason, contact_id").eq("bot_id", botId).gt("last_message_at", since).order("last_message_at", { ascending: false }).limit(1);
  if (contactId) {
    const { data } = await recent().eq("contact_id", contactId).maybeSingle<RecentConversation>();
    if (data) return data;
  }
  const { data } = await recent().in("wa_id", waIdVariants(waId)).maybeSingle<RecentConversation>();
  if (data && contactId && !data.contact_id) {
    await db.from("conversations").update({ contact_id: contactId }).eq("id", data.id);
    data.contact_id = contactId;
  }
  return data;
}

interface RecentConversation {
  id: string;
  takeover_at: string | null;
  handled_at: string | null;
  contact_id?: string | null;
  /** Aviso de indisponível já enviado neste episódio (zera quando volta ao normal). */
  unavailable_notice_reason?: string | null;
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
  const { data, error } = await db.from("messages").upsert({ conversation_id: conversationId, role: "user", content, inbound_key: key }, { onConflict: "inbound_key", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(`mensagem não gravada: ${error.message}`);
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
  const { data: a } = await db.from("messages").select("id, content, channel_msg_id, blocked_reason, failed_at").eq("conversation_id", q.conversation_id).eq("role", "assistant").gt("id", q.id).order("id").limit(1).maybeSingle();
  if (!a) return { state: "unanswered" };
  // barrada pela regra de estado ou recusada pelo canal também já foi resolvida: não reenvia
  return a.channel_msg_id || a.blocked_reason || a.failed_at ? { state: "sent" } : { state: "unsent", id: a.id as number, content: String(a.content) };
}

/**
 * As mensagens de um contato que chegaram juntas (a rajada "oi", "quanto custa?", "e a barba?"):
 * todas são gravadas e o assistente responde uma vez, à última. Quem responde (IA, equipe ou
 * ninguém) sai da regra única de estado (conversation-mode). Erro de acesso ou de pagamento sobe
 * para quem chamou marcar o número.
 */
export async function handleInboundBurst(db: SupabaseClient, channel: ChannelRow, all: QueuedMessage[]) {
  // a pessoa trocou de número (aviso do sistema da Meta): o mesmo contato fica com o telefone e o BSUID novos
  for (const q of all) {
    const sys = q.msg.type === "system" ? q.msg.system : undefined;
    if (sys?.type !== "user_changed_user_id" && sys?.type !== "user_changed_number") continue;
    const ok = await changeWhatsAppIdentity(db, channel.bot_id, { phone: q.msg.from, bsuid: previousBsuid(sys.body) ?? q.msg.from_user_id }, { phone: sys.wa_id, bsuid: sys.user_id });
    console.log("whatsapp: troca de número", sys.type, ok ? "aplicada" : "contato não encontrado");
  }
  // reação, não suportada e sistema: nem resposta nem "só entendo texto" (o joinha não é pergunta)
  const burst = all.filter((q) => !SILENT_TYPES.has(q.msg.type) && contactOf(q.msg));
  if (burst.length < all.length) console.log("whatsapp: sem resposta", all.filter((q) => !burst.includes(q)).map((q) => q.msg.type));
  if (!burst.length) return;
  const { data: bot } = await db.from("bots").select("*").eq("id", channel.bot_id).maybeSingle<BotRow>();
  if (!bot || bot.status !== "live") return;

  const last = burst[burst.length - 1];
  const waId = contactOf(last.msg)!;
  const profileName = last.profileName;
  const reply = (body: string) => sendText(channel, waId, toWhatsAppText(body));

  // o contato (achado pelo BSUID ou pelo telefone canônico) e a conversa recente dele
  const contact = await whatsappContact(db, bot, { phone: last.msg.from ?? null, bsuid: last.msg.from_user_id ?? null, name: profileName });
  const contactId = contact?.id ?? null;
  let conv = await recentConversation(db, bot.id, waId, contactId);
  const mode = await resolveMode(db, { bot, channel: "whatsapp", conversation: conv, wa: channel, opening: !conv });
  // "já conversou" e a janela de 24 h: só mensagem do próprio contato que chegou (ordem da Meta e desligamento geral: nada)
  if (contact && mode.storeInbound) await touchInbound(db, contact);
  /** Texto pela camada única de envio: regra de estado na hora do envio e registro na conversa. */
  const say = (kind: SendKind, text: string, record: SendRecord, conversationId: string | null = conv?.id ?? null) =>
    deliver(db, { botId: bot.id, channel: "whatsapp", conversationId, kind, record, transport: async () => (await reply(text)).messages?.[0]?.id ?? null });

  // o limite vem antes de qualquer custo (transcrição, IA); cada mensagem conta
  for (let i = 0; i < burst.length; i++) {
    const exceeded = await firstExceeded(db, [
      { key: `wa:${bot.id}:${waId}:m`, max: 15, windowSeconds: 60, message: "Você está mandando mensagens rápido demais. Espere um minutinho." },
      { key: `wa:${bot.id}:${waId}:d`, max: 300, windowSeconds: 86400, message: "Limite de mensagens por hoje atingido. Tente de novo amanhã." },
    ]);
    if (exceeded) {
      if (mode.canSend && (await noticeOnce(db, exceeded))) await say("sistema", exceeded.message, null);
      return;
    }
  }

  const transcribe = async (m: InboundMessage): Promise<string | null> => {
    const audioId = m.type === "audio" ? m.audio?.id : undefined;
    // envio bloqueado ou canal suspenso: ninguém vai ler a transcrição agora (fica o rótulo do áudio)
    if (!audioId || !canTranscribe() || mode.step <= 2) return null;
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

  /** A conversa do contato, aberta sem contar na cota (a IA não vai responder nela agora). */
  const plainConversation = async (): Promise<string | null> => {
    if (!conv) {
      const { data } = await db.from("conversations").insert({ bot_id: bot.id, channel: "whatsapp", wa_id: waId, contact_id: contactId, visitor_id: null }).select("id, takeover_at, handled_at").single<RecentConversation>();
      conv = data;
    }
    return conv?.id ?? null;
  };
  const storeAll = async (convId: string) => {
    for (let i = 0; i < burst.length; i++) await storeOnce(db, convId, shown(i), burst[i].key);
  };
  const sendFixed = async (t: string) => (await reply(t)).messages?.[0]?.id ?? null;
  /** Aviso ao contato do degrau atual, uma vez por episódio (gravado na conversa como do sistema). */
  const sendNotice = async (convId: string, notice: Mode["notice"]) => {
    const target = { contactId, conversationId: convId };
    if (!notice || !(await noticeDue(db, target, notice.reason))) return;
    const r = await say(notice.reason === "suspenso" ? "aviso_suspenso" : "sistema", notice.text, { insert: { role: "assistant", content: notice.text, author: SYSTEM_AUTHOR } }, convId);
    if (r.status === "sent") await markNoticeSent(db, target, notice.reason);
  };

  /**
   * Bot pausado pelo dono (degrau 4) ou modo só humano (5: cota, teste, plano, IA pausada pela
   * BoaVoz): a IA não responde, as mensagens ficam gravadas, vira pedido de atendente e o contato
   * recebe o texto fixo uma vez por episódio (nunca na coexistência: o dono já vê no celular).
   */
  const humanOnly = async (m: Mode) => {
    const convId = await plainConversation();
    if (!convId) return;
    await storeAll(convId);
    // risco à vida tem prioridade sobre o texto do modo só humano
    if (await handleRiskWithoutAi(db, bot, convId, texts, sendFixed, "whatsapp")) return;
    await enterHumanOnly(db, bot, convId, m.blockReason ?? "paused");
    await sendNotice(convId, m.notice);
  };

  // opt-out fixo (SAIR, PARAR, STOP e os botões da confirmação): antes de tudo, em qualquer estado;
  // a supressão vale sempre, a confirmação só sai se dá para enviar
  const optOut = await handleOptOuts(db, channel, bot, waId, burst, texts, shown, conv?.id ?? null, mode, contactId);
  if (optOut.conversationId && !conv) conv = { id: optOut.conversationId, takeover_at: null, handled_at: null };
  if (optOut.handled.size === burst.length) return;

  // degrau 1 (ordem da Meta, desligamento geral): nem grava, nada passa pela Cloud API
  if (!mode.storeInbound) return void console.warn("whatsapp: entrada descartada", mode.reason, channel.phone_number_id);
  // degraus 1 e 2: nada sai pelo canal (fora o aviso da suspensão, uma vez); fica no painel
  if (mode.step <= 2) {
    const convId = await plainConversation();
    if (!convId) return;
    await storeAll(convId);
    if (mode.step === 2) await sendNotice(convId, mode.notice);
    return;
  }

  // degrau 3, gente atendendo: o assistente fica quieto, sem "digitando…", e as mensagens vão
  // para o painel; o risco à vida ainda é vigiado (alerta urgente e texto fixo)
  if (mode.step === 3) {
    const convId = await plainConversation();
    if (!convId) return;
    await storeAll(convId);
    await handleRiskWithoutAi(db, bot, convId, texts, sendFixed, "whatsapp");
    return;
  }

  // a fila ficou parada mais de 24 h: não responde com IA, vira pedido de atendente
  if (isStale(burst[0].receivedAt)) {
    const convId = await plainConversation();
    if (!convId) return;
    await storeAll(convId);
    await db.from("conversations").update({ needs_human: true, handoff_requested_at: new Date().toISOString(), handled_at: null }).eq("id", convId);
    return;
  }

  // degraus 4 e 5: bot pausado pelo dono, ou plano, teste, cota e IA pausada (em toda mensagem)
  if (mode.handoff) return humanOnly(mode);
  // degrau 6, normal: o próximo episódio de indisponível avisa de novo
  if (conv && (contact?.unavailable_notice_reason || conv.unavailable_notice_reason)) await clearNotice(db, { contactId, conversationId: conv.id });

  // a resposta vai para a última mensagem com texto; as de antes (e a mídia) só entram no histórico
  // foto, vídeo ou documento sem legenda: a pergunta costuma vir logo atrás, em outra mensagem.
  // Se vier, esta rodada só grava, e a próxima responde tudo junto (uma resposta só)
  if (!texts[texts.length - 1] && last.msg.type !== "audio") {
    await new Promise((r) => setTimeout(r, FOLLOW_UP_WAIT_MS));
    if (await hasPendingFrom(db, "whatsapp", bot.id, waId)) {
      // a conversa nasce contando no mês, como se a IA respondesse agora (ela responde na próxima rodada)
      if (!conv) {
        try {
          conv = { id: await openConversation(db, bot, { channel: "whatsapp", waId, contactId }), takeover_at: null, handled_at: null };
        } catch {
          // cota ou teste vencido: a próxima rodada cai no modo só humano
        }
      }
      const convId = await plainConversation();
      if (convId) await storeAll(convId);
      return;
    }
  }

  const qi = texts.map((t, i) => (t && !optOut.handled.has(i) ? i : -1)).filter((i) => i >= 0).pop();
  if (qi === undefined) {
    if (optOut.handled.size) return;
    // mídia sem texto: fica no painel e o contato recebe o aviso de que só entendemos texto e áudio
    const convId = await plainConversation();
    if (convId) await storeAll(convId);
    const lastAudio = last.msg.type === "audio" && canTranscribe();
    return void (await say("ia", lastAudio ? AUDIO_FAILED : ONLY_TEXT, null));
  }
  const q = burst[qi];

  const before = await previousAnswer(db, q.key);
  if (before.state === "sent") return;
  if (before.state === "unsent") {
    await say("ia", before.content, { update: before.id });
    return;
  }

  await markReadTyping(channel, last.msg.id);
  try {
    conv ??= { id: await openConversation(db, bot, { channel: "whatsapp", waId, contactId }), takeover_at: null, handled_at: null };
    for (let i = 0; i < burst.length; i++) if (i !== qi) await storeOnce(db, conv.id, shown(i), burst[i].key);

    // portão (proibidos, 18+) e IA; a pergunta é gravada uma vez só, mesmo no reprocesso
    await answerWithGate(
      {
        db,
        bot,
        channel: "whatsapp",
        contact: waId,
        conversationId: conv.id,
        send: async (text, buttons) => {
          const body = toWhatsAppText(text);
          // mensagem com botão tem no máximo 1.024 caracteres: resposta longa vai inteira e o botão logo depois
          if (buttons && body.length > 1024) await reply(text);
          const sent = buttons ? await sendButtons(channel, waId, body.length > 1024 ? GATE_TEXTS.showAdultPrompt : body, gateButtons(buttons)) : await reply(text);
          return sent.messages?.[0]?.id ?? null;
        },
        chat: { whatsapp: { waId, profileName } },
        historySize: HISTORY,
      },
      { text: texts[qi]!, key: q.key, msgId: q.msg.id, stored: before.state === "unanswered", button: q.msg.interactive?.button_reply?.id },
    );
    // saiu depois da recusa por pagamento: o cartão entrou, o número volta ao normal
    if (channel.payment_issue_at) await db.from("whatsapp_channels").update({ payment_issue_at: null }).eq("bot_id", bot.id);
  } catch (e) {
    // sem acesso ao número ou sem pagamento: quem chamou marca (e não adianta tentar o aviso)
    if (isAccessError(e) || isPaymentError(e)) throw e;
    const code = (e as Error).message;
    // a cota acabou entre a checagem e a abertura da conversa: modo só humano, sem perder a mensagem
    if (code === "quota_exceeded" || code === "trial_expired") return humanOnly(decideMode({ ...mode.facts, humanOnly: code }));
    console.error("whatsapp: falha ao responder", e);
    await say("ia", FALLBACK, null).catch(() => {});
  }
}

/** Categoria do último modelo enviado a este contato, neste bot, nos últimos 30 dias (sem nenhum, tudo). */
async function lastTemplateKind(db: SupabaseClient, botId: string, waId: string): Promise<SuppressionKind> {
  const { data: convs } = await db.from("conversations").select("id").eq("bot_id", botId).in("wa_id", waIdVariants(waId));
  const ids = (convs ?? []).map((c) => c.id as string);
  if (!ids.length) return "all";
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await db.from("messages").select("template_category").in("conversation_id", ids).not("template_category", "is", null).gt("created_at", since).order("id", { ascending: false }).limit(1).maybeSingle();
  if (!data) return "all";
  return String(data.template_category).toUpperCase() === "MARKETING" ? "marketing" : "utility";
}

/**
 * Opt-out fixo (Termos da Meta): SAIR, PARAR ou STOP descadastram da categoria do último modelo
 * enviado (sem nenhum, de tudo), gravam a supressão e respondem a confirmação fixa, com os botões
 * "Foi engano" e, quando cabe, "Parar os lembretes"/"Parar as promoções". A conversa normal
 * continua: só mensagens iniciadas pela empresa (modelos) deixam de sair. Devolve as mensagens
 * tratadas aqui (a IA não responde a elas).
 */
async function handleOptOuts(
  db: SupabaseClient,
  channel: ChannelRow,
  bot: BotRow,
  waId: string,
  burst: QueuedMessage[],
  texts: Array<string | null>,
  shown: (i: number) => string,
  conversationId: string | null,
  mode: Pick<Mode, "canSend" | "storeInbound">,
  contactId: string | null = null,
): Promise<{ handled: Set<number>; conversationId: string | null }> {
  const handled = new Set<number>();
  const target = { channel: "whatsapp" as const, scope: suppressionScope({ wabaId: channel.waba_id, botId: bot.id }), contact: waId };
  const company = bot.client_name;
  let convId = conversationId;
  const conversation = async () => {
    // ordem da Meta e desligamento geral: a supressão vale, mas nada é gravado na conversa
    if (!mode.storeInbound) return null;
    convId ??= (await db.from("conversations").insert({ bot_id: bot.id, channel: "whatsapp", wa_id: waId, contact_id: contactId, visitor_id: null }).select("id").single()).data?.id ?? null;
    return convId;
  };
  const answer = async (content: string, buttons?: Array<{ id: string; title: string }>) => {
    // envio bloqueado ou canal suspenso: o pedido é cumprido, a confirmação não sai
    if (!mode.canSend) return;
    const id = await conversation();
    await deliver(db, {
      botId: bot.id,
      channel: "whatsapp",
      conversationId: id,
      kind: "sistema",
      record: id ? { insert: { role: "assistant", content, author: SYSTEM_AUTHOR } } : null,
      transport: async () => (buttons?.length ? await sendButtons(channel, waId, content, buttons) : await sendText(channel, waId, content)).messages?.[0]?.id ?? null,
    });
  };

  let keywordDone = false;
  for (let i = 0; i < burst.length; i++) {
    const button = burst[i].msg.interactive?.button_reply?.id ?? "";
    const keyword = isOptOutKeyword(texts[i]);
    if (!button.startsWith(`${OPTOUT_UNDO}:`) && !button.startsWith(`${OPTOUT_ALSO}:`) && !keyword) continue;
    handled.add(i);
    const id = await conversation();
    if (id) await storeOnce(db, id, shown(i), burst[i].key);

    if (button.startsWith(`${OPTOUT_UNDO}:`)) {
      // "Foi engano": desfaz todos os SAIR/PARAR/STOP ativos do contato (quem tocou espera voltar a
      // receber tudo) e fica gravado como novo opt-in dado pela própria pessoa. O que veio da Meta
      // (preferências do WhatsApp, erro 131050) continua: não foi dado por esse SAIR.
      await revoke(db, { ...target, reason: "opt_out", source: "chat:foi_engano" });
      await answer(`Tudo certo, desfiz o pedido. Você continua recebendo as mensagens da ${company}.`);
    } else if (button.startsWith(`${OPTOUT_ALSO}:`)) {
      const kind = button.slice(OPTOUT_ALSO.length + 1) === "marketing" ? "marketing" : "utility";
      await suppress(db, { ...target, kind, reason: "opt_out", source: "chat" });
      await answer(optOutConfirmation("all", company));
    } else if (!keywordDone) {
      keywordDone = true;
      const kind = await lastTemplateKind(db, bot.id, waId);
      const active = (await activeSuppressions(db, target)).map((s) => s.kind);
      const sid = await suppress(db, { ...target, kind, reason: "opt_out", source: "chat" });
      const buttons = [{ id: `${OPTOUT_UNDO}:${sid}`, title: "Foi engano" }];
      // a outra categoria só aparece se ainda estiver ativa
      const other: SuppressionKind | null = kind === "marketing" ? "utility" : kind === "utility" ? "marketing" : null;
      if (other && !active.includes(other) && !active.includes("all")) buttons.unshift({ id: `${OPTOUT_ALSO}:${other}`, title: other === "utility" ? "Parar os lembretes" : "Parar as promoções" });
      await answer(optOutConfirmation(kind, company), buttons);
    }
  }
  return { handled, conversationId: convId };
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
  const { data: bot } = await db.from("bots").select("id, agency_id").eq("id", channel.bot_id).maybeSingle();
  const contact = bot ? await whatsappContact(db, bot, whatsappIdentityOf(echo.to)) : null;
  let conv = await recentConversation(db, channel.bot_id, echo.to, contact?.id ?? null);
  if (!conv) {
    const { data: created } = await db.from("conversations").insert({ bot_id: channel.bot_id, channel: "whatsapp", wa_id: echo.to, contact_id: contact?.id ?? null, visitor_id: null }).select("id, takeover_at, handled_at").single();
    conv = created;
  }
  if (!conv) return;
  const { data, error } = await db.from("messages").upsert({ conversation_id: conv.id, role: "agent", content, author: PHONE_AUTHOR, inbound_key: key }, { onConflict: "inbound_key", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(`mensagem não gravada: ${error.message}`);
  if (!data?.length) return;
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id);
  await db.from("conversations").update({ last_message_at: new Date().toISOString(), message_count: count ?? 0 }).eq("id", conv.id);
}
