import { handlePairing, linkColumnsForContact } from "./pairing";
import { handleErasureRequest } from "./data-subject";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SYSTEM_AUTHOR, handleRiskWithoutAi, enterHumanOnly, openConversation, requestHandoff, type BotRow } from "./chat";
import { clearNotice, decideMode, markNoticeSent, noticeDue, resolveMode, withoutAi, type Mode } from "./conversation-mode";
import { botHasAi } from "./plans";
import { deliver, type SendKind, type SendRecord } from "./send";
import { instagramContact, touchInbound } from "./contacts";
import { DELETED_LABEL, deletedBeforeArrival, sharedRef, sharedText } from "./instagram-edits";
import { requireAtendimento } from "./atendimentos";
import { findMessage, saveMessage, updateMessages } from "./messages";
import { maskCardNumbers } from "./routine-run";
import { endActiveRoutine } from "./routine-engine";
import { clearUnseen, igUnseenKind, markUnseen, recentUnseen, unseenMediaText, type UnseenMark } from "./unseen-media";
import { hasPendingFrom, isRearmed, markOwnMessage } from "./inbound-queue";
import { OPTOUT_UNDO, isOptOutKeyword, optOutConfirmation, queueUndoEvents, revoke, suppress, suppressionScope } from "./suppression";
import { canReadPhotos, canTranscribe, transcribeAudio } from "./ai";
import { fixedPhotoReply, photoReadingOn, photoSeen, withHandoffNotice, type PhotoReading } from "./photo-note";
import { readBurstPhotos } from "./photo-reading";
import { fetchIgMedia } from "./media-capture";
import { recordAiUsage } from "./ai-usage";
import { firstExceeded, noticeOnce } from "./rate-limit";
import { instagramTyping, isInstagramAccessError, mediaPermalink, sendInstagramAttachment, sendInstagramTemplate, sendInstagramText, splitDm, toInstagramText, type IgChannel } from "./instagram";
import { AUDIO_PREFIX, isStale, previousAnswer, storeOnce } from "./whatsapp-inbound";
import { answerWithGate, gateButtons } from "./gate/flow";
import { choicesOf, instagramCarouselText, instagramLinkText, instagramPlan, instagramTemplate, type MessageComponent } from "./components";

/** Até quando uma mensagem nova continua a conversa anterior (a janela de resposta do Instagram). */
const RESUME_HOURS = 24;
const MAX_MESSAGE_CHARS = 2000;
const HISTORY = 12;

const FALLBACK = "No momento não consigo responder por aqui. A equipe vai retornar sua mensagem em breve.";
const ONLY_TEXT = "Por enquanto eu entendo mensagens de texto e áudios. Fotos e vídeos ainda não. Pode escrever sua dúvida?";
/** Com a leitura de fotos ligada (leva de leitura de fotos). */
const ONLY_TEXT_PHOTOS = "Por enquanto eu entendo texto, áudios e fotos. Vídeos ainda não. Pode escrever sua dúvida?";
const AUDIO_FAILED = "Não consegui entender o áudio. Pode mandar de novo ou escrever?";
/** Texto fixo que sai ao contato e também fica na conversa do painel (como do sistema). */
const fixedRecord = (content: string): SendRecord => ({ insert: { role: "assistant", content, author: SYSTEM_AUTHOR } });

export { IG_APP_AUTHOR } from "./authors";
import { IG_APP_AUTHOR } from "./authors";

const IG_MEDIA_LABEL: Record<string, string> = {
  image: "📷 (foto)",
  video: "🎬 (vídeo)",
  audio: "🎤 (áudio)",
  file: "📄 (arquivo)",
  share: "(publicação compartilhada)",
  story_mention: "(menção nos stories)",
  ig_reel: "(reel)",
  reel: "(reel)",
  ig_post: "(publicação compartilhada)",
  post: "(publicação compartilhada)",
  ig_story: "(story compartilhado)",
  story: "(story compartilhado)",
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
    /** Anexos: mídia, e post (ig_post) ou reel (ig_reel) compartilhado, com o id e a legenda. */
    attachments?: Array<{ type?: string; payload?: { url?: string; title?: string; id?: string; reel_video_id?: string } }>;
    quick_reply?: { payload?: string };
    /** Primeira mensagem depois de abrir um link ig.me/<usuário>?ref=… */
    referral?: { ref?: string };
  };
  postback?: { mid?: string; title?: string; payload?: string; referral?: { ref?: string } };
  /** A pessoa abriu um link ig.me/<usuário>?ref=… numa conversa que já existe (messaging_referral). */
  referral?: { ref?: string; source?: string; type?: string };
  /** A pessoa editou uma DM já enviada (webhook message_edit). */
  message_edit?: { mid?: string; text?: string; num_edit?: number | string };
}

