import type { SupabaseClient } from "@supabase/supabase-js";
import { HUMAN_ONLY_NOTICE, aiBlockedReason, type AiBlockReason } from "./chat";
import { IG_APP_AUTHOR, PHONE_AUTHOR, phonePauseActive } from "./authors";

/*
 * Regra única de estado da conversa (L1; spec "Estados da conversa e precedência"): decide se a
 * IA responde, se a equipe pode enviar e se o contato recebe aviso. Calculada na hora, a partir
 * das fontes (sem coluna "modo" gravada). O primeiro degrau que se aplica vence:
 *   1. Envio bloqueado: canal desconectado; ordem da Meta e desligamento geral (só WhatsApp; a
 *      entrada nem grava); número sem pagamento na Meta (grava e testa de novo depois de 1 hora)
 *   2. Suspensão pela BoaVoz (enforcement_actions): nada sai, nem resposta da equipe pelo painel
 *   3. Humano na conversa: "Assumir" ou resposta pelo celular/app há menos de 1 hora
 *   4. Bot pausado pelo dono (botão de emergência): aviso só se ele pediu
 *   5. Modo só humano: cota, teste vencido, assinatura cancelada, IA pausada pela BoaVoz
 *   6. Normal
 * O opt-out (SAIR, PARAR, STOP) roda antes de todos; a confirmação só sai se dá para enviar.
 * Risco à vida nunca roda nos degraus 1 e 2; nos 3 a 5, dispara o texto fixo de emergência.
 */

export type ModeChannel = "whatsapp" | "instagram" | "widget";
export type ModeState = "envio_bloqueado" | "suspenso" | "humano" | "bot_pausado" | "so_humano" | "normal";
export type NoticeReason = "suspenso" | "bot_pausado" | "so_humano";

/** Texto fixo do canal suspenso pela BoaVoz (uma vez por episódio). */
export const SUSPENDED_NOTICE = "No momento este canal está indisponível. Para falar com a empresa, use outro canal de atendimento dela.";

export interface ModeFacts {
  channel: ModeChannel;
  /** Canal da Meta desconectado (sem token ou o cliente tirou o acesso). */
  channelDisconnected: boolean;
  /** Ordem da Meta ativa para este número (só WhatsApp). */
  metaOrder: boolean;
  /** Desligamento geral do WhatsApp de todos os clientes (plano B da Meta). */
  whatsappDisabled: boolean;
  /** Meta recusando por falta de pagamento há menos de 1 hora (131042). */
  metaPaymentIssue: boolean;
  /** Medida da BoaVoz bloqueando este canal (agência, bot ou todos os canais). */
  boavozSuspended: boolean;
  /** Alguém da equipe assumiu, ou respondeu pelo celular/app há menos de 1 hora. */
  humanInConversation: boolean;
  /** Pausa pelo dono (botão de emergência). */
  botPaused: boolean;
  botPauseNotify: boolean;
  /** Plano, teste, cota ou IA pausada pela BoaVoz. */
  humanOnly: AiBlockReason | null;
  /** Número também no app WhatsApp Business do celular: o dono já vê tudo, nunca há aviso. */
  coexistence: boolean;
}

export interface Mode {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  state: ModeState;
  /** Motivo curto (para log, painel e o pedido de atendente). */
  reason: string;
  aiResponds: boolean;
  /** A equipe (painel, portal) e o BoaVoz podem enviar por este canal. */
  canSend: boolean;
  /** A mensagem que chegou é gravada (na ordem da Meta e no desligamento geral, nem isso). */
  storeInbound: boolean;
  /** Vigia de risco à vida (texto fixo de emergência). */
  riskWatch: boolean;
  /** Vira pedido de atendente automático (equipe avisada). */
  handoff: boolean;
  /** Aviso ao contato, uma vez por episódio. */
  notice: { reason: NoticeReason; text: string } | null;
  /** Motivo do modo só humano/pausa, para o texto do pedido de atendente. */
  blockReason: AiBlockReason | null;
}

const base = { aiResponds: false, canSend: true, storeInbound: true, riskWatch: true, handoff: false, notice: null, blockReason: null } satisfies Partial<Mode>;

