import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiContacts, apiContactsPage, normalizeTags, parseContactAddress, setContactTags, whatsappContact, type ApiContact, type ApiContactRow } from "./contacts";
import { apiLeadsPage, type Lead } from "./leads";
import { consentStatesMany, recordConsent, revokeConsents, whatsappScopeOfBot, type ConsentState } from "./marketing-consent";
import { activeSuppressions, activeSuppressionsMany, suppressionScope, type SuppressionKind } from "./suppression";
import { agesMany, getAge, type AgeStatus } from "./gate/age";
import { createApiRequest, executeApiRequest } from "./data-subject";
import { audit } from "./audit";
import { clientIp } from "./rate-limit";
import { decodeCursor, encodeCursor, pageLimit } from "./api-conversations";
import { ApiError, invalidRequest, notFound, readJsonBody, withIdempotency, type ApiContext } from "./api-v1";

/*
 * Contatos, leads, etiquetas, consentimento e exclusão pela API (C pública, parte 4a; spec
 * "Formatos de payload", rotas, e Peça 7):
 * - GET /v1/contacts ?bot_id, channel, tag, since, cursor, limit (contacts): na ordem da última
 *   alteração, para sincronizar; cada contato com etiquetas, consentimento e 18+
 * - PUT /v1/contacts/{contact}/tags {bot_id, tags} (contacts): ext: vale para todos os contatos do
 *   bot com aquele id; contato que não existe → 404 (registre o consentimento primeiro)
 * - GET /v1/leads ?bot_id, channel, since, cursor, limit (contacts)
 * - POST /v1/contacts/{contact}/consent {bot_id, channel: whatsapp, granted, source, text,
 *   collected_at} (campaigns) → 201 {consent_id}; o sim pela API cria o contato do WhatsApp que não
 *   existe, mas não tira ninguém do descadastro (só um novo sim da própria pessoa, no chat)
 * - DELETE /v1/contacts/{contact}?bot_id= (contacts) → 202 {request_id}: pedido do titular já
 *   confirmado, apagado pela rotina única de exclusão, com contact.deleted
 */

const CHANNELS = ["widget", "whatsapp", "instagram"] as const;

function sinceParam(raw: string | null): string | null {
  if (!raw) return null;
  if (Number.isNaN(Date.parse(raw))) throw invalidRequest("since deve ser uma data ISO 8601 (ex.: 2026-10-01T00:00:00Z).", { field: "since" });
  return new Date(raw).toISOString();
}

function channelParam(raw: string | null): string | null {
  if (!raw) return null;
  if (!(CHANNELS as readonly string[]).includes(raw)) throw invalidRequest("channel deve ser widget, whatsapp ou instagram.", { field: "channel" });
  return raw;
}

function contactParam(raw: string) {
  const addr = parseContactAddress(decodeURIComponent(raw));
  if (!addr) throw invalidRequest("{contact} inválido: use ctc_<id>, phone:<número>, wa:<BSUID>, ig:<id> ou ext:<id>.", { field: "contact" });
  return addr;
}

/* ------------------------------------------------------------------ contato no formato da API */

export interface ContactExtras {
  consent: ConsentState | null;
  optedOut: SuppressionKind[];
  age: AgeStatus;
}

