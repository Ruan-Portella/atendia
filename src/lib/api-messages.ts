import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiContacts, parseContactAddress, whatsappContact, type ApiContact } from "./contacts";
import { API_SEND_REF, saveMessage, touchConversation, UNCERTAIN } from "./messages";
import { channelMsgHash } from "./hash";
import { deliver, type SendRecord } from "./send";
import { sendBlockedReason } from "./conversation-mode";
import { OUTSIDE_WINDOW_CODE, SendTimeoutError, WhatsAppError, sendText } from "./whatsapp";
import { TOKEN_REJECTED, isAccessError, isPaymentError, markDisconnected, markPaymentIssue } from "./whatsapp-access";
import { InstagramError, isInstagramAccessError, isOutsideWindow } from "./instagram";
import { IG_TOKEN_REJECTED, markInstagramDisconnected } from "./instagram-channel";
import { send as sendInstagram } from "./instagram-inbound";
import { listTemplates, loadTemplateChannel, renderTemplate, sendTemplate, templateBody, templateVariables, unsupportedReason, type TemplateChannel } from "./whatsapp-templates";
import { activeSuppressions, blocks, suppressionScope } from "./suppression";
import { consentHistory, consentStateOf } from "./marketing-consent";
import { getAge, type AgeStatus } from "./gate/age";
import { dictionaryHits, normalizeGateText, type GateHit } from "./gate/match";
import { isPaymentData, regulatedConversation } from "./gate/payment";
import { botGateExemptions } from "./gate/exceptions";
import type { GateCategory } from "./gate/rules";
import { lastContactMessageAt } from "./whatsapp-inbound";
import { renderEntryNotice, type HumanHandoff } from "./handoff-hours";
import { linkColumnsForContact } from "./pairing";
import { firstExceeded } from "./rate-limit";
import { campaignsInPlan } from "./plan-limits";
import { API_PAUSE_DEFAULT_MINUTES } from "./api-pause";
import { ApiError, invalidRequest, notFound, readJsonBody, withIdempotency, type ApiContext } from "./api-v1";

/*
 * POST /v1/messages (C pública, parte 3b; permissão messages; spec Peça 3 e "Formatos de payload"):
 * texto ou modelo para o WhatsApp e o Instagram ({bot_id, to, channel?}) e texto para uma conversa
 * do site ({conversation_id}). Tudo o que o BoaVoz sabe antes de chamar a Meta volta na hora em 4xx:
 * bot pausado, canal desconectado ou suspenso, janela de 24 horas, supressão, consentimento,
 * modelo e o portão (o texto da API nunca é editado: sai inteiro ou volta 422 prohibited_content).
 * O envio à Meta é síncrono: 201 {message_id, conversation_id, status: "sent"}. Erro temporário da
 * Meta: 503 ou 429 com Retry-After (fora da idempotência). Sem resposta no prazo: 202 "uncertain";
 * o status da Meta concilia depois (biz_opaque_callback_data) e o BoaVoz nunca reenvia sozinho.
 * Documento e imagem chegam na parte 3c.
 */

/** Prazo da resposta da Meta: passou, o envio fica incerto (202). */
const SEND_TIMEOUT_MS = 15_000;
/** Ritmo por número do WhatsApp (o da coexistência; acima, 429 sem fila). */
const NUMBER_RATE = { max: 20, windowSeconds: 1 };
const WINDOW_MS = 24 * 3_600_000;
export const MAX_TEXT = 4096;

type Channel = "whatsapp" | "instagram";

export interface Signature {
  agentName: string | null;
  sender: string | null;
}

export type SendBody =
  | ({ target: "widget"; conversationId: string; type: "text"; text: string } & Signature)
  | ({ target: "channel"; to: string; channel: Channel | null; type: "text"; text: string } & Signature)
  | ({ target: "channel"; to: string; channel: Channel | null; type: "template"; template: { name: string; language: string; variables: string[] } } & Signature);

