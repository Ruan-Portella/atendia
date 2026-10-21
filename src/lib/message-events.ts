import type { SupabaseClient } from "@supabase/supabase-js";
import { activeOf } from "./entitlements";
import type { LeadRequest } from "./leads";
import { parsePhotoReading, type PhotoReading } from "./photo-note";
import { actionValue, type RoutineVariables } from "./routine-run";

/*
 * Eventos de mensagem nos webhooks (C pública, parte 2a; spec Peça 2): message.received e
 * message.sent saem de toda mensagem gravada (saveMessage), message.status e message.failed dos
 * status do canal. Regras:
 *   - sem webhook ativo na plataforma inteira, nada é consultado (cache de 1 minuto);
 *   - WhatsApp e Instagram sem o aceite do negócio não geram eventos de conteúdo;
 *   - a primeira tentativa vai depois da resposta ao contato; envio de campanha e status de
 *     entrega (alto volume) só saem pelo consumidor do minuto.
 * O módulo dos webhooks entra por import dinâmico (messages.ts não carrega o motor de entrega).
 * Parte 3d: message.received leva interactive (clique em botão, item de lista, resposta rápida) e,
 * quando o contato manda arquivo, media; nesse caso o evento espera o arquivo ser guardado (a
 * captura roda depois da resposta) e sai em releaseInbound. message.sent com arquivo da API leva
 * media também. O link do arquivo é gerado de novo a cada tentativa de entrega.
 */

let cache: { at: number; agencies: Set<string> } | null = null;