/** O contato no formato da API: identidades do canal, etiquetas, consentimento (WhatsApp) e 18+. Pura. */
export function contactApiObject(c: ApiContactRow, x: ContactExtras) {
  return {
    id: `ctc_${c.id}`,
    bot_id: `bot_${c.bot_id}`,
    channel: c.channel,
    name: c.name,
    email: c.email,
    phone: c.channel === "whatsapp" ? c.phone : null,
    whatsapp_user_id: c.channel === "whatsapp" ? c.bsuid : null,
    instagram_id: c.channel === "instagram" ? c.igsid : null,
    external_id: c.external_id,
    tags: c.tags,
    // promoções: só no WhatsApp; opted_out = o que a pessoa pediu para não receber (SAIR, botão, Meta)
    consent: c.channel === "widget" ? null : { marketing: c.channel === "whatsapp" ? (x.consent ?? "none") : null, opted_out: x.optedOut },
    age_confirmed: x.age === "sim" ? true : x.age === "nao" ? false : null,
    first_inbound_at: c.first_inbound_at,
    last_inbound_at: c.last_inbound_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

/** Consentimento, descadastro e 18+ dos contatos da página, em lote por chatbot. */
async function extrasOf(db: SupabaseClient, rows: ApiContactRow[]): Promise<Map<string, ContactExtras>> {
  const out = new Map<string, ContactExtras>();
  const byBot = new Map<string, ApiContactRow[]>();
  for (const r of rows) byBot.set(r.bot_id, [...(byBot.get(r.bot_id) ?? []), r]);
  for (const [botId, list] of byBot) {
    const wa = list.filter((c) => c.channel === "whatsapp" && (c.phone || c.bsuid));
    const ig = list.filter((c) => c.channel === "instagram" && c.igsid);
    if (wa.length) {
      const scope = (await whatsappScopeOfBot(db, botId))?.scope ?? suppressionScope({ botId });
      const keys = wa.map((c) => (c.phone ?? c.bsuid)!);
      const [consents, suppressed, ages] = await Promise.all([consentStatesMany(db, scope, keys), activeSuppressionsMany(db, { channel: "whatsapp", scope, contacts: keys }), agesMany(db, botId, keys)]);
      for (const c of wa) {
        const k = (c.phone ?? c.bsuid)!;
        out.set(c.id, { consent: consents.get(k) ?? null, optedOut: suppressed.get(k) ?? [], age: ages.get(k) ?? null });
      }
    }
    if (ig.length) {
      const scope = suppressionScope({ botId });
      const suppressed = await activeSuppressionsMany(db, { channel: "instagram", scope, contacts: ig.map((c) => c.igsid!) });
      for (const c of ig) out.set(c.id, { consent: null, optedOut: suppressed.get(c.igsid!) ?? [], age: await getAge(db, { botId, channel: "instagram", contact: c.igsid! }) });
    }
  }
  return out;
}

const NO_EXTRAS: ContactExtras = { consent: null, optedOut: [], age: null };

/* ------------------------------------------------------------------ GET /v1/contacts */

export async function listContactsApi(req: Request, api: ApiContext): Promise<Response> {
  const p = new URL(req.url).searchParams;
  const limit = pageLimit(p.get("limit"));
  const botIds = p.get("bot_id") ? [api.requireBot(p.get("bot_id"))] : api.botIds;
  const channel = channelParam(p.get("channel"));
  const tag = p.get("tag")?.trim() || null;
  if (tag && tag.length > 30) throw invalidRequest("tag tem até 30 caracteres.", { field: "tag" });
  const since = sinceParam(p.get("since"));
  const cursor = decodeCursor(p.get("cursor"), 2) as [string, string] | null;
  const rows = await apiContactsPage(api.db, { botIds, channel, tag, since, after: cursor, limit: limit + 1 });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const extras = await extrasOf(api.db, page);
  return Response.json({ data: page.map((c) => contactApiObject(c, extras.get(c.id) ?? NO_EXTRAS)), next_cursor: rows.length > limit && last ? encodeCursor([last.updated_at, last.id]) : null });
}

/* ------------------------------------------------------------------ PUT /v1/contacts/{contact}/tags */

/** tags do corpo: lista de textos, até 20, cada uma com até 30 caracteres (sem "#", sem repetir). Pura. */
export function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.some((t) => typeof t !== "string")) throw invalidRequest("tags deve ser uma lista de textos (vazia apaga as etiquetas).", { field: "tags" });
  if (raw.length > 20) throw invalidRequest("Até 20 etiquetas por contato.", { field: "tags" });
  return normalizeTags((raw as string[]).map((t) => t.replace(/[,;\n]/g, " ")).join(","));
}