export interface IgChannelRow extends IgChannel {
  bot_id: string;
  disconnected_at?: string | null;
}

/** ref do link ig.me (pareamento, P2), venha na mensagem, no botão ou no evento de referral. */
export const igRef = (ev: IgMessagingEvent): string | null => {
  const r = ev.referral?.ref ?? ev.message?.referral?.ref ?? ev.postback?.referral?.ref;
  return r && /^[A-Za-z0-9]{4,32}$/.test(r) ? r : null;
};

/**
 * Id do botão tocado: resposta rápida (quick_reply.payload) ou botão de card do carrossel
 * (postback.payload, generic template). null se não foi botão.
 */
export const igButtonId = (ev: IgMessagingEvent): string | null => ev.message?.quick_reply?.payload ?? ev.postback?.payload ?? null;

/** Texto da mensagem (texto ou botão tocado); null para mídia. */
export function igText(ev: IgMessagingEvent): string | null {
  const t = ev.message?.text ?? ev.postback?.title;
  return t?.trim() ? t.trim() : null;
}

export function igMediaLabel(ev: IgMessagingEvent): string {
  const type = ev.message?.attachments?.[0]?.type ?? "";
  if (IG_MEDIA_LABEL[type]) return IG_MEDIA_LABEL[type];
  return type ? `(anexo do Instagram: ${type})` : "(mensagem sem texto)";
}

/** Depois de um post, reel ou mídia sem texto, a pessoa costuma mandar o comentário em outra DM, logo atrás. */
const FOLLOW_UP_WAIT_MS = 3500;

/** Conversa recente do contato com o chatbot (dentro da janela de 24 h). */
async function recentConversation(db: SupabaseClient, botId: string, igsid: string, contactId: string | null = null): Promise<RecentConversation | null> {
  const since = new Date(Date.now() - RESUME_HOURS * 3_600_000).toISOString();
  const recent = () => db.from("conversations").select("id, takeover_at, handled_at, ai_paused_until, unavailable_notice_reason, contact_id, unseen_media_at, unseen_media_kind").eq("bot_id", botId).gt("last_message_at", since).order("last_message_at", { ascending: false }).limit(1);
  if (contactId) {
    const { data } = await recent().eq("contact_id", contactId).maybeSingle<RecentConversation>();
    if (data) return data;
  }
  // conversa de antes dos contatos: pelo IGSID, e ela já passa a apontar para o contato
  const { data } = await recent().eq("ig_id", igsid).maybeSingle<RecentConversation>();
  if (data && contactId && !data.contact_id) {
    await db.from("conversations").update({ contact_id: contactId }).eq("id", data.id);
    data.contact_id = contactId;
  }
  return data;
}

interface RecentConversation extends UnseenMark {
  id: string;
  contact_id?: string | null;
  takeover_at: string | null;
  handled_at: string | null;
  /** IA pausada pela integração até (API). */
  ai_paused_until?: string | null;
  /** Aviso de indisponível já enviado neste episódio (zera quando volta ao normal). */
  unavailable_notice_reason?: string | null;
}

/** Manda a DM e guarda o id dela: o webhook ecoa as nossas mensagens, e assim o eco é ignorado. */
export async function send(db: SupabaseClient, ch: IgChannelRow, to: string, text: string, quickReplies?: Array<{ title: string; payload: string }>, opts: { humanAgent?: boolean; timeoutMs?: number } = {}): Promise<string | null> {
  // resposta longa: até 3 DMs cortadas no fim de um parágrafo (as respostas rápidas vão na última)
  const parts = splitDm(text);
  let mid: string | null = null;
  for (let i = 0; i < parts.length; i++) {
    mid = await sendInstagramText(ch, to, parts[i], i === parts.length - 1 ? quickReplies : undefined, opts);
    if (mid) await markOwnMessage(db, `ig:echo:${mid}`, "instagram");
  }
  return mid;
}

