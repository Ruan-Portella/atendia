import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, invalidRequest, notFound, readJsonBody, withIdempotency, type ApiContext } from "./api-v1";
import { keyAuthor, meta, only, requirePlatform } from "./api-provisioning";
import { audit } from "./audit";
import { firstExceeded } from "./rate-limit";
import { channelBlock } from "./features";
import { SIZE_REQUIRED, isUnsized } from "./free-account";
import { createConnectLink, openConnectLink, type LinkChannel } from "./whatsapp-connect-link";
import { botRestrictions, channelObject } from "./platform-events";
import { disconnectInstagramChannel, disconnectWhatsAppChannel } from "./channel-disconnect";
import { pauseBotNow, resumeBotNow } from "./bot-pause";
import { PAYMENT_ISSUE_CODE } from "./whatsapp";

/*
 * Canais e pausa do chatbot pela API (D', parte 4b, 19/10/2026; spec, "API de provisionamento"),
 * permissão provisioning, pacote Plataforma:
 * - POST /v1/bots/{id}/connect-links {channel, rotate?}: o link aberto do chatbot naquele canal, ou
 *   um novo (só rotate: true troca o que está aberto). Canal já conectado não dá erro: o link serve
 *   para conectar de novo, e o número novo substitui o antigo.
 * - GET /v1/bots/{id}/channels e DELETE /v1/bots/{id}/channels/{channel}: o "desconectar de vez"
 *   (tira a inscrição e apaga o token; nunca descadastra o número), até 5 por hora por chave, com
 *   alerta ao dono em cada uma.
 * - POST /v1/bots/{id}/pause {reason?, notify_contacts?} e /resume: a pausa do dono, a mesma do
 *   painel (bot-pause.ts).
 */

/** Desconexões pela API por chave, por hora. */
const DISCONNECTS_PER_HOUR = 5;

/** O chatbot da rota, no escopo da chave; o modelo não tem canais nem pausa. */
async function provisioningBot(api: ApiContext, raw: string) {
  await requirePlatform(api);
  const id = api.requireBot(raw);
  const { data: bot } = await api.db.from("bots").select("id, agency_id, client_id, name, is_template").eq("id", id).maybeSingle();
  if (!bot) throw notFound();
  if (bot.is_template) throw invalidRequest("O modelo não tem canais nem pausa: use um chatbot criado dele (POST /v1/bots).", { field: "id" });
  return { id: String(bot.id), agency_id: String(bot.agency_id), client_id: (bot.client_id as string | null) ?? null, name: String(bot.name) };
}

/* ------------------------------------------------------------------ canais */

export interface ApiChannel {
  id: string;
  type: "whatsapp" | "instagram";
  /** O número (como a Meta mostra) ou o @ da conta. */
  display: string | null;
  status: "connected" | "disconnected";
  connected_at: string;
  disconnected_at: string | null;
  /** Por que caiu (a Meta tirou o acesso, o app do celular ficou sem abrir), quando caiu. */
  reason: string | null;
  /** Conectado, mas com problema: hoje, a conta do WhatsApp sem forma de pagamento na Meta. */
  issue: { code: string; message: string; since: string } | null;
}

/** Os canais da Meta do chatbot (o chat do site vale sempre e não entra). */
export async function botChannels(db: SupabaseClient, botId: string): Promise<ApiChannel[]> {
  const [{ data: wa }, { data: ig }] = await Promise.all([
    db.from("whatsapp_channels").select("phone_number_id, display_phone, created_at, disconnected_at, disconnect_reason, payment_issue_at").eq("bot_id", botId),
    db.from("instagram_channels").select("ig_user_id, username, created_at, disconnected_at, disconnect_reason").eq("bot_id", botId),
  ]);
  const base = (r: Record<string, unknown>) => ({
    status: r.disconnected_at ? ("disconnected" as const) : ("connected" as const),
    connected_at: String(r.created_at),
    disconnected_at: (r.disconnected_at as string | null) ?? null,
    reason: (r.disconnect_reason as string | null) ?? null,
  });
  return [
    ...(wa ?? []).map((r) => ({
      ...channelObject({ type: "whatsapp", phoneNumberId: String(r.phone_number_id), display: (r.display_phone as string | null) ?? null }),
      type: "whatsapp" as const,
      ...base(r),
      issue: r.payment_issue_at && !r.disconnected_at ? { code: String(PAYMENT_ISSUE_CODE), message: "a conta do WhatsApp está sem forma de pagamento na Meta", since: String(r.payment_issue_at) } : null,
    })),
    ...(ig ?? []).map((r) => ({
      ...channelObject({ type: "instagram", igUserId: String(r.ig_user_id), username: (r.username as string | null) ?? null }),
      type: "instagram" as const,
      ...base(r),
      issue: null,
    })),
  ];
}

export async function getChannels(api: ApiContext, rawBotId: string): Promise<Response> {
  const bot = await provisioningBot(api, rawBotId);
  return Response.json({ data: await botChannels(api.db, bot.id) });
}