export async function putContactTags(req: Request, api: ApiContext, rawContact: string): Promise<Response> {
  const { body } = await readJsonBody(req);
  const botId = api.requireBot(body.bot_id);
  const tags = parseTags(body.tags);
  const contacts = await apiContacts(api.db, [botId], contactParam(rawContact));
  if (!contacts.length) throw notFound();
  for (const c of contacts) await setContactTags(api.db, c.id, [botId], tags);
  await audit(api.db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "contato.etiquetas", targetType: "contact", targetId: contacts[0].id, after: { tags, contatos: contacts.length }, ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  return Response.json({ data: contacts.map((c) => ({ id: `ctc_${c.id}`, tags })) });
}

/* ------------------------------------------------------------------ GET /v1/leads */

/** O lead no formato da API. Pura. */
export const leadApiObject = (l: Lead) => ({
  id: `lead_${l.id}`,
  bot_id: `bot_${l.bot_id}`,
  conversation_id: l.conversation_id ? `conv_${l.conversation_id}` : null,
  channel: l.channel,
  name: l.name,
  phone: l.phone,
  email: l.email,
  instagram: l.instagram,
  notes: l.notes,
  created_at: l.created_at,
});

export async function listLeadsApi(req: Request, api: ApiContext): Promise<Response> {
  const p = new URL(req.url).searchParams;
  const limit = pageLimit(p.get("limit"));
  const botIds = p.get("bot_id") ? [api.requireBot(p.get("bot_id"))] : api.botIds;
  const channel = channelParam(p.get("channel"));
  const since = sinceParam(p.get("since"));
  const cursor = decodeCursor(p.get("cursor"), 2) as [string, string] | null;
  const rows = await apiLeadsPage(api.db, { botIds, channel, since, after: cursor, limit: limit + 1 });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return Response.json({ data: page.map(leadApiObject), next_cursor: rows.length > limit && last ? encodeCursor([last.created_at, last.id]) : null });
}

/* ------------------------------------------------------------------ POST /v1/contacts/{contact}/consent */

/** O corpo do consentimento (400 com o campo). Pura. */
export function parseConsentBody(body: Record<string, unknown>, now = Date.now()): { granted: boolean; source: string; text: string; collectedAt: string } {
  if (body.channel !== undefined && body.channel !== "whatsapp") throw invalidRequest('Consentimento vale só para o WhatsApp: channel deve ser "whatsapp".', { field: "channel" });
  if (typeof body.granted !== "boolean") throw invalidRequest("granted deve ser true (aceitou) ou false (retirou).", { field: "granted" });
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (source.length < 3 || source.length > 200) throw invalidRequest('source é obrigatório: onde a pessoa aceitou ou retirou (3 a 200 caracteres, ex.: "cadastro no site").', { field: "source" });
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 10 || text.length > 1000) throw invalidRequest("text é obrigatório: o texto que a pessoa aceitou (10 a 1.000 caracteres).", { field: "text" });
  let collectedAt = new Date(now).toISOString();
  if (body.collected_at !== undefined && body.collected_at !== null) {
    const t = typeof body.collected_at === "string" ? Date.parse(body.collected_at) : NaN;
    if (Number.isNaN(t) || t > now + 60_000) throw invalidRequest("collected_at deve ser uma data ISO 8601 no passado.", { field: "collected_at" });
    collectedAt = new Date(t).toISOString();
  }
  return { granted: body.granted, source, text, collectedAt };
}