const CONV_ID = /^conv_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Confere o corpo (400 com o campo). Função pura. */
export function parseSendBody(body: Record<string, unknown>): SendBody {
  const type = body.type;
  if (type === "document" || type === "image") throw invalidRequest("Documento e imagem ainda não estão disponíveis nesta versão da API: envie text ou template.", { field: "type" });
  if (type !== "text" && type !== "template") throw invalidRequest('type deve ser "text" ou "template".', { field: "type" });
  const agent = body.agent_name;
  if (agent !== undefined && agent !== null && (typeof agent !== "string" || !agent.trim() || agent.trim().length > 80)) throw invalidRequest("agent_name deve ser texto de até 80 caracteres.", { field: "agent_name" });
  const sender = body.sender;
  if (sender !== undefined && sender !== null && (typeof sender !== "string" || !/^[\w .-]{1,64}$/.test(sender.trim()))) throw invalidRequest("sender deve ser texto de até 64 caracteres (letras, números, espaço, ponto, hífen).", { field: "sender" });
  const sig: Signature = { agentName: typeof agent === "string" ? agent.trim() : null, sender: typeof sender === "string" ? sender.trim() : null };

  const text = (): string => {
    if (typeof body.text !== "string" || !body.text.trim()) throw invalidRequest("text é obrigatório com type: text.", { field: "text" });
    if (body.text.length > MAX_TEXT) throw invalidRequest(`text pode ter até ${MAX_TEXT} caracteres.`, { field: "text" });
    return body.text.trim();
  };

  if (body.conversation_id !== undefined) {
    if (body.to !== undefined) throw invalidRequest("Use to (WhatsApp e Instagram) ou conversation_id (chat do site), não os dois.", { field: "conversation_id" });
    const m = typeof body.conversation_id === "string" ? CONV_ID.exec(body.conversation_id) : null;
    if (!m) throw invalidRequest("conversation_id inválido: use o id com o prefixo conv_.", { field: "conversation_id" });
    if (type !== "text") throw invalidRequest("No chat do site, só type: text (modelos são do WhatsApp).", { field: "type" });
    return { target: "widget", conversationId: m[1].toLowerCase(), type, text: text(), ...sig };
  }

  if (typeof body.to !== "string" || !body.to.trim()) throw invalidRequest("to é obrigatório (ctc_…, phone:…, wa:…, ig:… ou ext:…); no chat do site, use conversation_id.", { field: "to" });
  const channel = body.channel;
  if (channel !== undefined && channel !== null && channel !== "whatsapp" && channel !== "instagram") throw invalidRequest('channel deve ser "whatsapp" ou "instagram".', { field: "channel" });
  const base = { target: "channel" as const, to: body.to.trim(), channel: (channel as Channel | undefined) ?? null, ...sig };
  if (type === "text") return { ...base, type, text: text() };

  if (body.text !== undefined) throw invalidRequest("Com type: template, o texto vem do modelo: não mande text.", { field: "text" });
  const t = body.template as Record<string, unknown> | undefined;
  if (!t || typeof t !== "object" || Array.isArray(t)) throw invalidRequest("template é obrigatório com type: template: {name, language, variables}.", { field: "template" });
  if (typeof t.name !== "string" || !t.name.trim() || t.name.length > 512) throw invalidRequest("template.name é obrigatório.", { field: "template.name" });
  if (t.language !== undefined && (typeof t.language !== "string" || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(t.language))) throw invalidRequest('template.language deve ser o código do idioma do modelo, ex.: "pt_BR".', { field: "template.language" });
  const vars = t.variables ?? [];
  if (!Array.isArray(vars) || vars.length > 20 || vars.some((v) => typeof v !== "string" || !v.trim() || v.length > 1024)) throw invalidRequest("template.variables deve ser uma lista de textos (até 1.024 caracteres cada), na ordem de {{1}}, {{2}}…", { field: "template.variables" });
  return { ...base, type, template: { name: t.name.trim(), language: (t.language as string | undefined) ?? "pt_BR", variables: (vars as string[]).map((v) => v.trim()) } };
}

/* ------------------------------------------------------------------ o portão (sem editar o texto) */

export type ContentReason = "prohibited" | "age_not_confirmed" | "regulated_in_transaction";

/** Trecho em volta do termo (no texto normalizado, como o portão compara). Pura. */
export function excerptOf(text: string, term: string): string {
  const norm = normalizeGateText(text).trim();
  const i = norm.indexOf(normalizeGateText(term).trim());
  if (i < 0) return norm.slice(0, 60);
  return norm.slice(Math.max(0, i - 30), i + term.length + 30).trim();
}