export async function deleteChannel(req: Request, api: ApiContext, rawBotId: string, rawChannel: string): Promise<Response> {
  const bot = await provisioningBot(api, rawBotId);
  const ch = (await botChannels(api.db, bot.id)).find((c) => c.id === rawChannel);
  if (!ch) throw notFound();
  const limited = await firstExceeded(api.db, [{ key: `api-disconnect:${api.key.id}`, max: DISCONNECTS_PER_HOUR, windowSeconds: 3600, message: "rate_limited" }]);
  if (limited) throw new ApiError(429, "rate_limited", `Até ${DISCONNECTS_PER_HOUR} desconexões por hora com a mesma chave.`, undefined, { "Retry-After": "600" });
  // o "desconectar de vez" do painel: sai a inscrição e o token; o número continua do negócio
  const r = ch.type === "whatsapp" ? await disconnectWhatsAppChannel(api.db, bot.id, "api") : await disconnectInstagramChannel(api.db, bot.id, "api");
  if (!r.ok) throw new Error("canal não desconectado");
  // alerta ao dono (alerta de segurança): toda desconexão pela API
  await audit(api.db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "canal.desconectar_api", targetType: "bot", targetId: bot.id, before: { channel: ch.type, display: ch.display, chatbot: bot.name }, ...meta(req) });
  return new Response(null, { status: 204 });
}

/* ------------------------------------------------------------------ link de conexão */

export async function postConnectLink(req: Request, api: ApiContext, rawBotId: string): Promise<Response> {
  const bot = await provisioningBot(api, rawBotId);
  const { raw, body } = await readJsonBody(req);
  only(body, ["channel", "rotate"]);
  const channel = body.channel;
  if (channel !== "whatsapp" && channel !== "instagram") throw invalidRequest("channel deve ser whatsapp ou instagram.", { field: "channel" });
  if (body.rotate !== undefined && typeof body.rotate !== "boolean") throw invalidRequest("rotate deve ser true ou false.", { field: "rotate" });
  return withIdempotency(api, req, raw, async () => {
    const blocked = await channelBlock(api.db, api.key.agency_id, channel);
    if (blocked) throw new ApiError(403, "feature_suspended", blocked, { feature: "channel", channel });
    // canal só com tamanho, como no painel
    if (await isUnsized(api.db, bot.id)) throw new ApiError(422, "bot_without_size", SIZE_REQUIRED);
    const open = body.rotate ? null : await openConnectLink(api.db, bot.id, channel as LinkChannel);
    const link = open ?? (await createConnectLink(api.db, bot.id, channel as LinkChannel));
    if (!open) await audit(api.db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "canal.link_gerar", targetType: "bot", targetId: bot.id, after: { channel, rotate: Boolean(body.rotate), por: keyAuthor(api) }, ...meta(req) });
    const connected = (await botChannels(api.db, bot.id)).find((c) => c.type === channel && c.status === "connected") ?? null;
    return { status: 200, body: { url: link.url, expires_at: link.expiresAt, channel, channel_connected: Boolean(connected), connected_channel: connected } };
  });
}

/* ------------------------------------------------------------------ pausa */

export async function postPause(req: Request, api: ApiContext, rawBotId: string): Promise<Response> {
  const bot = await provisioningBot(api, rawBotId);
  const { raw, body } = await readJsonBody(req);
  only(body, ["reason", "notify_contacts"]);
  if (body.reason !== undefined && body.reason !== null && (typeof body.reason !== "string" || body.reason.length > 200)) throw invalidRequest("reason é um texto de até 200 caracteres.", { field: "reason" });
  if (body.notify_contacts !== undefined && typeof body.notify_contacts !== "boolean") throw invalidRequest("notify_contacts deve ser true ou false.", { field: "notify_contacts" });
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
  const notify = body.notify_contacts === true;
  return withIdempotency(api, req, raw, async () => {
    const r = await pauseBotNow(api.db, api.db, bot.id, { by: "api", byLabel: `API (${api.key.name})`, reason, notify });
    if (!r) throw notFound();
    if (!r.already) await audit(api.db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "bot.pausar", targetType: "bot", targetId: bot.id, after: { reason, notify }, ...meta(req) });
    return { status: 200, body: { bot_id: `bot_${bot.id}`, paused: true, paused_at: r.pausedAt, already_paused: r.already } };
  });
}

export async function postResume(req: Request, api: ApiContext, rawBotId: string): Promise<Response> {
  const bot = await provisioningBot(api, rawBotId);
  const { raw } = await readJsonBody(req);
  return withIdempotency(api, req, raw, async () => {
    const resumed = await resumeBotNow(api.db, api.db, bot.id, "api");
    if (resumed) await audit(api.db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "bot.retomar", targetType: "bot", targetId: bot.id, ...meta(req) });
    // tira só a pausa do dono: medidas do BoaVoz e ordens da Meta continuam
    return { status: 200, body: { bot_id: `bot_${bot.id}`, paused: false, was_paused: resumed, restrictions: await botRestrictions(api.db, bot) } };
  });
}