export async function postContactConsent(req: Request, api: ApiContext, rawContact: string): Promise<Response> {
  const { raw, body } = await readJsonBody(req);
  const botId = api.requireBot(body.bot_id);
  const c = parseConsentBody(body);
  const addr = contactParam(rawContact);
  if (addr.kind === "ig") throw invalidRequest("Consentimento vale só para o WhatsApp.", { field: "contact" });
  return withIdempotency(api, req, raw, async () => {
    const db = api.db;
    const wa = await whatsappScopeOfBot(db, botId);
    if (!wa) throw new ApiError(422, "channel_not_connected", "O bot não tem WhatsApp conectado.", { channel: "whatsapp" });
    const { data: bot } = await db.from("bots").select("id, agency_id, client_id").eq("id", botId).maybeSingle();
    if (!bot) throw notFound();
    let contacts: Array<Pick<ApiContact, "id" | "phone" | "bsuid">> = (await apiContacts(db, [botId], addr)).filter((x) => x.channel === "whatsapp");
    if (!contacts.length) {
      // só o sim pela API cria contato (pelo telefone ou pelo BSUID)
      if (!c.granted || (addr.kind !== "phone" && addr.kind !== "wa")) throw notFound();
      const who = addr.kind === "phone" ? { phone: addr.phone } : { bsuid: addr.bsuid };
      const created = await whatsappContact(db, { id: botId, agency_id: bot.agency_id as string }, who);
      if (!created) throw notFound();
      contacts = [{ id: created.id, phone: addr.kind === "phone" ? addr.phone : null, bsuid: addr.kind === "wa" ? addr.bsuid : null }];
    }
    const ids: number[] = [];
    let optedOut = false;
    for (const contact of contacts) {
      const address = contact.phone ?? contact.bsuid;
      if (!address) continue;
      const target = { scope: wa.scope, contact: address };
      const origin = { agencyId: bot.agency_id as string, clientId: (bot.client_id as string | null) ?? null, botId, wabaId: wa.wabaId, contactId: contact.id };
      const proof = { source: "api" as const, text: `Origem: ${c.source}. Texto aceito: ${c.text}`, textVersion: "api-1", collectedBy: `api:${api.key.prefix}`, collectedAt: c.collectedAt };
      if (c.granted) {
        const active = await activeSuppressions(db, { channel: "whatsapp", ...target });
        // pedido para apagar os dados: só um novo sim da própria pessoa, no chat, tira daí
        if (active.some((s) => s.reason === "erasure")) throw new ApiError(422, "contact_suppressed", "O contato está na lista de supressão (pediu para apagar os dados): só um novo sim dado por ele no chat vale.");
        optedOut ||= active.some((s) => s.kind === "marketing" || s.kind === "all");
        const id = await recordConsent(db, { ...target, ...origin, ...proof, granted: true });
        if (id) ids.push(id);
      } else {
        await revokeConsents(db, target, `api:${api.key.prefix}`);
        const id = await recordConsent(db, { ...target, ...origin, ...proof, granted: false });
        if (id) {
          ids.push(id);
          const { queueConsentEvent } = await import("./platform-events");
          await queueConsentEvent(db, { channel: "whatsapp", ...target, type: "marketing", source: "api", granted: false, key: `consent:${id}` });
        }
      }
    }
    await audit(db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: c.granted ? "contato.consentimento" : "contato.consentimento_revogar", targetType: "contact", targetId: contacts[0].id, after: { origem: c.source, data: c.collectedAt, contatos: contacts.length }, ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    return {
      status: 201,
      body: {
        consent_id: ids[0] ? `cns_${ids[0]}` : null,
        contact_id: `ctc_${contacts[0].id}`,
        // pediu para sair antes: o aceite fica gravado, mas promoções só depois de um novo sim dele no chat
        opted_out: optedOut,
      },
    };
  });
}

/* ------------------------------------------------------------------ DELETE /v1/contacts/{contact} */

export async function deleteContactApi(req: Request, api: ApiContext, rawContact: string): Promise<Response> {
  const botId = api.requireBot(new URL(req.url).searchParams.get("bot_id"));
  const contacts = await apiContacts(api.db, [botId], contactParam(rawContact));
  if (!contacts.length) throw notFound();
  const { data: bot } = await api.db.from("bots").select("id, agency_id, client_id").eq("id", botId).maybeSingle();
  if (!bot) throw notFound();
  const contactIds = contacts.map((c) => c.id);
  const requestId = await createApiRequest(api.db, { bot: { id: botId, agency_id: bot.agency_id as string, client_id: (bot.client_id as string | null) ?? null }, contactIds, by: `api:${api.key.prefix}` });
  await audit(api.db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "titular.pedido_api", targetType: "bot", targetId: botId, after: { request_id: requestId, contatos: contactIds.length }, ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  // a rotina roda depois da resposta; se não terminar, o pedido fica aguardando em Segurança
  const run = () => executeApiRequest(api.db, requestId, contactIds).then(() => undefined).catch((e) => console.error("api: exclusão do contato", (e as Error).message));
  try {
    after(run);
  } catch {
    void run();
  }
  return Response.json({ request_id: `dsr_${requestId}` }, { status: 202 });
}
