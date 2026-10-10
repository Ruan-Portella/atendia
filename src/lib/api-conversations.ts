import type { SupabaseClient } from "@supabase/supabase-js";
import { apiContacts, parseContactAddress } from "./contacts";
import { loadMessages, findMessage, type MessageRow } from "./messages";
import { agentObject, sourceOf } from "./message-events";
import { audit } from "./audit";
import { clientIp } from "./rate-limit";
import { apiPauseActive } from "./presence";
import { pauseConversationAi, pausePlan, resumeConversationAi } from "./api-pause";
import { ApiError, invalidRequest, notFound, readJsonBody, withIdempotency, type ApiContext } from "./api-v1";

/*
 * Conversas e mensagens pela API (C pública, parte 3a; permissões conversations e messages):
 * - GET /v1/conversations ?bot_id, channel, contact, since, status, cursor, limit (máx. 100)
 * - GET /v1/conversations/{id}/messages ?cursor, limit: o histórico, com status e error
 * - GET /v1/messages/{id}
 * - POST /v1/conversations/{id}/pause {minutes?, announce?, agent_name?} → 200 {ai_paused_until}
 * - POST /v1/conversations/{id}/resume {announce?} → 200 {ai_paused_until: null}
 * Só conversas dos canais de verdade (site, WhatsApp, Instagram; nunca o teste do painel). As
 * mensagens do WhatsApp e do Instagram de cliente sem o aceite do negócio não saem pela API (a
 * mesma regra dos eventos de conteúdo).
 */

export const API_CHANNELS = ["widget", "whatsapp", "instagram"] as const;
type ApiChannel = (typeof API_CHANNELS)[number];
export const CONVERSATION_STATUSES = ["ai", "ai_paused", "waiting_human", "human"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

const MAX_LIMIT = 100;

interface ConversationRow {
  id: string;
  bot_id: string;
  channel: ApiChannel;
  contact_id: string | null;
  started_at: string;
  last_message_at: string;
  message_count: number;
  handoff_requested_at: string | null;
  takeover_at: string | null;
  handled_at: string | null;
  assigned_to_type: string | null;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  ai_paused_until: string | null;
}

const CONV_COLS = "id, bot_id, channel, contact_id, started_at, last_message_at, message_count, handoff_requested_at, takeover_at, handled_at, assigned_to_type, assigned_to_id, assigned_to_name, ai_paused_until";

/** Quem responde a conversa agora: a IA, ninguém (a integração pausou), a fila da equipe ou alguém da equipe. Pura. */
export function conversationStatus(c: Pick<ConversationRow, "handoff_requested_at" | "takeover_at" | "handled_at" | "ai_paused_until">, now = Date.now()): ConversationStatus {
  if (c.takeover_at && !c.handled_at) return "human";
  if (apiPauseActive(c.ai_paused_until, now)) return "ai_paused";
  if (c.handoff_requested_at && !c.handled_at) return "waiting_human";
  return "ai";
}

/** A conversa no formato da API. Pura. */
export function conversationObject(c: ConversationRow, now = Date.now()) {
  const status = conversationStatus(c, now);
  return {
    id: `conv_${c.id}`,
    bot_id: `bot_${c.bot_id}`,
    channel: c.channel,
    contact: c.contact_id ? { id: `ctc_${c.contact_id}` } : null,
    status,
    started_at: c.started_at,
    last_message_at: c.last_message_at,
    message_count: c.message_count,
    ai_paused_until: status === "ai_paused" ? c.ai_paused_until : null,
    agent: status === "human" ? { id: c.assigned_to_id ? `mbr_${c.assigned_to_id}` : null, display_name: c.assigned_to_name, type: c.assigned_to_type } : null,
  };
}

/** Cursor opaco da listagem (a última conversa da página). */
export const encodeCursor = (parts: string[]) => Buffer.from(parts.join("|")).toString("base64url");
export function decodeCursor(raw: string | null, n: number): string[] | null {
  if (!raw) return null;
  const parts = Buffer.from(raw, "base64url").toString("utf8").split("|");
  if (parts.length !== n || parts.some((p) => !p)) throw invalidRequest("cursor inválido: use o next_cursor da resposta anterior.", { field: "cursor" });
  return parts;
}

/** limit da query: padrão 50, de 1 a 100. Pura. */
export function pageLimit(raw: string | null): number {
  if (raw === null || raw === "") return 50;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) throw invalidRequest(`limit deve ser um inteiro de 1 a ${MAX_LIMIT}.`, { field: "limit" });
  return n;
}

const CONV_ID = /^conv_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** A conversa do {id} da rota, se for de um bot do escopo e de um canal de verdade; senão 404. */
async function scopedConversation(api: ApiContext, rawId: string): Promise<ConversationRow> {
  const m = CONV_ID.exec(rawId);
  if (!m || !api.botIds.length) throw notFound();
  const { data } = await api.db.from("conversations").select(CONV_COLS).eq("id", m[1].toLowerCase()).in("bot_id", api.botIds).in("channel", [...API_CHANNELS]).maybeSingle<ConversationRow>();
  if (!data) throw notFound();
  return data;
}