/**
 * Carrossel no Instagram (parte 5d-2): o texto, os cards (generic template, só no app) e o resumo
 * numerado numa DM própria, para quem está no instagram.com pelo computador (lá os cards não
 * aparecem). Se o template falhar, o resumo ainda vai. Devolve o id da última DM.
 */
export async function sendCarousel(db: SupabaseClient, ch: IgChannelRow, to: string, text: string, c: Extract<MessageComponent, { type: "carousel" }>, opts: { timeoutMs?: number } = {}): Promise<string | null> {
  if (text.trim()) await send(db, ch, to, text, undefined, opts);
  try {
    const mid = await sendInstagramTemplate(ch, to, instagramTemplate(c), opts);
    if (mid) await markOwnMessage(db, `ig:echo:${mid}`, "instagram");
  } catch (e) {
    console.warn("instagram: cards do carrossel não foram", (e as Error).message);
  }
  if (!choicesOf(c).length) return send(db, ch, to, instagramCarouselText("", c), undefined, opts);
  const plan = instagramPlan(c);
  return send(db, ch, to, plan.summary, plan.quickReplies, opts);
}

async function transcribeFrom(url: string, onUsage?: Parameters<typeof transcribeAudio>[1]): Promise<string | null> {
  // safeFetch (nunca um endereço interno), com limite de tamanho
  const file = await fetchIgMedia(url);
  if (!file) throw new Error("áudio grande demais");
  const transcript = await transcribeAudio(file.data, onUsage);
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
 * à última com texto. Quem responde (IA, equipe ou ninguém) sai da regra única de estado
 * (conversation-mode). Erro de acesso (token recusado) sobe para quem chamou marcar a conta.
 */
export async function handleInstagramBurst(db: SupabaseClient, ch: IgChannelRow, all: QueuedDm[]) {
  // mensagem não suportada (enquete, efeito…) e apagada não recebem resposta
  const burst = all.filter((q) => (q.ev.message?.mid ?? q.ev.postback?.mid ?? igRef(q.ev)) && q.ev.sender?.id && !q.ev.message?.is_deleted && !q.ev.message?.is_unsupported);
  if (!burst.length) return;
  const { data: bot } = await db.from("bots").select("*").eq("id", ch.bot_id).maybeSingle<BotRow>();
  if (!bot) return console.warn("instagram: chatbot não encontrado", ch.bot_id);
  if (bot.status !== "live") return console.log("instagram: chatbot não publicado, DM ignorada", bot.id);
  const igsid = burst[0].ev.sender!.id!;
  console.log("instagram: DMs recebidas", { bot: bot.id, quantidade: burst.length });

  // o contato (pelo IGSID, em hash) e a conversa recente dele; "já conversou" e a janela de 24 h
  const contact = await instagramContact(db, bot, igsid);
  const contactId = contact?.id ?? null;
  let conv = await recentConversation(db, bot.id, igsid, contactId);
  // chatbot sem IA (Atendimento ou sem tamanho): tudo vai para a equipe, sem IA nenhuma (nem transcrição)
  const resolved = await resolveMode(db, { bot, channel: "instagram", conversation: conv, ig: ch });
  const mode = botHasAi(bot) ? resolved : withoutAi(resolved);
  // nada de IA (nem transcrição; o risco só pelo dicionário): chatbot sem IA ou pagamento em aberto
  const aiOff = !botHasAi(bot) || resolved.facts.humanOnly === "past_due";
  // leitura de fotos: só com a IA respondendo, em chatbot com IA, fora do modo dados sensíveis
  const photosOn = photoReadingOn({ enabled: canReadPhotos(), hasAi: botHasAi(bot), sensitive: Boolean(bot.sensitive_mode), aiResponds: mode.aiResponds, aiOff });
  // a pergunta pendente rearmada na volta da IA não é mensagem nova do contato
  if (contact && mode.storeInbound && !burst.every((q) => isRearmed(q.ev.message?.mid))) await touchInbound(db, contact);

  const reply = (text: string) => send(db, ch, igsid, text);
  /** Texto pela camada única de envio: regra de estado na hora do envio e registro na conversa. */
  const say = (kind: SendKind, text: string, record: SendRecord, conversationId: string | null = conv?.id ?? null, quickReplies?: Array<{ title: string; payload: string }>) =>
    deliver(db, { botId: bot.id, channel: "instagram", conversationId, kind, record, transport: () => send(db, ch, igsid, text, quickReplies) });
  for (let i = 0; i < burst.length; i++) {
    const exceeded = await firstExceeded(db, [
      { key: `ig:${bot.id}:${igsid}:m`, max: 15, windowSeconds: 60, message: "Você está mandando mensagens rápido demais. Espere um minutinho." },
      { key: `ig:${bot.id}:${igsid}:d`, max: 300, windowSeconds: 86400, message: "Limite de mensagens por hoje atingido. Tente de novo amanhã." },
    ]);
    if (exceeded) {
      if (mode.canSend && (await noticeOnce(db, exceeded))) await say("sistema", exceeded.message, conv ? fixedRecord(exceeded.message) : null);
      return;
    }
  }

  const transcribe = async (ev: IgMessagingEvent) => {
    const audioUrl = ev.message?.attachments?.find((a) => a.type === "audio")?.payload?.url;
    // envio bloqueado ou canal suspenso: ninguém vai ler a transcrição agora (fica o rótulo do áudio);
    // sem IA (chatbot sem IA ou pagamento em aberto): a equipe ouve o áudio na conversa
    if (!audioUrl || !canTranscribe() || mode.step <= 2 || aiOff) return null;
    try {
      return await transcribeFrom(audioUrl, (u) => void recordAiUsage(db, { agencyId: bot.agency_id, botId: bot.id, kind: "transcricao", channel: "instagram", ...u }));
    } catch (e) {
      console.error("instagram: áudio não transcrito", e);
      return null;
    }
  };
  // DM desfeita antes de chegar (o aviso veio primeiro): grava já apagada e não responde
  const deleted = await deletedBeforeArrival(db, burst.map((q) => q.key));
  // post ou reel compartilhado: o assistente lê a legenda; a referência fica na mensagem
  const refs = burst.map((q) => sharedRef(q.ev));
  await Promise.all(refs.map(async (r) => r?.id && (r.permalink = await mediaPermalink(ch, r.id))));
  const unknown = burst.flatMap((q) => (q.ev.message?.attachments ?? []).map((a) => a.type ?? "?")).filter((t) => !IG_MEDIA_LABEL[t] && t !== "image" && t !== "audio");
  if (unknown.length) console.log("instagram: anexos não reconhecidos", unknown);
  const texts: Array<string | null> = [];
  for (const [i, q] of burst.entries()) {
    if (deleted.has(q.key)) {
      texts.push(null);
      continue;
    }
    // link ig.me com ?ref= aberto sem texto: fica na conversa como "Conectar REF"
    const ref = igRef(q.ev);
    const typed = [igText(q.ev), refs[i] ? sharedText(refs[i]!) : null].filter(Boolean).join("\n") || (ref ? `Conectar ${ref}` : null);
    // número de cartão sai antes de gravar e antes da IA (também o dito no áudio)
    const t = (typed ?? (await transcribe(q.ev)))?.slice(0, MAX_MESSAGE_CHARS) ?? null;
    texts.push(t === null ? null : maskCardNumbers(t).text);
  }
  const shown = (i: number) => (deleted.has(burst[i].key) ? DELETED_LABEL : (texts[i] ?? igMediaLabel(burst[i].ev)));
  /** Depois de gravar: a referência do post ou reel e a marca de apagada nas mensagens. */
  const afterStore = async () => {
    for (const [i, q] of burst.entries()) {
      // falha aqui não derruba a resposta (já saiu): só a marca fica para trás
      if (deleted.has(q.key)) await updateMessages(db, { inboundKey: q.key }, { deleted_at: new Date().toISOString() }, { notDeleted: true }).catch((e) => console.error("instagram: marca de apagada", e));
      else if (refs[i]) await updateMessages(db, { inboundKey: q.key }, { channel_ref: refs[i] }, { withoutRef: true }).catch((e) => console.error("instagram: referência do post", e));
    }
  };

  /** Fotos lidas pela IA, por posição na rajada (gravadas junto da mensagem). */
  let photos = new Map<number, PhotoReading[]>();

  /** A conversa do contato, aberta sem contar na cota (a IA não vai responder nela agora). */
  const plainConversation = async (): Promise<string | null> => {
    if (!conv) {
      const { data } = await db.from("conversations").insert({ bot_id: bot.id, channel: "instagram", ig_id: igsid, contact_id: contactId, visitor_id: null, ...(await linkColumnsForContact(db, contactId)) }).select("id, takeover_at, handled_at").single<RecentConversation>();
      conv = data;
    }
    return conv?.id ?? null;
  };
  const storeAll = async (convId: string) => {
    for (let i = 0; i < burst.length; i++) await storeOnce(db, convId, shown(i), burst[i].key, photos.get(i));
    await afterStore();
  };
  /** Mensagem do sistema (confirmação, aviso): só sai se dá para enviar; gravada na conversa. */
  const systemReply = async (convId: string | null, content: string, quickReplies?: Array<{ title: string; payload: string }>) => {
    if (!mode.canSend) return;
    await say("sistema", content, convId ? { insert: { role: "assistant", content, author: SYSTEM_AUTHOR } } : null, convId, quickReplies);
  };
  /** Aviso ao contato do degrau atual, uma vez por episódio (o da suspensão sai mesmo sem envio). */
  const sendNotice = async (convId: string, notice: Mode["notice"]) => {
    const target = { contactId, conversationId: convId };
    if (!notice || !(await noticeDue(db, target, notice.reason))) return;
    const r = await say(notice.reason === "suspenso" ? "aviso_suspenso" : "sistema", notice.text, { insert: { role: "assistant", content: notice.text, author: SYSTEM_AUTHOR } }, convId);
    if (r.status === "sent") await markNoticeSent(db, target, notice.reason);
  };

  /** Bot pausado pelo dono (4) ou modo só humano (5): grava, vira pedido de atendente, texto fixo uma vez. */
  const humanOnly = async (m: Mode) => {
    const convId = await plainConversation();
    if (!convId) return;
    await storeAll(convId);
    // risco à vida tem prioridade sobre o texto do modo só humano
    if (await handleRiskWithoutAi(db, bot, convId, texts, reply, "instagram", !aiOff)) return;
    await enterHumanOnly(db, bot, convId, m.blockReason ?? "paused");
    await sendNotice(convId, m.notice);
  };

  // opt-out fixo (SAIR, PARAR, STOP) e o "Foi engano": antes de tudo, em qualquer estado; vale
  // para tudo no Instagram. A supressão vale sempre; a confirmação só sai se dá para enviar.
  const target = { channel: "instagram" as const, scope: suppressionScope({ botId: bot.id }), contact: igsid };
  const undo = new Set(burst.map((q, i) => (q.ev.message?.quick_reply?.payload === OPTOUT_UNDO ? i : -1)).filter((i) => i >= 0));
  if (undo.size) {
    const convId = await plainConversation();
    if (convId) for (const i of undo) await storeOnce(db, convId, shown(i), burst[i].key);
    await queueUndoEvents(db, target, await revoke(db, { ...target, reason: "opt_out", source: "chat:foi_engano" }));
    await systemReply(convId, `Tudo certo, desfiz o pedido. Você continua recebendo as mensagens da ${bot.client_name}.`);
  }
  const handled = new Set(texts.map((t, i) => (isOptOutKeyword(t) || undo.has(i) ? i : -1)).filter((i) => i >= 0));
  if (handled.size > undo.size) {
    const convId = await plainConversation();
    if (convId) for (const i of handled) await storeOnce(db, convId, shown(i), burst[i].key);
    await suppress(db, { ...target, kind: "all", reason: "opt_out", source: "chat" });
    await systemReply(convId, optOutConfirmation("all", bot.client_name), [{ title: "Foi engano", payload: OPTOUT_UNDO }]);
  }
  if (handled.size === burst.length) return;

  // degraus 1 e 2 (conta desconectada, suspensão pela BoaVoz): nada sai pelo canal, fora o aviso
  // da suspensão (uma vez); as mensagens ficam no painel
  if (mode.step <= 2) {
    const convId = await plainConversation();
    if (!convId) return;
    await storeAll(convId);
    if (mode.step === 2) await sendNotice(convId, mode.notice);
    return;
  }

  // pareamento (P2): o ref do link ig.me ou "Conectar ABC123" digitado, a confirmação e "desconectar"
  const paired = await handlePairing(
    {
      db,
      bot,
      channel: "instagram",
      contactId,
      phone: null,
      conversation: plainConversation,
      store: async (i, convId) => {
        await storeOnce(db, convId, shown(i), burst[i].key);
      },
      reply: (convId, text, buttons) => systemReply(convId, text, buttons?.map((b) => ({ title: b.title, payload: b.id }))),
    },
    burst.map((q, i) => {
      if (handled.has(i)) return { text: null, buttonId: null };
      const ref = igRef(q.ev);
      return { text: ref ? `Conectar ${ref}` : texts[i], buttonId: igButtonId(q.ev) };
    }),
  );
  for (const i of paired) handled.add(i);
  if (handled.size === burst.length) return;

  // pedido do titular (LGPD): "apaga meus dados", a pergunta e a resposta (respostas rápidas ou
  // "sim" digitado); a IA não responde a essas mensagens
  const erasure = await handleErasureRequest(
    {
      db,
      bot,
      channel: "instagram",
      contactId,
      currentConversation: conv?.id ?? null,
      conversation: plainConversation,
      store: async (i, convId) => {
        await storeOnce(db, convId, shown(i), burst[i].key);
      },
      reply: (convId, text, buttons) => systemReply(convId, text, buttons?.map((b) => ({ title: b.title, payload: b.id }))),
    },
    burst.map((q, i) => (handled.has(i) ? { text: null, buttonId: null } : { text: texts[i], buttonId: igButtonId(q.ev) })),
  );
  for (const i of erasure) handled.add(i);
  if (handled.size === burst.length) return;

  // degrau 3, gente atendendo: só guarda para o painel; o risco à vida ainda é vigiado
  if (mode.step === 3) {
    const convId = await plainConversation();
    if (!convId) return;
    await storeAll(convId);
    await handleRiskWithoutAi(db, bot, convId, texts, reply, "instagram", !aiOff);
    return;
  }

  if (isStale(burst[0].receivedAt)) {
    const convId = await plainConversation();
    if (!convId) return;
    await storeAll(convId);
    await db.from("conversations").update({ needs_human: true, handoff_requested_at: new Date().toISOString(), handled_at: null }).eq("id", convId);
    return;
  }

  // degraus 4 e 5: bot pausado pelo dono, ou plano, teste e IA pausada (em toda mensagem); a cota do
  // mês é do atendimento, conferida logo antes de chamar a IA
  if (mode.handoff) return humanOnly(mode);
  // aviso de indisponível já dado: sai quando a IA voltar a responder (o próximo episódio avisa de novo)
  const noticeMarked = Boolean(contact?.unavailable_notice_reason || conv?.unavailable_notice_reason);

  // fotos (leva de leitura de fotos): com a IA respondendo, cada foto da DM vira uma descrição
  // curta, lida antes da resposta (photo-reading.ts); vídeo, arquivo, story e post seguem como antes
  const readStarted = Date.now();
  const photoSlots = photosOn
    ? burst.flatMap((q, i) => {
        if (handled.has(i) || deleted.has(q.key)) return [];
        const urls = (q.ev.message?.attachments ?? []).filter((a) => a.type === "image" && a.payload?.url).map((a) => a.payload!.url!);
        return urls.length ? [{ index: i, key: q.key, fetchers: urls.map((url) => async () => (await fetchIgMedia(url))?.data ?? null) }] : [];
      })
    : [];
  if (photoSlots.length) {
    const convId = await plainConversation();
    if (!convId) return;
    const read = await readBurstPhotos(db, { bot, channel: "instagram", contactKey: contactId ?? igsid, conversationId: convId, slots: photoSlots });
    // cada foto conta como uma resposta do atendimento: sem vaga, nenhuma é lida e a IA não responde
    if (read.blocked) return humanOnly(decideMode({ ...mode.facts, humanOnly: "quota_exceeded" }));
    photos = read.readings;
    // comprovante, documento pessoal, saúde ou imagem imprópria: texto fixo, sem IA; os três
    // primeiros viram pedido de atendente (a IA nunca confirma pagamento)
    const fixed = fixedPhotoReply(photos.values());
    if (fixed) {
      await storeAll(convId);
      const text = withHandoffNotice(fixed.text, fixed.handoff ? await requestHandoff(db, bot, convId, fixed.handoff) : null);
      await say("ia", text, fixedRecord(text), convId);
      return;
    }
  }
  /** A IA responde a esta mensagem: tem texto, ou é foto que ela leu. */
  const answerable = (i: number) => !handled.has(i) && Boolean(texts[i] || photoSeen(photos.get(i)));

  // compartilhou um post ou reel, ou mandou mídia, sem escrever nada: o comentário costuma vir logo
  // atrás, em outra DM. Se vier, esta rodada só grava, e a próxima responde tudo junto (uma resposta)
  const lastEv = burst[burst.length - 1].ev;
  // foto (que não deu para ler), vídeo, arquivo, story ou post sem legenda: o último desta rajada
  const burstUnseen =
    burst
      .map((q, i) => {
        if (handled.has(i) || deleted.has(q.key)) return null;
        const atts = q.ev.message?.attachments;
        return igUnseenKind(photoSeen(photos.get(i)) ? atts?.filter((a) => a.type !== "image") : atts);
      })
      .filter((k) => k !== null)
      .pop() ?? null;
  if (!igText(lastEv) && lastEv.message?.attachments?.length && !deleted.has(burst[burst.length - 1].key)) {
    // a leitura das fotos já levou parte da espera
    await new Promise((r) => setTimeout(r, Math.max(0, FOLLOW_UP_WAIT_MS - (Date.now() - readStarted))));
    if (await hasPendingFrom(db, "instagram", bot.id, igsid)) {
      const convId = await plainConversation();
      if (convId) await storeAll(convId);
      // a pergunta deve vir na próxima rodada: ela recebe o texto fixo, não uma resposta chutada
      if (convId && burstUnseen) await markUnseen(db, convId, burstUnseen);
      return;
    }
  }

  // mídia que o assistente não vê (nesta rajada, ou chegou há menos de 2 minutos): não responde à
  // pergunta sobre ela (seria chute); pede para a pessoa escrever o que é
  const unseen = burstUnseen ?? recentUnseen(conv);
  if (unseen) {
    const convId = await plainConversation();
    if (!convId) return;
    await storeAll(convId);
    const text = unseenMediaText(unseen, { photosOn });
    const r = await say("ia", text, fixedRecord(text), convId);
    if (r.status === "sent") await clearUnseen(db, convId);
    return;
  }

  const qi = burst.map((_, i) => (answerable(i) ? i : -1)).filter((i) => i >= 0).pop();
  if (qi === undefined) {
    // opt-out tratado, ou DM desfeita antes de chegar: nada a responder
    if (handled.size || deleted.size) return;
    // foto ou vídeo sem texto: fica no painel e o contato recebe o aviso de que só entendemos texto e áudio
    const convId = await plainConversation();
    if (convId) await storeAll(convId);
    const lastAudio = Boolean(lastEv.message?.attachments?.some((a) => a.type === "audio")) && canTranscribe();
    const fixed = lastAudio ? AUDIO_FAILED : photosOn ? ONLY_TEXT_PHOTOS : ONLY_TEXT;
    return void (await say("ia", fixed, convId ? fixedRecord(fixed) : null, convId));
  }
  const q = burst[qi];

  const before = await previousAnswer(db, q.key);
  if (before.state === "sent") return;
  if (before.state === "unsent") {
    await say("ia", before.content, { update: before.id });
    return;
  }

  try {
    conv ??= { id: await openConversation(db, bot, { channel: "instagram", igsid, contactId }), takeover_at: null, handled_at: null };
    // cota do mês: o atendimento deste contato (24 horas) abre antes de chamar a IA; sem vaga, lança
    // e cai no modo só humano (no catch)
    await requireAtendimento(db, bot, { channel: "instagram", contactKey: contactId ?? igsid, conversationId: conv.id });
    if (noticeMarked) await clearNotice(db, { contactId, conversationId: conv.id });
    await instagramTyping(ch, igsid);
    for (let i = 0; i < burst.length; i++) if (i !== qi) await storeOnce(db, conv.id, shown(i), burst[i].key, photos.get(i));

    // portão (proibidos, 18+) e IA; a pergunta é gravada uma vez só, mesmo no reprocesso
    await answerWithGate(
      {
        db,
        bot,
        channel: "instagram",
        contact: igsid,
        conversationId: conv.id,
        send: async (text, buttons, component) => {
          // link: no texto (o botão de link não aparece no instagram.com pelo computador)
          if (component?.type === "link") return send(db, ch, igsid, instagramLinkText(text, component));
          // carrossel (parte 5d-2): o texto, os cards e o resumo numerado
          if (component?.type === "carousel") return sendCarousel(db, ch, igsid, text, component);
          // opções (leva B1'): o texto, e o resumo numerado numa DM própria com as respostas rápidas
          if (component?.type === "options") {
            const plan = instagramPlan(component);
            if (text.trim()) await send(db, ch, igsid, text);
            return send(db, ch, igsid, plan.summary, plan.quickReplies);
          }
          return send(db, ch, igsid, text, buttons ? gateButtons(buttons).map((b) => ({ title: b.title, payload: b.id })) : undefined);
        },
        // anexo devolvido por uma ação; o eco volta pelo webhook e é nosso (não é o app do Instagram)
        sendFile: async (f) => {
          const mid = await sendInstagramAttachment(ch, igsid, { type: f.kind === "image" ? "image" : "file", url: f.url });
          if (mid) await markOwnMessage(db, `ig:echo:${mid}`, "instagram");
          return mid;
        },
        chat: { instagram: { igsid } },
        historySize: HISTORY,
        // passo de foto do roteiro (parte 2d): só com a leitura de fotos valendo agora
        photosOn,
      },
      {
        text: shown(qi),
        key: q.key,
        msgId: q.key,
        stored: before.state === "unanswered",
        button: igButtonId(q.ev),
        alone: burst.filter((_, i) => answerable(i)).length === 1,
        photos: photos.get(qi) ?? null,
        // roteiro (B2'): o dado pode ter vindo numa mensagem anterior da rajada
        texts: burst.flatMap((_, i) => (answerable(i) && texts[i] ? [texts[i]!] : [])),
        // e a foto do passo também (parte 2d)
        photoReadings: burst.flatMap((_, i) => (answerable(i) ? (photos.get(i) ?? []) : [])),
      },
    );
    await afterStore();
  } catch (e) {
    if (isInstagramAccessError(e)) throw e;
    const code = (e as Error).message;
    // sem vaga na cota do chatbot (ou sem tamanho): modo só humano, sem perder a mensagem
    if (code === "quota_exceeded") return humanOnly(decideMode({ ...mode.facts, humanOnly: code }));
    console.error("instagram: falha ao responder", e);
    await say("ia", FALLBACK, conv ? fixedRecord(FALLBACK) : null).catch(() => {});
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
  const { data: botRow } = await db.from("bots").select("id, agency_id").eq("id", ch.bot_id).maybeSingle();
  const contact = botRow ? await instagramContact(db, botRow, igsid) : null;
  let conv = await recentConversation(db, ch.bot_id, igsid, contact?.id ?? null);
  if (conv) {
    // reserva, caso o eco chegue antes de guardarmos o id: é a mesma frase que acabamos de mandar?
    const last = await findMessage(db, { conversationId: conv.id, roles: ["assistant", "agent"], newestFirst: true }, ["content", "created_at"] as const);
    if (last && toInstagramText(last.content) === content && Date.now() - new Date(last.created_at).getTime() < 5 * 60_000) return;
  } else {
    const { data: created } = await db.from("conversations").insert({ bot_id: ch.bot_id, channel: "instagram", ig_id: igsid, contact_id: contact?.id ?? null, visitor_id: null }).select("id, takeover_at, handled_at").single();
    conv = created;
  }
  if (!conv) return;
  await saveMessage(db, { conversation_id: conv.id, role: "agent", content, author: IG_APP_AUTHOR, inbound_key: key }, { touch: "equipe" });
  // a equipe respondeu pelo app: o roteiro em andamento acaba (B2')
  await endActiveRoutine(db, conv.id, "handoff");
}