const sentencesOf = (text: string) => text.split(/(?<=[.!?;])\s+|\n+/).filter((s) => s.trim());

/**
 * Proibido (qualquer idade), regulamentado sem 18+ confirmado, ou regulamentado junto de dado de
 * pagamento (com qualquer idade; numa conversa com pedido de bebida ou remédio, o dado de
 * pagamento sozinho já conta). null = pode sair. Pura.
 */
export function contentProblem(text: string, o: { channel: Channel; contactPhone: string | null; age: AgeStatus; regulatedConversation: boolean; exempt: readonly GateCategory[] }): { reason: ContentReason; matches: Array<{ term: string; excerpt: string }> } | null {
  const hits = dictionaryHits(text, { channel: o.channel, contactPhone: o.contactPhone, exempt: o.exempt });
  const matches = (list: GateHit[]) => list.map((h) => ({ term: h.term, excerpt: excerptOf(text, h.term) }));
  const banned = hits.filter((h) => h.level === "proibido");
  if (banned.length) return { reason: "prohibited", matches: matches(banned) };
  const regulated = hits.filter((h) => h.level === "regulamentado");
  const payment = sentencesOf(text).some(isPaymentData);
  if (payment && (regulated.length || o.regulatedConversation)) return { reason: "regulated_in_transaction", matches: matches(regulated) };
  if (regulated.length && o.age !== "sim") return { reason: "age_not_confirmed", matches: matches(regulated) };
  return null;
}

/* ------------------------------------------------------------------ erros do canal */

const TEMPORARY_WA = new Set([1, 2, 131000, 131016]);

/** Erro do WhatsApp ou do Instagram no envio, no formato da API (acesso e pagamento: quem chama marca). Pura. */
export function channelError(e: unknown): ApiError {
  if (e instanceof WhatsAppError) {
    if (e.code === OUTSIDE_WINDOW_CODE) return new ApiError(422, "outside_messaging_window", "Passaram mais de 24 horas desde a última mensagem do contato: só modelo aprovado (type: template).");
    if (e.code === 131056) return new ApiError(429, "rate_limited", "A Meta limita mensagens seguidas para o mesmo contato. Tente de novo em alguns segundos.", undefined, { "Retry-After": "6" });
    if (e.code === 130429 || e.code === 131048) return new ApiError(429, "rate_limited", "O número atingiu o ritmo de envio da Meta. Tente de novo em instantes.", undefined, { "Retry-After": "60" });
    if (e.code === undefined || TEMPORARY_WA.has(e.code)) return new ApiError(503, "channel_unavailable", "O WhatsApp está instável no momento. Tente de novo.", undefined, { "Retry-After": "30" });
    return new ApiError(422, "channel_rejected", `O WhatsApp recusou a mensagem: ${e.message}`, { channel: "whatsapp", channel_code: e.code });
  }
  if (e instanceof InstagramError) {
    if (isOutsideWindow(e)) return new ApiError(422, "outside_messaging_window", "Passaram mais de 24 horas desde a última mensagem do contato no Instagram.");
    if (e.code === 4 || e.code === 32 || e.code === 613) return new ApiError(429, "rate_limited", "O Instagram limitou o ritmo de envio. Tente de novo em instantes.", undefined, { "Retry-After": "60" });
    if (e.code === undefined || e.code === 1 || e.code === 2) return new ApiError(503, "channel_unavailable", "O Instagram está instável no momento. Tente de novo.", undefined, { "Retry-After": "30" });
    return new ApiError(422, "channel_rejected", `O Instagram recusou a mensagem: ${e.message}`, { channel: "instagram", channel_code: e.code });
  }
  return new ApiError(503, "channel_unavailable", "Não deu para falar com o canal agora. Tente de novo.", undefined, { "Retry-After": "30" });
}

/* ------------------------------------------------------------------ quem recebe */

interface BotRow {
  id: string;
  agency_id: string;
  client_name: string;
  paused_at: string | null;
  human_handoff: HumanHandoff | null;
}

interface Recipient {
  channel: Channel;
  contact: ApiContact | null;
  /** Telefone canônico ou BSUID (WhatsApp) ou IGSID (Instagram): para onde vai. */
  address: string;
  phone: string | null;
}