/** WhatsApp e Instagram só com o aceite do negócio (cliente antigo, de antes da tela de aceite). */
async function requireAcceptance(db: SupabaseClient, botId: string, channel: ApiChannel) {
  if (channel === "widget") return;
  const { data: bot } = await db.from("bots").select("client_id").eq("id", botId).maybeSingle();
  const { hasAcceptance } = await import("./acceptance");
  if (!bot?.client_id || !(await hasAcceptance(db, bot.client_id as string, channel))) {
    throw new ApiError(403, "feature_suspended", "O negócio ainda não fez o aceite deste canal: as mensagens dele não saem pela API até o aceite.", { feature: "business_acceptance", channel });
  }
}

/* ------------------------------------------------------------------ GET /v1/conversations */

/** Filtro do status em grupos lógicos do PostgREST (o mesmo critério de conversationStatus). Pura. */
export function statusFilter(status: ConversationStatus | null, now: string): string[] {
  const free = "or(takeover_at.is.null,handled_at.not.is.null)";
  const notPaused = `or(ai_paused_until.is.null,ai_paused_until.lte."${now}")`;
  if (status === "human") return ["takeover_at.not.is.null", "handled_at.is.null"];
  if (status === "ai_paused") return [free, `ai_paused_until.gt."${now}"`];
  if (status === "waiting_human") return [free, notPaused, "handoff_requested_at.not.is.null", "handled_at.is.null"];
  if (status === "ai") return [free, notPaused, "or(handoff_requested_at.is.null,handled_at.not.is.null)"];
  return [];
}