/** O degrau, a partir dos fatos. Função pura: a mesma decisão na entrada e antes de cada envio. */
export function decideMode(f: ModeFacts): Mode {
  const wa = f.channel === "whatsapp";
  if (wa && f.metaOrder) return { ...base, step: 1, state: "envio_bloqueado", reason: "ordem da Meta", canSend: false, storeInbound: false, riskWatch: false };
  if (wa && f.whatsappDisabled) return { ...base, step: 1, state: "envio_bloqueado", reason: "WhatsApp desligado para todos (BoaVoz)", canSend: false, storeInbound: false, riskWatch: false };
  if (f.channel !== "widget" && f.channelDisconnected) return { ...base, step: 1, state: "envio_bloqueado", reason: "canal desconectado", canSend: false, riskWatch: false };
  if (wa && f.metaPaymentIssue) return { ...base, step: 1, state: "envio_bloqueado", reason: "número sem pagamento na Meta", canSend: false, riskWatch: false };
  if (f.boavozSuspended) {
    return { ...base, step: 2, state: "suspenso", reason: "canal suspenso pela BoaVoz", canSend: false, riskWatch: false, notice: f.coexistence ? null : { reason: "suspenso", text: SUSPENDED_NOTICE } };
  }
  if (f.humanInConversation) return { ...base, step: 3, state: "humano", reason: "equipe na conversa" };
  if (f.botPaused) {
    return { ...base, step: 4, state: "bot_pausado", reason: "bot pausado pelo dono", handoff: true, blockReason: "bot_paused", notice: f.botPauseNotify && !f.coexistence ? { reason: "bot_pausado", text: HUMAN_ONLY_NOTICE } : null };
  }
  if (f.humanOnly) {
    return { ...base, step: 5, state: "so_humano", reason: `modo só humano (${f.humanOnly})`, handoff: true, blockReason: f.humanOnly, notice: f.coexistence ? null : { reason: "so_humano", text: HUMAN_ONLY_NOTICE } };
  }
  return { ...base, step: 6, state: "normal", reason: "normal", aiResponds: true, riskWatch: false };
}

/** Número sem pagamento na Meta: bloqueia por 1 hora; depois tenta de novo (se falhar, marca de novo). */
export const PAYMENT_RETRY_MS = 60 * 60_000;

export interface ModeInput {
  bot: { id: string; agency_id: string; paused_at?: string | null; pause_notify?: boolean | null };
  channel: ModeChannel;
  conversation: { id: string; takeover_at?: string | null; handled_at?: string | null } | null;
  /** Número do WhatsApp ligado ao bot (as colunas que importam aqui). */
  wa?: { disconnected_at?: string | null; payment_issue_at?: string | null; waba_id?: string | null; coexistence?: boolean | null } | null;
  /** Conta do Instagram ligada ao bot. */
  ig?: { disconnected_at?: string | null } | null;
  /** Conversa nova (a cota só é conferida na abertura). */
  opening: boolean;
}

export interface Measure {
  source: string;
  channel: string;
  agency_id: string | null;
  bot_id: string | null;
  waba_id: string | null;
}

/**
 * A medida vale para este bot e canal? A da BoaVoz vale para o bot (se tem bot) ou para a agência
 * inteira; a da Meta vale só para a conta do WhatsApp que a recebeu.
 */
export function measureApplies(m: Measure, bot: { id: string; agency_id: string }, channel: ModeChannel, wabaId?: string | null): boolean {
  if (m.channel !== channel && m.channel !== "all") return false;
  if (m.source === "boavoz") return m.bot_id ? m.bot_id === bot.id : m.agency_id === bot.agency_id;
  return Boolean(wabaId) && m.waba_id === wabaId;
}

/** Medidas ativas que bloqueiam canal e podem tocar este bot (o filtro fino é measureApplies). */
async function channelMeasures(db: SupabaseClient, bot: { id: string; agency_id: string }, wabaId?: string | null): Promise<Measure[]> {
  const filter = [`agency_id.eq.${bot.agency_id}`, `bot_id.eq.${bot.id}`, ...(wabaId ? [`waba_id.eq.${wabaId}`] : [])].join(",");
  const { data } = await db.from("enforcement_actions").select("source, channel, agency_id, bot_id, waba_id").eq("feature", "channel").is("lifted_at", null).or(filter);
  return (data ?? []) as Measure[];
}

/** Canal suspenso pela BoaVoz (degrau 2): o widget nem aparece e não recebe contato. */
export async function isChannelSuspended(db: SupabaseClient, bot: { id: string; agency_id: string }, channel: ModeChannel): Promise<boolean> {
  return (await channelMeasures(db, bot)).some((m) => m.source === "boavoz" && measureApplies(m, bot, channel));
}