/** Agências com webhook ativo e o pacote Integrações (cache de 1 minuto: a maioria das mensagens não tem para quem ir). */
export async function agenciesWithWebhooks(db: SupabaseClient): Promise<Set<string>> {
  if (!cache || Date.now() - cache.at > 60_000) {
    const { data } = await db.from("webhooks").select("agency_id").eq("active", true);
    const withHooks = [...new Set((data ?? []).map((w) => w.agency_id as string))];
    // o pacote só é lido quando há webhook ativo (o caso comum é não ter nenhum)
    const { data: packs } = withHooks.length ? await db.from("agency_packs").select("agency_id, pack, ends_at").eq("pack", "integracoes").in("agency_id", withHooks) : { data: [] };
    cache = { at: Date.now(), agencies: new Set((packs ?? []).filter((p) => activeOf([p]).length > 0).map((p) => p.agency_id as string)) };
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
  inbound_key?: string | null;
  role: string;
  content: string;
  author?: string | null;
  author_type?: string | null;
  author_id?: string | null;
  author_display_name?: string | null;
  blocked_reason?: string | null;
  failed_at?: string | null;
  error_code?: string | null;
  /** o que a IA leu das fotos da mensagem do contato (media.reading) */
  photo_reading?: PhotoReading[] | null;
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
export async function queueMessageEvent(db: SupabaseClient, id: number, m: SavedMessage, o: { withMedia?: boolean; interactive?: Interactive | null } = {}): Promise<void> {
  try {
    if (!["user", "assistant", "agent"].includes(m.role) || m.blocked_reason) return;
    const extra = m.role === "user" && m.inbound_key ? inboundExtras.get(m.inbound_key) : undefined;
    // arquivo do contato: o evento sai depois de o arquivo ser guardado (releaseInbound)
    if (extra?.media && m.inbound_key) {
      deferredReceived.add(m.inbound_key);
      return;
    }
    const ctx = await eventContext(db, m.conversation_id);
    if (!ctx) return;
    const { emitEvent } = await import("./webhooks");
    const contact = await contactObject(db, ctx.contactId);
    const conversation = { id: m.conversation_id, channel: ctx.channel };
    const base = { bot: ctx.bot, createdAt: new Date().toISOString(), conversation, contact, contactId: ctx.contactId, messageId: id };
    const content = o.withMedia ? await withMediaOf(db, id, m.content, m.photo_reading ?? null) : { text: m.content, media: null };
    if (m.role === "user") {
      await emitEvent(db, { ...base, type: "message.received", key: String(id), data: { message: { id: `msg_${id}`, ...content, interactive: o.interactive ?? extra?.interactive ?? null } } }, { background: true });
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
    await emitEvent(db, { ...base, type: "message.sent", key: String(id), data: { message: { id: `msg_${id}`, ...content }, source, agent } }, { background: true, consumerOnly: source === "campaign" });
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

/**
 * lead.created: o lead novo (nome, telefone, e-mail e o interesse). lead.updated: o mesmo contato
 * voltou com um pedido novo (request) ou mudou o contato (request null).
 */
export async function queueLeadEvent(
  db: SupabaseClient,
  lead: { id: string; name: string; phone?: string | null; email?: string | null; notes?: string | null },
  o: { kind: "created" | "updated"; conversationId: string | null; request?: LeadRequest | null },
): Promise<void> {
  try {
    if (!o.conversationId) return;
    const ctx = await eventContext(db, o.conversationId);
    if (!ctx) return;
    const { emitEvent } = await import("./webhooks");
    const at = new Date().toISOString();
    const leadObject = { id: `lead_${lead.id}`, name: lead.name, phone: lead.phone ?? null, email: lead.email ?? null, notes: lead.notes ?? null };
    const r = o.request ?? null;
    await emitEvent(
      db,
      {
        type: o.kind === "created" ? "lead.created" : "lead.updated",
        key: o.kind === "created" ? lead.id : `${lead.id}:${at}`,
        bot: ctx.bot,
        createdAt: at,
        conversation: { id: o.conversationId, channel: ctx.channel },
        contact: await contactObject(db, ctx.contactId),
        contactId: ctx.contactId,
        data: o.kind === "created" ? { lead: leadObject } : { lead: leadObject, request: r ? { created_at: r.at, channel: r.channel, conversation_id: r.conversation_id ? `conv_${r.conversation_id}` : null, text: r.text } : null },
      },
      { background: true },
    );
  } catch (e) {
    console.error("webhook: evento de lead não registrado", (e as Error).message);
  }
}

/**
 * handoff.requested: a IA (ou o contato) pediu atendente. reason ai_unavailable no modo só humano,
 * sem dizer o motivo (não expõe o plano da agência); lead quando a pessoa deixou um pedido para a
 * equipe (lead novo ou pedido novo); priority urgent no risco à vida.
 */
export async function queueHandoffRequested(db: SupabaseClient, conversationId: string, o: { urgent?: boolean; aiUnavailable?: boolean; outsideHours?: boolean; lead?: boolean }): Promise<void> {
  try {
    const ctx = await eventContext(db, conversationId);
    if (!ctx) return;
    const { data: conv } = await db.from("conversations").select("handoff_requested_at").eq("id", conversationId).maybeSingle();
    const at = (conv?.handoff_requested_at as string | null) ?? new Date().toISOString();
    const { emitEvent } = await import("./webhooks");
    await emitEvent(
      db,
      { type: "handoff.requested", key: `${conversationId}:${at}`, bot: ctx.bot, createdAt: at, conversation: { id: conversationId, channel: ctx.channel }, contact: await contactObject(db, ctx.contactId), contactId: ctx.contactId, data: { reason: o.aiUnavailable ? "ai_unavailable" : o.lead ? "lead" : "requested", priority: o.urgent ? "urgent" : "normal", outside_hours: Boolean(o.outsideHours) } },
      { background: true },
    );
  } catch (e) {
    console.error("webhook: evento de atendimento não registrado", (e as Error).message);
  }
}

/** O roteiro que acabou, como o webhook leva (routine.completed / routine.abandoned). */
export interface RoutineEndRun {
  id: string;
  routineId: string | null;
  routineName: string;
  startedBy: "ia" | "palavra";
  startedAt: string;
  endedAt: string;
  stepIndex: number;
  stepsTotal: number;
}

/**
 * data do routine.completed e do routine.abandoned: o roteiro, a execução (como começou e em que
 * passo acabou), o motivo (só no abandonado) e os dados que o roteiro juntou, no formato que as
 * ações recebem (CPF só com os números, data em aaaa-mm-dd). Os dados vão (decisão do usuário em
 * 19/10/2026): sem ação no roteiro, o webhook é o caminho até o sistema da loja, e o
 * message.received já leva o que a pessoa escreveu. Pura.
 */
export function routineEventData(r: RoutineEndRun, variables: RoutineVariables, reason: string | null): Record<string, unknown> {
  return {
    routine: { id: r.routineId ? `rtn_${r.routineId}` : null, name: r.routineName },
    run: { id: `run_${r.id}`, started_by: r.startedBy === "palavra" ? "keyword" : "ai", started_at: r.startedAt, ended_at: r.endedAt, step: r.stepIndex, steps_total: r.stepsTotal },
    ...(reason ? { reason } : {}),
    variables: Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, { type: v.kind, value: String(actionValue(v)) }])),
  };
}

/** routine.completed (o roteiro chegou ao fim) ou routine.abandoned (acabou antes, com o motivo). */
export async function queueRoutineEvent(
  db: SupabaseClient,
  e: { conversationId: string; status: "completed" | "abandoned"; reason: string | null; run: RoutineEndRun; variables: () => Promise<RoutineVariables> },
): Promise<void> {
  try {
    const ctx = await eventContext(db, e.conversationId);
    if (!ctx) return;
    const { emitEvent } = await import("./webhooks");
    await emitEvent(
      db,
      {
        type: e.status === "completed" ? "routine.completed" : "routine.abandoned",
        key: `${e.run.id}:${e.status}`,
        bot: ctx.bot,
        createdAt: e.run.endedAt,
        conversation: { id: e.conversationId, channel: ctx.channel },
        contact: await contactObject(db, ctx.contactId),
        contactId: ctx.contactId,
        data: routineEventData(e.run, await e.variables(), e.status === "abandoned" ? e.reason : null),
      },
      { background: true },
    );
  } catch (err) {
    console.error("webhook: evento de roteiro não registrado", (err as Error).message);
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

/** Quem da equipe, como os webhooks levam (o mesmo do handoff.returned). */
export interface AgentRef {
  type: string;
  id: string;
  name: string;
}
const agentRef = (a: AgentRef | null | undefined) => (a ? { id: `mbr_${a.id}`, display_name: a.name, type: a.type } : null);

/** O setor da conversa agora, como os webhooks levam. */
async function sectorOf(db: SupabaseClient, conversationId: string): Promise<{ id: string; name: string } | null> {
  const { data } = await db.from("conversations").select("sector_id, sectors(name)").eq("id", conversationId).maybeSingle();
  const s = one(data?.sectors as { name: string } | Array<{ name: string }> | null);
  return data?.sector_id && s ? { id: `sec_${data.sector_id as string}`, name: s.name } : null;
}

/**
 * conversation.assigned (Caixa de entrada, parte 6): a conversa chegou a uma pessoa da equipe:
 * ela assumiu (by agent, com previous_agent quando foi "Assumir no lugar"), o rodízio do setor
 * entregou (rotation) ou veio numa transferência (transfer).
 */
export async function queueConversationAssigned(db: SupabaseClient, conversationId: string, o: { agent: AgentRef; by: "agent" | "rotation" | "transfer"; previous?: AgentRef | null; at: string }): Promise<void> {
  try {
    const ctx = await eventContext(db, conversationId);
    if (!ctx) return;
    const { emitEvent } = await import("./webhooks");
    await emitEvent(
      db,
      { type: "conversation.assigned", key: `${conversationId}:assigned:${o.agent.id}:${o.at}`, bot: ctx.bot, createdAt: o.at, conversation: { id: conversationId, channel: ctx.channel }, contact: await contactObject(db, ctx.contactId), contactId: ctx.contactId, data: { agent: agentRef(o.agent), by: o.by, previous_agent: agentRef(o.previous), sector: await sectorOf(db, conversationId) } },
      { background: true },
    );
  } catch (e) {
    console.error("webhook: evento de atribuição não registrado", (e as Error).message);
  }
}

/**
 * conversation.transferred (Caixa de entrada, parte 6): passada para outra pessoa ou para um setor.
 * A nota interna da transferência não sai: é só da equipe.
 */
export async function queueConversationTransferred(db: SupabaseClient, conversationId: string, o: { from: AgentRef; toAgent: AgentRef | null; toSector: boolean; at: string }): Promise<void> {
  try {
    const ctx = await eventContext(db, conversationId);
    if (!ctx) return;
    const { emitEvent } = await import("./webhooks");
    const sector = await sectorOf(db, conversationId);
    await emitEvent(
      db,
      { type: "conversation.transferred", key: `${conversationId}:transferred:${o.at}`, bot: ctx.bot, createdAt: o.at, conversation: { id: conversationId, channel: ctx.channel }, contact: await contactObject(db, ctx.contactId), contactId: ctx.contactId, data: { from: agentRef(o.from), to: { type: o.toSector ? "sector" : "agent", agent: agentRef(o.toAgent), sector: o.toSector ? sector : null } } },
      { background: true },
    );
  } catch (e) {
    console.error("webhook: evento de transferência não registrado", (e as Error).message);
  }
}

/** O chamado como os webhooks levam (Chamados, parte 7d). */
export interface TicketRef {
  protocol: string;
  status: string;
  subject: string | null;
}

/**
 * ticket.created (o chamado foi aberto no chat do site, com quem abriu) e ticket.updated (o status
 * mudou, a equipe respondeu ou a pessoa escreveu de novo: `change`). As notas internas nunca vão.
 */
export async function queueTicketEvent(
  db: SupabaseClient,
  conversationId: string,
  o: { type: "ticket.created" | "ticket.updated"; ticket: TicketRef; at: string; change?: "status" | "resposta_equipe" | "mensagem_cliente"; previousStatus?: string | null; requester?: { name: string; email: string; phone: string | null } | null; agent?: AgentRef | null },
): Promise<void> {
  try {
    const ctx = await eventContext(db, conversationId);
    if (!ctx) return;
    const { emitEvent } = await import("./webhooks");
    const data: Record<string, unknown> = { ticket: o.ticket };
    if (o.type === "ticket.created") data.requester = o.requester ?? null;
    else Object.assign(data, { change: o.change ?? "status", previous_status: o.previousStatus ?? null, agent: agentRef(o.agent) });
    await emitEvent(
      db,
      { type: o.type, key: `${conversationId}:${o.type}:${o.change ?? "criado"}:${o.at}`, bot: ctx.bot, createdAt: o.at, conversation: { id: conversationId, channel: ctx.channel }, contact: await contactObject(db, ctx.contactId), contactId: ctx.contactId, data },
      { background: true },
    );
  } catch (e) {
    console.error("webhook: evento de chamado não registrado", (e as Error).message);
  }
}

/* ------------------------------------------------------------------ arquivo e clique na mensagem recebida */

export interface Interactive {
  type: "button_reply" | "list_reply" | "button" | "quick_reply" | "postback";
  id: string | null;
  title: string | null;
}

export interface InboundExtra {
  /** O contato mandou arquivo (o evento espera a captura). */
  media: boolean;
  interactive: Interactive | null;
}

/** O que cada mensagem da rajada traz além do texto, pela chave do evento (vale durante o processamento). */
const inboundExtras = new Map<string, InboundExtra>();
/** message.received segurados até o arquivo ser guardado. */
const deferredReceived = new Set<string>();

const WA_MEDIA = new Set(["image", "video", "audio", "document", "sticker"]);
const IG_MEDIA = new Set(["image", "video", "audio", "file"]);

/** O id do botão como o dev mandou (sem o prefixo u: que o BoaVoz põe no canal). Pura. */
export const devButtonId = (id: string | null | undefined): string | null => (id ? (id.startsWith("u:") ? id.slice(2) : id) : null);

/** Mensagem do WhatsApp: arquivo que será guardado e o clique (botão, lista ou botão de modelo). Pura. */
export function waInboundExtra(m: { type: string; button?: { text?: string; payload?: string }; interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } } } & Record<string, unknown>): InboundExtra {
  const media = WA_MEDIA.has(m.type) && Boolean((m[m.type] as { id?: string } | undefined)?.id);
  const b = m.interactive?.button_reply;
  const l = m.interactive?.list_reply;
  const interactive: Interactive | null = b
    ? { type: "button_reply", id: devButtonId(b.id), title: b.title ?? null }
    : l
      ? { type: "list_reply", id: devButtonId(l.id), title: l.title ?? null }
      : m.button
        ? { type: "button", id: devButtonId(m.button.payload), title: m.button.text ?? null }
        : null;
  return { media, interactive };
}

/** Mensagem do Instagram: arquivo que será guardado e o clique (resposta rápida ou botão). Pura. */
export function igInboundExtra(ev: { message?: { text?: string; quick_reply?: { payload?: string }; attachments?: Array<{ type?: string; payload?: { url?: string } }> }; postback?: { title?: string; payload?: string } }): InboundExtra {
  const media = (ev.message?.attachments ?? []).some((a) => IG_MEDIA.has(a.type ?? "") && Boolean(a.payload?.url));
  const interactive: Interactive | null = ev.message?.quick_reply
    ? { type: "quick_reply", id: devButtonId(ev.message.quick_reply.payload), title: ev.message.text ?? null }
    : ev.postback
      ? { type: "postback", id: devButtonId(ev.postback.payload), title: ev.postback.title ?? null }
      : null;
  return { media, interactive };
}

/** Antes de tratar a rajada: o que cada mensagem traz. Devolve as chaves (para o releaseInbound). */
export function expectInbound(items: Array<{ key: string } & InboundExtra>): string[] {
  for (const i of items) inboundExtras.set(i.key, { media: i.media, interactive: i.interactive });
  return items.map((i) => i.key);
}

/**
 * Depois da captura dos arquivos (ou se algo falhou no meio): os message.received segurados saem,
 * com a mídia quando o arquivo foi guardado. Nunca derruba quem chamou.
 */
export async function releaseInbound(db: SupabaseClient, keys: string[]): Promise<void> {
  for (const key of keys) {
    const extra = inboundExtras.get(key);
    inboundExtras.delete(key);
    if (!deferredReceived.delete(key)) continue;
    try {
      const { findMessage } = await import("./messages");
      const m = await findMessage(db, { inboundKey: key }, ["id", "conversation_id", "role", "content", "deleted_at", "photo_reading_enc"] as const);
      if (!m || m.deleted_at) continue;
      // fora do registro: queueMessageEvent emite na hora, com a mídia guardada (e o que a IA leu da foto)
      await queueMessageEvent(db, m.id, { conversation_id: m.conversation_id, role: m.role, content: m.content, photo_reading: parsePhotoReading(m.photo_reading_enc) }, { withMedia: true, interactive: extra?.interactive ?? null });
    } catch (e) {
      console.error("webhook: evento da mensagem com arquivo não registrado", (e as Error).message);
    }
  }
}

/**
 * Texto e media da mensagem com arquivo (o rótulo sai, a transcrição do áudio vai para media e o
 * que a IA leu da foto vai para media.reading).
 */
async function withMediaOf(db: SupabaseClient, messageId: number, content: string, readings: PhotoReading[] | null): Promise<{ text: string | null; media: Record<string, unknown> | null }> {
  const { attachmentsOfMessages } = await import("./attachments");
  const file = (await attachmentsOfMessages(db, [messageId])).get(messageId)?.[0];
  if (!file) return { text: content, media: null };
  const { mediaObject, splitMediaText } = await import("./file-links");
  const split = splitMediaText(content);
  return { text: split.text, media: mediaObject(file, split.transcript, Date.now(), file.doc_type === "image" ? (readings?.[0] ?? null) : null) };
}