interface ConvRow {
  id: string;
  regulated_at: string | null;
  announce_pending: boolean;
  assigned_to_id: string | null;
  ai_paused_until: string | null;
  ai_paused_by: string | null;
  ai_pause_renews: boolean;
  ai_pause_announce: boolean | null;
  ai_pause_agent: string | null;
}
const CONV_COLS = "id, regulated_at, announce_pending, assigned_to_id, ai_paused_until, ai_paused_by, ai_pause_renews, ai_pause_announce, ai_pause_agent";

async function loadBot(db: SupabaseClient, botId: string): Promise<BotRow> {
  const { data } = await db.from("bots").select("id, agency_id, client_name, paused_at, human_handoff").eq("id", botId).maybeSingle<BotRow>();
  if (!data) throw notFound();
  if (data.paused_at) throw new ApiError(422, "bot_paused", "O bot está pausado pelo dono: nada sai pela API até ele ser retomado.");
  return data;
}

/** O {contact} do to, no canal certo (o prefixo diz o canal; ext: pede channel e vale o contato usado mais recentemente). */
async function resolveRecipient(db: SupabaseClient, botId: string, p: Extract<SendBody, { target: "channel" }>): Promise<Recipient> {
  const addr = parseContactAddress(p.to);
  if (!addr) throw invalidRequest("to inválido: use ctc_…, phone:5511999999999, wa:<BSUID>, ig:<id> ou ext:<id externo>.", { field: "to" });
  const fromPrefix: Channel | null = addr.kind === "phone" || addr.kind === "wa" ? "whatsapp" : addr.kind === "ig" ? "instagram" : null;
  if (addr.kind === "ext" && !p.channel) throw invalidRequest("Com ext:, channel é obrigatório (whatsapp ou instagram).", { field: "channel" });
  if (fromPrefix && p.channel && fromPrefix !== p.channel) throw invalidRequest(`O to aponta para o ${fromPrefix === "whatsapp" ? "WhatsApp" : "Instagram"}, e channel diz outro canal.`, { field: "channel" });
  let contacts = (await apiContacts(db, [botId], addr)).filter((c) => c.channel === "whatsapp" || c.channel === "instagram");
  const channel = (fromPrefix ?? p.channel ?? contacts[0]?.channel ?? null) as Channel | null;
  contacts = contacts.filter((c) => c.channel === channel);
  if (contacts.length > 1) {
    // o mesmo external_id em mais de um contato: o usado mais recentemente
    const { data } = await db.from("conversations").select("contact_id").in("contact_id", contacts.map((c) => c.id)).order("last_message_at", { ascending: false }).limit(1).maybeSingle();
    contacts = contacts.filter((c) => c.id === data?.contact_id).concat(contacts).slice(0, 1);
  }
  const contact = contacts[0] ?? null;
  if (addr.kind === "phone") return { channel: "whatsapp", contact, address: contact?.phone ?? addr.phone, phone: addr.phone };
  if (!contact || !channel) throw notFound();
  const address = channel === "whatsapp" ? (contact.phone ?? contact.bsuid) : contact.igsid;
  if (!address) throw notFound();
  return { channel, contact, address, phone: channel === "whatsapp" ? contact.phone : null };
}

/** Nem desconectado, nem suspenso, nem ordem da Meta: senão 403 feature_suspended. */
async function requireSendable(db: SupabaseClient, botId: string, channel: Channel | "widget") {
  const blocked = await sendBlockedReason(db, botId, channel);
  if (blocked) throw new ApiError(403, "feature_suspended", blocked, { feature: "channel", channel });
}

async function numberRate(db: SupabaseClient, phoneNumberId: string) {
  const over = await firstExceeded(db, [{ key: `api:wa:${phoneNumberId}`, ...NUMBER_RATE, message: "rate_limited" }]);
  if (over) throw new ApiError(429, "rate_limited", "Ritmo de envio do número atingido. Tente de novo em instantes.", undefined, { "Retry-After": "1" });
}

/** A conversa mais recente do contato com o bot neste canal (dentro de horas: within). */
async function recentConversation(db: SupabaseClient, botId: string, to: Recipient, withinMs: number): Promise<ConvRow | null> {
  const since = new Date(Date.now() - withinMs).toISOString();
  let q = db.from("conversations").select(CONV_COLS).eq("bot_id", botId).eq("channel", to.channel).gt("last_message_at", since);
  q = to.contact ? q.eq("contact_id", to.contact.id) : q.eq(to.channel === "whatsapp" ? "wa_id" : "ig_id", to.address);
  const { data } = await q.order("last_message_at", { ascending: false }).limit(1).maybeSingle<ConvRow>();
  return data ?? null;
}

