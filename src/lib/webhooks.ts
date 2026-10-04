import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seal, unseal } from "./secret-box";
import { openField, sealField } from "./field-cipher";
import { newActionSecret, signatureHeader } from "./actions";
import { safePost } from "./safe-fetch";
import { contactChannelIds } from "./contacts";

/*
 * Webhooks (spec "Formatos de payload", seção 3). Na P2 só saem contact.linked e
 * contact.unlinked, para o webhook do piloto configurado à mão no backoffice; o formato já é o
 * definitivo da C pública:
 * - envelope único {id, type, created_at, bot, client, conversation, contact, data}, assinado no
 *   padrão Standard Webhooks com o segredo do webhook (webhook-id = id do evento);
 * - o id sai do fato: evt_ + base32(sha256(tipo + ":" + chave)); a nova tentativa leva o mesmo id;
 * - 2xx em até 10 s = entregue; novas tentativas em 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h
 *   e 24 h (9 no total); 410 Gone ou 3 dias seguidos só de falhas desativam o webhook.
 */

export const WEBHOOK_EVENTS = ["contact.linked", "contact.unlinked"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Espera antes de cada nova tentativa (a primeira é na hora). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000, 24 * 3_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const DISABLE_AFTER_MS = 3 * 86_400_000;
const TIMEOUT_MS = 10_000;

/** base32 (RFC 4648), minúsculo, sem preenchimento. Função pura. */
export function base32(buf: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

/** Id do evento a partir do fato (o mesmo fato dá sempre o mesmo id). Função pura. */
export const eventId = (type: string, key: string) => `evt_${base32(createHash("sha256").update(`${type}:${key}`).digest())}`;

/** Próxima tentativa depois de `attempts` tentativas feitas (null: acabaram). Função pura. */
export function nextAttemptAt(attempts: number, now = Date.now()): string | null {
  const delay = RETRY_DELAYS_MS[attempts - 1];
  return delay === undefined ? null : new Date(now + delay).toISOString();
}

export interface WebhookRow {
  id: string;
  agency_id: string;
  url: string;
  secret_enc: string;
  events: string[];
  scope_type: "bots" | "client" | "all";
  scope_bot_ids: string[];
  scope_client_id: string | null;
  active: boolean;
  failing_since: string | null;
}
const WEBHOOK_COLS = "id, agency_id, url, secret_enc, events, scope_type, scope_bot_ids, scope_client_id, active, failing_since";

/** O webhook recebe eventos deste chatbot? Função pura. */
export const webhookCovers = (w: Pick<WebhookRow, "scope_type" | "scope_bot_ids" | "scope_client_id">, bot: { id: string; client_id: string | null }) =>
  w.scope_type === "all" || (w.scope_type === "bots" && w.scope_bot_ids.includes(bot.id)) || (w.scope_type === "client" && Boolean(bot.client_id) && w.scope_client_id === bot.client_id);

/* ------------------------------------------------------------------ configuração (backoffice no piloto) */

export async function createWebhook(db: SupabaseClient, i: { agencyId: string; name: string; url: string; events: WebhookEvent[]; scope: { type: "bots"; botIds: string[] } | { type: "client"; clientId: string } | { type: "all" }; createdBy: string }): Promise<{ id: string; secret: string }> {
  const secret = newActionSecret();
  const { data, error } = await db
    .from("webhooks")
    .insert({
      agency_id: i.agencyId,
      name: i.name.trim(),
      url: i.url,
      secret_enc: seal(secret),
      events: i.events,
      scope_type: i.scope.type,
      scope_bot_ids: i.scope.type === "bots" ? i.scope.botIds : [],
      scope_client_id: i.scope.type === "client" ? i.scope.clientId : null,
      created_by: i.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(`webhook não criado: ${error.message}`);
  return { id: data.id as string, secret };
}

/* ------------------------------------------------------------------ entrega */

async function post(w: Pick<WebhookRow, "url" | "secret_enc">, id: string, body: string): Promise<{ status: number | null; error: string | null }> {
  const headers = { "content-type": "application/json", "user-agent": "BoaVoz-Webhooks/1", "webhook-id": id, "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": signatureHeader([unseal(w.secret_enc)], id, new Date(), body) };
  try {
    const r = await safePost(w.url, { body, headers, timeoutMs: TIMEOUT_MS, maxBytes: 4096 });
    return { status: r.status, error: r.redirect ? "redirecionamento não é seguido" : null };
  } catch (e) {
    return { status: null, error: (e as Error).name === "TimeoutError" ? "sem resposta em 10 s" : (e as Error).message.slice(0, 200) };
  }
}

interface DeliveryRow {
  id: string;
  webhook_id: string;
  event_id: string;
  payload_enc: string;
  attempts: number;
}

/** Uma tentativa: entregue, nova tentativa agendada, ou falha final; 410 e 3 dias de falhas desativam. */
async function attempt(db: SupabaseClient, d: DeliveryRow, w: WebhookRow, now = Date.now()): Promise<"delivered" | "pending" | "failed"> {
  const body = openField("webhook_deliveries.payload_enc", d.payload_enc);
  const r = await post(w, d.event_id, body);
  const attempts = d.attempts + 1;
  if (r.status !== null && r.status >= 200 && r.status < 300 && !r.error) {
    await db.from("webhook_deliveries").update({ status: "delivered", attempts, last_status: r.status, last_error: null, delivered_at: new Date(now).toISOString() }).eq("id", d.id);
    if (w.failing_since) await db.from("webhooks").update({ failing_since: null }).eq("id", w.id);
    return "delivered";
  }
  const gone = r.status === 410;
  const next = gone ? null : nextAttemptAt(attempts, now);
  await db.from("webhook_deliveries").update({ status: next ? "pending" : "failed", attempts, last_status: r.status, last_error: r.error ?? `HTTP ${r.status}`, ...(next ? { next_attempt_at: next } : {}) }).eq("id", d.id);
  const failingSince = w.failing_since ?? new Date(now).toISOString();
  if (gone || now - Date.parse(failingSince) > DISABLE_AFTER_MS) {
    await db.from("webhooks").update({ active: false, disabled_at: new Date(now).toISOString(), disabled_reason: gone ? "respondeu 410 Gone" : "3 dias seguidos só de falhas", failing_since: failingSince }).eq("id", w.id);
    console.warn("webhook desativado", w.id, gone ? "410" : "3 dias de falhas");
  } else if (!w.failing_since) await db.from("webhooks").update({ failing_since: failingSince }).eq("id", w.id);
  return next ? "pending" : "failed";
}

/** Envelope do evento para cada webhook ativo que cobre o chatbot; a primeira tentativa é na hora. */
export async function emitEvent(db: SupabaseClient, e: { type: WebhookEvent; key: string; bot: { id: string; agency_id: string; client_id: string | null; name: string }; createdAt: string; conversation: { id: string; channel: string } | null; contact: Record<string, unknown> | null; data: Record<string, unknown> }): Promise<void> {
  const { data: hooks } = await db.from("webhooks").select(WEBHOOK_COLS).eq("agency_id", e.bot.agency_id).eq("active", true);
  const targets = ((hooks ?? []) as WebhookRow[]).filter((w) => w.events.includes(e.type) && webhookCovers(w, e.bot));
  if (!targets.length) return;
  const id = eventId(e.type, e.key);
  const envelope = {
    id,
    type: e.type,
    created_at: e.createdAt,
    bot: { id: `bot_${e.bot.id}`, name: e.bot.name },
    client: e.bot.client_id ? { id: `cli_${e.bot.client_id}`, external_id: null } : null,
    conversation: e.conversation ? { id: `conv_${e.conversation.id}`, channel: e.conversation.channel } : null,
    contact: e.contact,
    data: e.data,
  };
  const payload_enc = sealField("webhook_deliveries.payload_enc", JSON.stringify(envelope));
  for (const w of targets) {
    // o mesmo fato para o mesmo webhook sai uma vez só (repetição do evento não duplica)
    const { data: d, error } = await db.from("webhook_deliveries").insert({ webhook_id: w.id, event_id: id, event_type: e.type, payload_enc }).select("id, webhook_id, event_id, payload_enc, attempts").maybeSingle<DeliveryRow>();
    if (error && !/duplicate|unique/i.test(error.message)) console.error("webhook: entrega não registrada", error.message);
    if (d) await attempt(db, d, w).catch((err) => console.error("webhook: tentativa", (err as Error).message));
  }
  // de carona: novas tentativas que já venceram (sem cron por minuto no Hobby)
  await retryDueDeliveries(db, { limit: 5 }).catch(() => undefined);
}

/** Novas tentativas que já venceram (cron e de carona em cada evento novo). */
export async function retryDueDeliveries(db: SupabaseClient, o: { limit?: number; hasTime?: () => boolean } = {}): Promise<number> {
  const { data } = await db.from("webhook_deliveries").select("id, webhook_id, event_id, payload_enc, attempts").eq("status", "pending").lte("next_attempt_at", new Date().toISOString()).order("next_attempt_at").limit(o.limit ?? 50);
  let done = 0;
  for (const d of (data ?? []) as DeliveryRow[]) {
    if (o.hasTime && !o.hasTime()) break;
    const { data: w } = await db.from("webhooks").select(WEBHOOK_COLS).eq("id", d.webhook_id).maybeSingle<WebhookRow>();
    // webhook desativado ou pausado não entrega nem acumula
    if (!w?.active) {
      await db.from("webhook_deliveries").update({ status: "failed", last_error: "webhook desativado" }).eq("id", d.id);
      continue;
    }
    await attempt(db, d, w);
    done++;
  }
  return done;
}

/** "Enviar teste": webhook.test com a mesma assinatura, fora das novas tentativas e da contagem para desativar. */
export async function sendWebhookTest(db: SupabaseClient, webhookId: string, agencyId: string): Promise<{ status: number | null; error: string | null } | null> {
  const { data: w } = await db.from("webhooks").select(WEBHOOK_COLS).eq("id", webhookId).eq("agency_id", agencyId).maybeSingle<WebhookRow>();
  if (!w) return null;
  const now = new Date().toISOString();
  const id = eventId("webhook.test", `${w.id}:${now}`);
  return post(w, id, JSON.stringify({ id, type: "webhook.test", created_at: now, bot: null, client: null, conversation: null, contact: null, data: {} }));
}

/* ------------------------------------------------------------------ vínculos (P2) */

/**
 * contact.linked / contact.unlinked: data {link: {id, channel, external_id, phone_masked}} e, no
 * unlinked, reason (api, chat, identity_changed, inactivity). Chave do id: o vínculo e a ação
 * (no linked, também o pareamento: parear de novo a mesma conta avisa de novo).
 */
export async function emitLinkEvent(db: SupabaseClient, linkId: string, action: "linked" | "unlinked", o: { reason?: string; conversationId?: string | null } = {}): Promise<void> {
  const { data: link } = await db.from("contact_links").select("id, bot_id, contact_id, channel, external_id_enc, display, pairing_id, linked_at, unlinked_at").eq("id", linkId).maybeSingle();
  if (!link) return;
  const { data: bot } = await db.from("bots").select("id, agency_id, client_id, name").eq("id", link.bot_id).maybeSingle();
  if (!bot) return;
  const ids = await contactChannelIds(db, String(link.contact_id));
  const externalId = openField("contact_links.external_id_enc", String(link.external_id_enc));
  const phoneMasked = link.channel === "whatsapp" && ids.phone ? `${"*".repeat(Math.max(0, ids.phone.length - 4))}${ids.phone.slice(-4)}` : null;
  await emitEvent(db, {
    type: action === "linked" ? "contact.linked" : "contact.unlinked",
    key: action === "linked" ? `${link.id}:linked:${link.pairing_id ?? ""}` : `${link.id}:unlinked`,
    bot: { id: String(bot.id), agency_id: String(bot.agency_id), client_id: (bot.client_id as string | null) ?? null, name: String(bot.name) },
    createdAt: String((action === "linked" ? link.linked_at : link.unlinked_at) ?? new Date().toISOString()),
    conversation: o.conversationId ? { id: o.conversationId, channel: String(link.channel) } : null,
    contact: {
      id: `ctc_${link.contact_id}`,
      level: action === "linked" ? "usuario" : "canal",
      verified_by: action === "linked" ? "pairing" : "meta",
      whatsapp_user_id: ids.bsuid,
      phone: link.channel === "whatsapp" ? ids.phone : null,
      instagram_id: link.channel === "instagram" ? ids.igsid : null,
      external_id: externalId,
      display: link.display ?? null,
    },
    data: { link: { id: `lnk_${link.id}`, channel: link.channel, external_id: externalId, phone_masked: phoneMasked }, ...(action === "unlinked" ? { reason: o.reason ?? "api" } : {}) },
  });
}