/** Junta os fatos das fontes (canal, medidas, conversa, pausa, plano) e decide o degrau. */
export async function resolveMode(db: SupabaseClient, input: ModeInput, now = Date.now()): Promise<Mode & { facts: ModeFacts }> {
  const { bot, channel, conversation } = input;
  const [flags, measures, lastHumanReply, humanOnly] = await Promise.all([
    channel === "whatsapp" ? db.from("platform_flags").select("whatsapp_disabled_at").eq("id", 1).maybeSingle() : Promise.resolve({ data: null }),
    channelMeasures(db, bot, input.wa?.waba_id),
    conversation && channel !== "widget"
      ? db.from("messages").select("created_at").eq("conversation_id", conversation.id).eq("role", "agent").in("author", [PHONE_AUTHOR, IG_APP_AUTHOR]).order("id", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    aiBlockedReason(db, bot.agency_id, input.opening),
  ]);
  const hits = (source: string) => measures.some((m) => m.source === source && measureApplies(m, bot, channel, input.wa?.waba_id));
  const paymentAt = input.wa?.payment_issue_at ? Date.parse(input.wa.payment_issue_at) : 0;
  const facts: ModeFacts = {
    channel,
    channelDisconnected: channel === "whatsapp" ? !input.wa || Boolean(input.wa.disconnected_at) : channel === "instagram" ? !input.ig || Boolean(input.ig.disconnected_at) : false,
    metaOrder: channel === "whatsapp" && hits("meta_order"),
    whatsappDisabled: Boolean((flags.data as { whatsapp_disabled_at?: string | null } | null)?.whatsapp_disabled_at),
    metaPaymentIssue: Boolean(paymentAt) && now - paymentAt < PAYMENT_RETRY_MS,
    boavozSuspended: hits("boavoz"),
    humanInConversation: Boolean(conversation?.takeover_at && !conversation.handled_at) || phonePauseActive((lastHumanReply.data as { created_at?: string } | null)?.created_at, now),
    botPaused: Boolean(bot.paused_at),
    botPauseNotify: Boolean(bot.pause_notify),
    humanOnly,
    coexistence: channel === "whatsapp" && Boolean(input.wa?.coexistence),
  };
  return { ...decideMode(facts), facts };
}

/* ------------------------------------------------------------------ aviso ao contato, uma vez por episódio */

/** O aviso deste motivo ainda não saiu nesta conversa (ou saiu por outro motivo: o estado mudou). */
export async function noticeDue(db: SupabaseClient, conversationId: string, reason: NoticeReason): Promise<boolean> {
  const { data } = await db.from("conversations").select("unavailable_notice_reason").eq("id", conversationId).maybeSingle();
  return data?.unavailable_notice_reason !== reason;
}

export async function markNoticeSent(db: SupabaseClient, conversationId: string, reason: NoticeReason) {
  await db.from("conversations").update({ unavailable_notice_at: new Date().toISOString(), unavailable_notice_reason: reason }).eq("id", conversationId);
}

/** Voltou ao normal: o próximo episódio avisa de novo. */
export async function clearNotice(db: SupabaseClient, conversationId: string) {
  await db.from("conversations").update({ unavailable_notice_at: null, unavailable_notice_reason: null }).eq("id", conversationId).not("unavailable_notice_reason", "is", null);
}

const CHANNEL_NAME: Record<ModeChannel, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "chat do site" };

/**
 * Antes de enviar pela equipe (painel, portal, modelo): bloqueado nos degraus 1 e 2. Devolve o
 * texto para mostrar a quem tentou enviar, ou null se pode enviar. A recusa por pagamento não
 * bloqueia aqui: o envio pela equipe é a nova tentativa (se o cartão entrou, sai).
 */
export async function sendBlockedReason(db: SupabaseClient, botId: string, channel: ModeChannel): Promise<string | null> {
  const { data: bot } = await db.from("bots").select("id, agency_id, paused_at, pause_notify").eq("id", botId).maybeSingle();
  if (!bot) return "Chatbot não encontrado.";
  const [{ data: wa }, { data: ig }] = await Promise.all([
    channel === "whatsapp" ? db.from("whatsapp_channels").select("disconnected_at, payment_issue_at, waba_id, coexistence").eq("bot_id", botId).maybeSingle() : Promise.resolve({ data: null }),
    channel === "instagram" ? db.from("instagram_channels").select("disconnected_at").eq("bot_id", botId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { facts } = await resolveMode(db, { bot: bot as ModeInput["bot"], channel, conversation: null, wa, ig, opening: false });
  if (decideMode({ ...facts, metaPaymentIssue: false }).canSend) return null;
  const name = CHANNEL_NAME[channel];
  if (facts.metaOrder) return "A Meta mandou parar os envios deste número. Nada sai pelo WhatsApp até a ordem ser levantada.";
  if (facts.whatsappDisabled) return "O envio pelo WhatsApp está desligado para todos no momento (BoaVoz). Tente de novo mais tarde.";
  if (facts.channelDisconnected) return `O ${name} deste chatbot foi desconectado. Conecte de novo na aba ${name}.`;
  return `Este canal (${name}) está suspenso pela BoaVoz. Nada sai por ele até a suspensão ser levantada.`;
}