/* ------------------------------------------------------------------ anúncio, assinatura e pausa */

/**
 * Prefixo da mensagem: o anúncio de entrada (pausa com announce, na primeira mensagem da API, com
 * agent_name ou o nome dado na pausa) ou a assinatura (agent_name; no site, o nome aparece no balão).
 * claimed: o anúncio foi tomado (volta se o envio falhar).
 */
export async function prefixFor(db: SupabaseClient, conv: ConvRow, bot: BotRow, channel: Channel | "widget", agentName: string | null): Promise<{ prefix: string | null; claimed: boolean }> {
  const name = agentName ?? conv.ai_pause_agent;
  if (conv.announce_pending && !conv.assigned_to_id && conv.ai_paused_by === "api" && conv.ai_pause_announce && name) {
    const { data } = await db.from("conversations").update({ announce_pending: false }).eq("id", conv.id).eq("announce_pending", true).is("assigned_to_id", null).select("id");
    if (data?.length) return { prefix: renderEntryNotice(bot.human_handoff?.entry_notice, { attendant: name, company: bot.client_name }), claimed: true };
  }
  return { prefix: signature(agentName, channel), claimed: false };
}

/** Assinatura pelo agent_name (sem ele, sem assinatura). Pura. */
export const signature = (agentName: string | null, channel: Channel | "widget") => (!agentName || channel === "widget" ? null : channel === "whatsapp" ? `*${agentName}:*` : `${agentName}:`);

/** A pausa de 24 h (sem minutes) renova a cada mensagem enviada pela API. */
async function renewPause(db: SupabaseClient, conv: ConvRow) {
  if (conv.ai_paused_by !== "api" || !conv.ai_pause_renews || !conv.ai_paused_until || Date.parse(conv.ai_paused_until) <= Date.now()) return;
  await db.from("conversations").update({ ai_paused_until: new Date(Date.now() + API_PAUSE_DEFAULT_MINUTES * 60_000).toISOString() }).eq("id", conv.id).eq("ai_paused_by", "api");
}

const restoreAnnounce = (db: SupabaseClient, conv: ConvRow, claimed: boolean) => (claimed ? db.from("conversations").update({ announce_pending: true }).eq("id", conv.id).then(() => undefined) : Promise.resolve());

const record = (api: ApiContext, p: Signature, content: string, prefix: string | null, templateCategory: string | null = null) =>
  ({
    insert: {
      role: "agent" as const,
      content,
      author: p.sender,
      author_type: "api" as const,
      author_id: api.key.id,
      author_display_name: p.agentName ?? "Integração",
      announce_chars: prefix ? prefix.length + 1 : null,
      template_category: templateCategory,
    },
  }) satisfies SendRecord;

/* ------------------------------------------------------------------ envio */

type Sent = { status: number; body: unknown };
const sentBody = (messageId: number | null, conversationId: string, status: "sent" | "uncertain"): Sent => ({ status: status === "sent" ? 201 : 202, body: { message_id: messageId ? `msg_${messageId}` : null, conversation_id: `conv_${conversationId}`, status } });

/**
 * Chama o canal pela camada única de envio. Acesso e pagamento marcam o canal (e voltam 422);
 * sem resposta no prazo, a mensagem fica gravada como incerta (202).
 */
