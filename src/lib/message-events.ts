import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Eventos de mensagem nos webhooks (C pública, parte 2a; spec Peça 2): message.received e
 * message.sent saem de toda mensagem gravada (saveMessage), message.status e message.failed dos
 * status do canal. Regras:
 *   - sem webhook ativo na plataforma inteira, nada é consultado (cache de 1 minuto);
 *   - WhatsApp e Instagram sem o aceite do negócio não geram eventos de conteúdo;
 *   - a primeira tentativa vai depois da resposta ao contato; envio de campanha e status de
 *     entrega (alto volume) só saem pelo consumidor do minuto.
 * O módulo dos webhooks entra por import dinâmico (messages.ts não carrega o motor de entrega).
 */

let cache: { at: number; agencies: Set<string> } | null = null;

/** Agências com webhook ativo (cache de 1 minuto: a maioria das mensagens não tem para quem ir). */
export async function agenciesWithWebhooks(db: SupabaseClient): Promise<Set<string>> {
  if (!cache || Date.now() - cache.at > 60_000) {
    const { data } = await db.from("webhooks").select("agency_id").eq("active", true).is("paused_by_plan_at", null);
    cache = { at: Date.now(), agencies: new Set((data ?? []).map((w) => w.agency_id as string)) };
  }
  return cache.agencies;
}

/** Testes e mudanças de webhook: a próxima mensagem consulta de novo. */
export const resetWebhookCache = () => {
  cache = null;
};

export type MessageSource = "ai" | "human" | "api" | "campaign" | "phone_app";

/** De quem é a mensagem enviada, no formato do evento. Pura. */
export function sourceOf(m: { author?: string | null; author_type?: string | null }): MessageSource {
  if (m.author === "campanha") return "campaign";
  switch (m.author_type) {
    case "agency_member":
    case "client_member":
      return "human";
    case "api":
      return "api";
    case "phone_app":
      return "phone_app";
    default:
      return "ai";
  }
}

export interface SavedMessage {
  conversation_id: string;
  role: string;
  content: string;
  author?: string | null;
  author_type?: string | null;
  author_id?: string | null;
  author_display_name?: string | null;
  blocked_reason?: string | null;
  failed_at?: string | null;
  error_code?: string | null;
}

const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;

export type BotRef = { id: string; agency_id: string; client_id: string | null; name: string };

/** Conversa, chatbot e se ela pode gerar eventos de conteúdo (aceite do negócio nos canais da Meta). */
async function eventContext(db: SupabaseClient, conversationId: string): Promise<{ bot: BotRef; channel: string; contactId: string | null } | null> {
  const agencies = await agenciesWithWebhooks(db);
  if (!agencies.size) return null;
  const { data: conv } = await db.from("conversations").select("id, channel, contact_id, bots(id, agency_id, client_id, name)").eq("id", conversationId).maybeSingle();
  const bot = one(conv?.bots as BotRef | BotRef[] | null);
  if (!conv || !bot || !agencies.has(bot.agency_id)) return null;
  const channel = conv.channel as string;
  if (channel === "whatsapp" || channel === "instagram") {
    if (!bot.client_id) return null;
    const { hasAcceptance } = await import("./acceptance");
    if (!(await hasAcceptance(db, bot.client_id, channel))) return null;
  }
  return { bot, channel, contactId: (conv.contact_id as string | null) ?? null };
}

/** O contato no envelope: ids de canal e o nome, nunca o conteúdo da conversa. */
export async function contactObject(db: SupabaseClient, contactId: string | null): Promise<Record<string, unknown> | null> {
  if (!contactId) return null;
  const { contactChannelIds, contactDisplayName } = await import("./contacts");
  const [ids, name] = await Promise.all([contactChannelIds(db, contactId), contactDisplayName(db, contactId).catch(() => null)]);
  return { id: `ctc_${contactId}`, whatsapp_user_id: ids.bsuid, phone: ids.phone, instagram_id: ids.igsid, display: name ? { name } : null };
}

/** Quem enviou: atendente (equipe ou portal), integração pela API ou o app do celular. */
export function agentObject(m: SavedMessage, source: MessageSource): Record<string, unknown> | null {
  if (source === "human") return { id: m.author_id ? `mbr_${m.author_id}` : null, display_name: m.author_display_name ?? null, type: m.author_type };
  if (source === "api") return { type: "api", display_name: m.author_display_name ?? null, sender: m.author ?? null };
  if (source === "phone_app") return { type: "phone_app", display_name: null };
  return null;
}