export async function listConversations(req: Request, api: ApiContext): Promise<Response> {
  const p = new URL(req.url).searchParams;
  const limit = pageLimit(p.get("limit"));
  const botIds = p.get("bot_id") ? [api.requireBot(p.get("bot_id"))] : api.botIds;
  const channel = p.get("channel");
  if (channel && !(API_CHANNELS as readonly string[]).includes(channel)) throw invalidRequest("channel deve ser widget, whatsapp ou instagram.", { field: "channel" });
  const status = p.get("status");
  if (status && !(CONVERSATION_STATUSES as readonly string[]).includes(status)) throw invalidRequest(`status deve ser ${CONVERSATION_STATUSES.join(", ")}.`, { field: "status" });
  const since = p.get("since");
  if (since && Number.isNaN(Date.parse(since))) throw invalidRequest("since deve ser uma data ISO 8601 (ex.: 2026-10-01T00:00:00Z).", { field: "since" });
  const cursor = decodeCursor(p.get("cursor"), 2);
  if (!botIds.length) return Response.json({ data: [], next_cursor: null });

  let contactIds: string[] | null = null;
  const rawContact = p.get("contact");
  if (rawContact) {
    const addr = parseContactAddress(rawContact);
    if (!addr) throw invalidRequest("contact inválido: use ctc_…, phone:…, wa:…, ig:… ou ext:….", { field: "contact" });
    contactIds = (await apiContacts(api.db, botIds, addr)).map((c) => c.id);
    if (!contactIds.length) return Response.json({ data: [], next_cursor: null });
  }

  let q = api.db.from("conversations").select(CONV_COLS).in("bot_id", botIds).in("channel", channel ? [channel] : [...API_CHANNELS]);
  if (contactIds) q = q.in("contact_id", contactIds);
  if (since) q = q.gte("last_message_at", new Date(since).toISOString());
  const groups = statusFilter(status as ConversationStatus | null, new Date().toISOString());
  // a mais recente primeiro; o cursor é a última da página (hora e id, para o empate)
  if (cursor) groups.push(`or(last_message_at.lt."${cursor[0]}",and(last_message_at.eq."${cursor[0]}",id.lt.${cursor[1]}))`);
  // um "or" só por consulta: os grupos entram juntos num and
  if (groups.length) q = q.or(`and(${groups.join(",")})`);
  const { data, error } = await q.order("last_message_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (error) throw new Error(`conversas da API: ${error.message}`);
  const rows = (data ?? []) as ConversationRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return Response.json({ data: page.map((c) => conversationObject(c)), next_cursor: rows.length > limit && last ? encodeCursor([last.last_message_at, last.id]) : null });
}

/* ------------------------------------------------------------------ mensagens */

const MSG_COLS = ["id", "conversation_id", "role", "content", "author", "author_type", "author_id", "author_display_name", "channel_msg_id", "delivery_status", "blocked_reason", "failed_at", "error_code", "deleted_at", "edited_at", "created_at"] as const;
type MsgRow = Pick<MessageRow, (typeof MSG_COLS)[number]>;

/** Status de uma mensagem: recebida (do contato), ou o mais avançado que o canal informou. Pura. */
export function messageStatus(m: Pick<MsgRow, "role" | "failed_at" | "channel_msg_id" | "delivery_status">, channel: ApiChannel): string {
  if (m.role === "user") return "received";
  if (m.failed_at || m.delivery_status === "failed") return "failed";
  if (m.delivery_status) return m.delivery_status;
  return channel === "widget" || m.channel_msg_id ? "sent" : "pending";
}

/** A mensagem no formato da API (desfeita: sem o texto). Pura. */
export function messageObject(m: MsgRow, channel: ApiChannel) {
  const inbound = m.role === "user";
  const source = inbound ? "contact" : sourceOf(m);
  const status = messageStatus(m, channel);
  return {
    id: `msg_${m.id}`,
    conversation_id: `conv_${m.conversation_id}`,
    direction: inbound ? "inbound" : "outbound",
    source,
    text: m.deleted_at ? null : m.content,
    media: null,
    agent: inbound || source === "contact" ? null : agentObject(m, source),
    status,
    error: status === "failed" ? { code: m.error_code ?? null, message: null } : null,
    deleted: Boolean(m.deleted_at),
    edited: Boolean(m.edited_at),
    created_at: m.created_at,
  };
}

/** O que a API mostra: o que o contato mandou e o que saiu (nunca o barrado pela regra de estado). */
const visible = (m: MsgRow) => ["user", "assistant", "agent"].includes(m.role) && !m.blocked_reason;

export async function listConversationMessages(req: Request, api: ApiContext, rawId: string): Promise<Response> {
  const conv = await scopedConversation(api, rawId);
  await requireAcceptance(api.db, conv.bot_id, conv.channel);
  const p = new URL(req.url).searchParams;
  const limit = pageLimit(p.get("limit"));
  const cursor = decodeCursor(p.get("cursor"), 1);
  const afterId = cursor ? Number(cursor[0]) : undefined;
  if (afterId !== undefined && !Number.isSafeInteger(afterId)) throw invalidRequest("cursor inválido: use o next_cursor da resposta anterior.", { field: "cursor" });
  // da mais antiga para a mais nova; o cursor é a última lida (o que a API não mostra também anda)
  const rows = await loadMessages(api.db, { conversationId: conv.id, afterId, limit: limit + 1 }, MSG_COLS);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return Response.json({
    conversation: conversationObject(conv),
    data: page.filter(visible).map((m) => messageObject(m, conv.channel)),
    next_cursor: rows.length > limit && last ? encodeCursor([String(last.id)]) : null,
  });
}

const MSG_ID = /^msg_(\d{1,18})$/;

export async function getMessage(api: ApiContext, rawId: string): Promise<Response> {
  const m = MSG_ID.exec(rawId);
  if (!m || !api.botIds.length) throw notFound();
  const msg = await findMessage(api.db, { id: Number(m[1]) }, MSG_COLS);
  if (!msg || !visible(msg)) throw notFound();
  const conv = await scopedConversation(api, `conv_${msg.conversation_id}`);
  await requireAcceptance(api.db, conv.bot_id, conv.channel);
  return Response.json(messageObject(msg, conv.channel));
}

/* ------------------------------------------------------------------ pausar e retomar a IA */

export async function postPause(req: Request, api: ApiContext, rawId: string): Promise<Response> {
  const conv = await scopedConversation(api, rawId);
  const { raw, body } = await readJsonBody(req);
  const plan = pausePlan(body.minutes);
  if ("error" in plan) throw invalidRequest(plan.error, { field: "minutes" });
  if (body.announce !== undefined && typeof body.announce !== "boolean") throw invalidRequest("announce deve ser true ou false.", { field: "announce" });
  const agentName = body.agent_name;
  if (agentName !== undefined && agentName !== null && (typeof agentName !== "string" || !agentName.trim() || agentName.length > 80)) throw invalidRequest("agent_name deve ser texto de até 80 caracteres.", { field: "agent_name" });
  return withIdempotency(api, req, raw, async () => {
    const until = await pauseConversationAi(api.db, conv.id, { ...plan, announce: body.announce === true, agentName: typeof agentName === "string" ? agentName.trim() : null, keyId: api.key.id });
    await audit(api.db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "conversa.pausar_ia", targetType: "conversation", targetId: conv.id, after: { ate: until, renova: plan.renews }, ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    return { status: 200, body: { ai_paused_until: until } };
  });
}

export async function postResume(req: Request, api: ApiContext, rawId: string): Promise<Response> {
  const conv = await scopedConversation(api, rawId);
  const { raw, body } = await readJsonBody(req);
  if (body.announce !== undefined && typeof body.announce !== "boolean") throw invalidRequest("announce deve ser true ou false.", { field: "announce" });
  return withIdempotency(api, req, raw, async () => {
    const resumed = await resumeConversationAi(api.db, conv.id, { reason: "api", announce: body.announce === undefined ? undefined : body.announce === true, background: true });
    if (resumed) await audit(api.db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "conversa.retomar_ia", targetType: "conversation", targetId: conv.id, ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    return { status: 200, body: { ai_paused_until: null } };
  });
}