async function sendThroughChannel(
  db: SupabaseClient,
  o: { botId: string; channel: Channel; conv: ConvRow; kind: "equipe" | "modelo"; rec: ReturnType<typeof record>; ref: string; claimed: boolean; transport: () => Promise<string | null> },
): Promise<Sent> {
  try {
    const r = await deliver(db, { botId: o.botId, channel: o.channel, conversationId: o.conv.id, kind: o.kind, recordFailures: false, record: o.rec, transport: o.transport });
    if (r.status === "blocked") {
      await restoreAnnounce(db, o.conv, o.claimed);
      throw new ApiError(403, "feature_suspended", r.reason, { feature: "channel", channel: o.channel });
    }
    await touchConversation(db, o.conv.id);
    await renewPause(db, o.conv);
    return sentBody(r.messageId, o.conv.id, "sent");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof SendTimeoutError) {
      // sem saber se saiu: grava como incerta, com o ref que volta no status da Meta
      const id = await saveMessage(db, { conversation_id: o.conv.id, ...o.rec.insert, error_code: UNCERTAIN, channel_msg_hash: o.channel === "whatsapp" ? channelMsgHash("whatsapp", o.ref) : null }, { touch: "equipe" });
      await renewPause(db, o.conv);
      return sentBody(id, o.conv.id, "uncertain");
    }
    await restoreAnnounce(db, o.conv, o.claimed);
    if (o.channel === "whatsapp" && isAccessError(e)) {
      await markDisconnected(db, { column: "bot_id", value: o.botId }, TOKEN_REJECTED);
      throw new ApiError(422, "channel_not_connected", "O cliente removeu o acesso do BoaVoz a este WhatsApp: conecte de novo.", { channel: "whatsapp" });
    }
    if (o.channel === "whatsapp" && isPaymentError(e)) {
      await markPaymentIssue(db, { column: "bot_id", value: o.botId });
      throw new ApiError(422, "channel_rejected", "A Meta recusou por falta de forma de pagamento na conta do WhatsApp.", { channel: "whatsapp", channel_code: 131042 });
    }
    if (o.channel === "instagram" && isInstagramAccessError(e)) {
      await markInstagramDisconnected(db, { column: "bot_id", value: o.botId }, IG_TOKEN_REJECTED);
      throw new ApiError(422, "channel_not_connected", "O Instagram recusou o acesso: conecte de novo.", { channel: "instagram" });
    }
    if (!(e instanceof WhatsAppError) && !(e instanceof InstagramError)) console.error("api: envio", e);
    throw channelError(e);
  }
}

/** Texto para o WhatsApp ou o Instagram, dentro da janela de 24 horas. */
async function sendChannelText(api: ApiContext, botId: string, p: Extract<SendBody, { target: "channel"; type: "text" }>): Promise<Sent> {
  const db = api.db;
  const bot = await loadBot(db, botId);
  const to = await resolveRecipient(db, botId, p);
  const wa = to.channel === "whatsapp" ? (await db.from("whatsapp_channels").select("phone_number_id, access_token_enc, waba_id, disconnected_at").eq("bot_id", botId).maybeSingle()).data : null;
  const ig = to.channel === "instagram" ? (await db.from("instagram_channels").select("bot_id, ig_user_id, access_token_enc, disconnected_at").eq("bot_id", botId).maybeSingle()).data : null;
  if ((to.channel === "whatsapp" && (!wa || wa.disconnected_at)) || (to.channel === "instagram" && (!ig || ig.disconnected_at))) throw new ApiError(422, "channel_not_connected", `O bot não tem ${to.channel === "whatsapp" ? "WhatsApp" : "Instagram"} conectado.`, { channel: to.channel });
  await requireSendable(db, botId, to.channel);
  if (wa) await numberRate(db, wa.phone_number_id as string);

  const last = await lastContactMessageAt(db, botId, to.channel === "whatsapp" ? { waId: to.address } : { igsid: to.address }, to.contact?.id ?? null);
  const conv = last && Date.now() - Date.parse(last) <= WINDOW_MS ? await recentConversation(db, botId, to, WINDOW_MS) : null;
  if (!conv) throw new ApiError(422, "outside_messaging_window", "O contato não escreveu nas últimas 24 horas: só modelo aprovado (type: template, no WhatsApp).");

  const problem = contentProblem(p.text, {
    channel: to.channel,
    contactPhone: to.phone,
    age: await getAge(db, { botId, channel: to.channel, contact: to.address }),
    regulatedConversation: regulatedConversation(conv.regulated_at),
    exempt: await botGateExemptions(db, botId),
  });
  if (problem) throw new ApiError(422, "prohibited_content", "O portão do BoaVoz barrou o texto (ele nunca é editado).", { ...problem, channel: to.channel });

  const { prefix, claimed } = await prefixFor(db, conv, bot, to.channel, p.agentName);
  const content = prefix ? `${prefix}\n${p.text}` : p.text;
  const ref = `${API_SEND_REF}${randomUUID()}`;
  return sendThroughChannel(db, {
    botId,
    channel: to.channel,
    conv,
    kind: "equipe",
    rec: record(api, p, content, prefix),
    ref,
    claimed,
    transport: async () =>
      to.channel === "whatsapp"
        ? ((await sendText(wa as { phone_number_id: string; access_token_enc: string | null }, to.address, content, { callbackData: ref, timeoutMs: SEND_TIMEOUT_MS })).messages?.[0]?.id ?? null)
        : sendInstagram(db, ig as { bot_id: string; ig_user_id: string; access_token_enc: string | null }, to.address, content, undefined, { timeoutMs: SEND_TIMEOUT_MS }),
  });
}