/**
 * Mensagem gravada vira message.received (do contato) ou message.sent (do assistente, da equipe,
 * da API, de campanha ou do celular). Barrada pela regra de estado não sai; falha no envio vira
 * message.failed. Nunca derruba quem gravou.
 */
export async function queueMessageEvent(db: SupabaseClient, id: number, m: SavedMessage): Promise<void> {
  try {
    if (!["user", "assistant", "agent"].includes(m.role) || m.blocked_reason) return;
    const ctx = await eventContext(db, m.conversation_id);
    if (!ctx) return;
    const { emitEvent } = await import("./webhooks");
    const contact = await contactObject(db, ctx.contactId);
    const conversation = { id: m.conversation_id, channel: ctx.channel };
    const base = { bot: ctx.bot, createdAt: new Date().toISOString(), conversation, contact, contactId: ctx.contactId, messageId: id };
    if (m.role === "user") {
      await emitEvent(db, { ...base, type: "message.received", key: String(id), data: { message: { id: `msg_${id}`, text: m.content, media: null } } }, { background: true });
      return;
    }
    const source = sourceOf(m);
    if (m.failed_at) {
      await emitEvent(db, { ...base, type: "message.failed", key: `${id}:${m.error_code ?? "erro"}`, data: { message: { id: `msg_${id}` }, error: { code: m.error_code ?? null, message: null } } }, { background: true });
      return;
    }
    const agent = agentObject(m, source);
    // enviada pela API: o início da chave que enviou (author_id é o id da chave)
    if (agent && source === "api" && m.author_id) agent.key_prefix = ((await db.from("api_keys").select("prefix").eq("id", m.author_id).maybeSingle()).data?.prefix as string | undefined) ?? null;
    await emitEvent(db, { ...base, type: "message.sent", key: String(id), data: { message: { id: `msg_${id}`, text: m.content, media: null }, source, agent } }, { background: true, consumerOnly: source === "campaign" });
  } catch (e) {
    console.error("webhook: evento da mensagem não registrado", (e as Error).message);
  }
}

/**
 * Status do canal (WhatsApp): só quando avança (entregue, lida) ou falha. message.status só sai
 * pelo consumidor (até 2 eventos por mensagem enviada); message.failed traz o código da Meta.
 */
export async function queueStatusEvent(db: SupabaseClient, channelMsgHash: string, status: string, o: { errorCode?: number | null; at?: string | null } = {}): Promise<void> {
  try {
    if (!["delivered", "read", "failed"].includes(status)) return;
    const { advanceDeliveryStatus } = await import("./messages");
    const msg = await advanceDeliveryStatus(db, channelMsgHash, status as "delivered" | "read" | "failed", o.errorCode ?? null);
    if (!msg) return;
    const ctx = await eventContext(db, msg.conversation_id);
    if (!ctx) return;
    const { emitEvent } = await import("./webhooks");
    const contact = await contactObject(db, ctx.contactId);
    const base = { bot: ctx.bot, createdAt: o.at ?? new Date().toISOString(), conversation: { id: msg.conversation_id, channel: ctx.channel }, contact, contactId: ctx.contactId, messageId: msg.id };
    if (status === "failed") {
      const code = o.errorCode ? String(o.errorCode) : "erro";
      await emitEvent(db, { ...base, type: "message.failed", key: `${msg.id}:${code}`, data: { message: { id: `msg_${msg.id}` }, error: { code, message: null } } }, { background: true });
    } else {
      await emitEvent(db, { ...base, type: "message.status", key: `${msg.id}:${status}`, data: { message: { id: `msg_${msg.id}`, status } } }, { consumerOnly: true });
    }
  } catch (e) {
    console.error("webhook: evento de status não registrado", (e as Error).message);
  }
}

/**
 * Mensagem desfeita pelo contato (Instagram): as entregas dela saem antes, e só então o
 * message.deleted. O conteúdo já foi apagado por quem chamou.
 */