/** Modelo aprovado do WhatsApp: abre (ou continua) a conversa, fora da janela também. */
async function sendTemplateMessage(api: ApiContext, botId: string, p: Extract<SendBody, { type: "template" }>): Promise<Sent> {
  const db = api.db;
  const bot = await loadBot(db, botId);
  const to = await resolveRecipient(db, botId, p);
  if (to.channel !== "whatsapp") throw invalidRequest("Modelos são só do WhatsApp.", { field: "type" });
  const ch: TemplateChannel | null = await loadTemplateChannel(db, botId);
  if (!ch) throw new ApiError(422, "channel_not_connected", "O bot não tem WhatsApp conectado (com a conta do WhatsApp Business).", { channel: "whatsapp" });
  await requireSendable(db, botId, "whatsapp");
  await numberRate(db, ch.phone_number_id);

  let templates;
  try {
    templates = await listTemplates(ch);
  } catch (e) {
    throw channelError(e);
  }
  const t = templates.find((x) => x.name === p.template.name && x.language === p.template.language);
  if (!t) throw invalidRequest("Modelo não encontrado neste número (confira o nome e o idioma em GET /v1/bots/{id}/templates).", { field: "template.name" });
  if (t.status !== "APPROVED") throw invalidRequest(`O modelo não está aprovado pela Meta (status ${t.status}).`, { field: "template.name", status: t.status.toLowerCase() });
  const unsupported = unsupportedReason(t);
  if (unsupported) throw invalidRequest(`O BoaVoz ainda não envia este modelo: ${unsupported}.`, { field: "template.name" });
  const category = t.category.toUpperCase();
  if (category !== "UTILITY" && category !== "MARKETING") throw invalidRequest("Só modelos de utilidade e de marketing.", { field: "template.name" });
  const body = templateBody(t);
  const count = templateVariables(body).length;
  if (p.template.variables.length !== count) throw invalidRequest(`O modelo pede ${count} variável(is) e vieram ${p.template.variables.length}.`, { field: "template.variables", expected: count });

  // envio iniciado pela empresa: quem pediu para sair (ou foi suprimido) não recebe
  const target = { scope: suppressionScope({ wabaId: ch.waba_id, botId }), contact: to.address };
  const active = await activeSuppressions(db, { channel: "whatsapp", ...target });
  if (blocks(active.map((s) => s.kind), category)) {
    if (active.some((s) => s.reason === "erasure")) throw new ApiError(422, "contact_suppressed", "O contato está na lista de supressão (pedido para apagar os dados).");
    throw new ApiError(422, "contact_opted_out", "O contato pediu para não receber esse tipo de mensagem (SAIR, botão ou o próprio WhatsApp).");
  }
  const age = await getAge(db, { botId, channel: "whatsapp", contact: to.address });
  if (category === "MARKETING") {
    const { data: agency } = await db.from("agencies").select("plan").eq("id", bot.agency_id).maybeSingle();
    if (!campaignsInPlan(String(agency?.plan ?? ""))) throw new ApiError(403, "plan_not_allowed", "Modelo de marketing fica nos planos pagos.");
    if (consentStateOf(await consentHistory(db, target, 1)) !== "granted") throw new ApiError(422, "no_marketing_consent", "O contato não aceitou receber novidades deste número.");
    if (age === "nao") throw new ApiError(422, "no_marketing_consent", "O contato disse que não tem 18 anos: marketing não vai para ele.", { reason: "under_18" });
  }

  const conv0 = await recentConversation(db, botId, to, WINDOW_MS);
  const text = renderTemplate(body, p.template.variables);
  const problem = contentProblem(text, { channel: "whatsapp", contactPhone: to.phone, age, regulatedConversation: regulatedConversation(conv0?.regulated_at), exempt: await botGateExemptions(db, botId) });
  if (problem) throw new ApiError(422, "prohibited_content", "O portão do BoaVoz barrou o modelo (corpo ou variáveis).", { ...problem, channel: "whatsapp" });

  // modelo abre conversa: o contato nasce aqui se ainda não existia
  let conv = conv0;
  if (!conv) {
    const contact = to.contact ? { id: to.contact.id } : await whatsappContact(db, { id: botId, agency_id: bot.agency_id }, /[a-z]/i.test(to.address) ? { bsuid: to.address } : { phone: to.address });
    const { data, error } = await db
      .from("conversations")
      .insert({ bot_id: botId, channel: "whatsapp", wa_id: to.address, contact_id: contact?.id ?? null, visitor_id: null, ...(await linkColumnsForContact(db, contact?.id ?? null)) })
      .select(CONV_COLS)
      .single<ConvRow>();
    if (error || !data) throw new Error(`conversa da API: ${error?.message}`);
    conv = data;
  }
  const ref = `${API_SEND_REF}${randomUUID()}`;
  return sendThroughChannel(db, {
    botId,
    channel: "whatsapp",
    conv,
    kind: "modelo",
    // o modelo sai como a Meta aprovou: sem anúncio nem assinatura
    rec: record(api, p, text, null, category),
    ref,
    claimed: false,
    transport: async () => (await sendTemplate(ch, to.address, t, p.template.variables, { callbackData: ref, timeoutMs: SEND_TIMEOUT_MS })).messages?.[0]?.id ?? null,
  });
}