export async function queueDeletedEvent(db: SupabaseClient, messageIds: number[], conversationId: string): Promise<void> {
  try {
    if (!messageIds.length) return;
    const { deleteMessageDeliveries, emitEvent } = await import("./webhooks");
    await deleteMessageDeliveries(db, messageIds);
    const ctx = await eventContext(db, conversationId);
    if (!ctx) return;
    const contact = await contactObject(db, ctx.contactId);
    for (const id of messageIds) {
      await emitEvent(db, { type: "message.deleted", key: String(id), bot: ctx.bot, createdAt: new Date().toISOString(), conversation: { id: conversationId, channel: ctx.channel }, contact, contactId: ctx.contactId, data: { message: { id: `msg_${id}` } } }, { background: true });
    }
  } catch (e) {
    console.error("webhook: evento de mensagem desfeita não registrado", (e as Error).message);
  }
}

/* ------------------------------------------------------------------ lead e atendimento */

/** lead.created: o lead que a IA registrou (nome, telefone, e-mail e o interesse). */
export async function queueLeadEvent(db: SupabaseClient, lead: { id: string; conversationId: string | null; name: string; phone?: string | null; email?: string | null; notes?: string | null }): Promise<void> {
  try {
    if (!lead.conversationId) return;
    const ctx = await eventContext(db, lead.conversationId);
    if (!ctx) return;
    const { emitEvent } = await import("./webhooks");
    await emitEvent(
      db,
      { type: "lead.created", key: lead.id, bot: ctx.bot, createdAt: new Date().toISOString(), conversation: { id: lead.conversationId, channel: ctx.channel }, contact: await contactObject(db, ctx.contactId), contactId: ctx.contactId, data: { lead: { id: `lead_${lead.id}`, name: lead.name, phone: lead.phone ?? null, email: lead.email ?? null, notes: lead.notes ?? null } } },
      { background: true },
    );
  } catch (e) {
    console.error("webhook: evento de lead não registrado", (e as Error).message);
  }
}

/**
 * handoff.requested: a IA (ou o contato) pediu atendente. reason ai_unavailable no modo só humano,
 * sem dizer o motivo (não expõe o plano da agência); priority urgent no risco à vida.
 */
export async function queueHandoffRequested(db: SupabaseClient, conversationId: string, o: { urgent?: boolean; aiUnavailable?: boolean; outsideHours?: boolean }): Promise<void> {
  try {
    const ctx = await eventContext(db, conversationId);
    if (!ctx) return;
    const { data: conv } = await db.from("conversations").select("handoff_requested_at").eq("id", conversationId).maybeSingle();
    const at = (conv?.handoff_requested_at as string | null) ?? new Date().toISOString();
    const { emitEvent } = await import("./webhooks");
    await emitEvent(
      db,
      { type: "handoff.requested", key: `${conversationId}:${at}`, bot: ctx.bot, createdAt: at, conversation: { id: conversationId, channel: ctx.channel }, contact: await contactObject(db, ctx.contactId), contactId: ctx.contactId, data: { reason: o.aiUnavailable ? "ai_unavailable" : "requested", priority: o.urgent ? "urgent" : "normal", outside_hours: Boolean(o.outsideHours) } },
      { background: true },
    );
  } catch (e) {
    console.error("webhook: evento de atendimento não registrado", (e as Error).message);
  }
}

/** handoff.returned: a conversa voltou para a IA (o atendente devolveu, ou a pausa venceu ou foi pela API). */
export async function queueHandoffReturned(db: SupabaseClient, conversationId: string, o: { reason: "agent_resumed" | "timeout" | "api"; agent?: { id: string; name: string; type: string } | null; at: string }): Promise<void> {
  try {
    const ctx = await eventContext(db, conversationId);
    if (!ctx) return;
    const { emitEvent } = await import("./webhooks");
    await emitEvent(
      db,
      { type: "handoff.returned", key: `${conversationId}:returned:${o.at}`, bot: ctx.bot, createdAt: o.at, conversation: { id: conversationId, channel: ctx.channel }, contact: await contactObject(db, ctx.contactId), contactId: ctx.contactId, data: { reason: o.reason, agent: o.agent ? { id: `mbr_${o.agent.id}`, display_name: o.agent.name, type: o.agent.type } : null } },
      { background: true },
    );
  } catch (e) {
    console.error("webhook: evento de devolução não registrado", (e as Error).message);
  }
}