/** Texto numa conversa do site: gravado como do atendente da integração; o widget entrega na consulta de novidades. */
async function sendToWidget(api: ApiContext, p: Extract<SendBody, { target: "widget" }>): Promise<Sent> {
  const db = api.db;
  if (!api.botIds.length) throw notFound();
  const { data } = await db.from("conversations").select(`bot_id, ${CONV_COLS}`).eq("id", p.conversationId).eq("channel", "widget").in("bot_id", api.botIds).maybeSingle();
  if (!data) throw notFound();
  const conv = data as unknown as ConvRow & { bot_id: string };
  const bot = await loadBot(db, conv.bot_id);
  await requireSendable(db, conv.bot_id, "widget");
  const { prefix } = await prefixFor(db, conv, bot, "widget", p.agentName);
  const content = prefix ? `${prefix}\n${p.text}` : p.text;
  const id = await saveMessage(db, { conversation_id: conv.id, ...record(api, p, content, prefix).insert }, { touch: "equipe" });
  await renewPause(db, conv);
  return sentBody(id, conv.id, "sent");
}

export async function postMessage(req: Request, api: ApiContext): Promise<Response> {
  const { raw, body } = await readJsonBody(req);
  const p = parseSendBody(body);
  if (p.target === "widget") return withIdempotency(api, req, raw, () => sendToWidget(api, p));
  const botId = api.requireBot(body.bot_id);
  return withIdempotency(api, req, raw, () => (p.type === "template" ? sendTemplateMessage(api, botId, p) : sendChannelText(api, botId, p)));
}

/* ------------------------------------------------------------------ GET /v1/bots/{id}/templates */

export async function listBotTemplates(api: ApiContext, rawBotId: string): Promise<Response> {
  const botId = api.requireBot(rawBotId);
  const ch = await loadTemplateChannel(api.db, botId);
  if (!ch) throw new ApiError(422, "channel_not_connected", "O bot não tem WhatsApp conectado (com a conta do WhatsApp Business).", { channel: "whatsapp" });
  let templates;
  try {
    templates = await listTemplates(ch);
  } catch (e) {
    throw channelError(e);
  }
  return Response.json({
    data: templates.map((t) => {
      const body = templateBody(t);
      const unsupported = unsupportedReason(t);
      return {
        name: t.name,
        language: t.language,
        category: t.category.toLowerCase(),
        status: t.status.toLowerCase(),
        rejected_reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
        body,
        variables: templateVariables(body).length,
        sendable: t.status === "APPROVED" && !unsupported && ["UTILITY", "MARKETING"].includes(t.category.toUpperCase()),
        unsupported_reason: unsupported,
      };
    }),
  });
}
