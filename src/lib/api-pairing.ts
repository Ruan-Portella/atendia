import { apiContacts, parseContactAddress } from "./contacts";
import { audit } from "./audit";
import { canonicalPhone } from "./phone";
import { clientIp } from "./rate-limit";
import { MAX_CONTEXT_BYTES } from "./identity";
import { createPairing, unlinkLink, type PairingChannel, type PairingDisplay } from "./pairing";
import { openField } from "./field-cipher";
import { ApiError, invalidRequest, notFound, readJsonBody, withIdempotency, type ApiContext } from "./api-v1";

/*
 * Rotas de pareamento da API (P2, permissão pairing; spec "Formatos de payload", rotas):
 * - POST /v1/pairings {bot_id, channel, external_id, context, display, expected_phone?}
 *   → 201 {code, link, expires_at} (código de 6 caracteres, 10 minutos, uso único);
 * - GET /v1/contacts/{contact}/links → os vínculos ativos;
 * - DELETE /v1/contacts/{contact}/links/{id} → 204.
 */

const sizeOf = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

/** Confere o corpo do POST /v1/pairings (400 com o campo). Função pura. */
export function parsePairingBody(body: Record<string, unknown>): { channel: PairingChannel; externalId: string; context: Record<string, unknown> | null; display: PairingDisplay | null; expectedPhone: string | null } {
  const channel = body.channel;
  if (channel !== "whatsapp" && channel !== "instagram") throw invalidRequest('channel deve ser "whatsapp" ou "instagram".', { field: "channel" });
  const ext = body.external_id;
  if (typeof ext !== "string" || !ext.trim() || ext.length > 128) throw invalidRequest("external_id é obrigatório (texto de até 128 caracteres).", { field: "external_id" });
  const ctx = body.context;
  if (ctx !== undefined && ctx !== null && (typeof ctx !== "object" || Array.isArray(ctx) || sizeOf(ctx) > MAX_CONTEXT_BYTES)) throw invalidRequest("context deve ser um objeto de até 2 KB.", { field: "context" });
  const d = body.display;
  if (d !== undefined && d !== null && (typeof d !== "object" || Array.isArray(d))) throw invalidRequest('display deve ser um objeto, ex.: {"name": "Ruan", "workspace_name": "Família Portella"}.', { field: "display" });
  const dd = (d ?? {}) as Record<string, unknown>;
  for (const k of ["name", "workspace_name"]) if (dd[k] !== undefined && (typeof dd[k] !== "string" || String(dd[k]).length > 80)) throw invalidRequest(`display.${k} deve ser texto de até 80 caracteres.`, { field: `display.${k}` });
  const display: PairingDisplay | null = d ? { ...(typeof dd.name === "string" ? { name: dd.name.trim() } : {}), ...(typeof dd.workspace_name === "string" ? { workspace_name: dd.workspace_name.trim() } : {}) } : null;
  let expectedPhone: string | null = null;
  if (body.expected_phone !== undefined && body.expected_phone !== null) {
    if (channel !== "whatsapp") throw invalidRequest("expected_phone vale só no WhatsApp.", { field: "expected_phone" });
    expectedPhone = typeof body.expected_phone === "string" ? canonicalPhone(body.expected_phone, { typed: true }) : null;
    if (!expectedPhone) throw invalidRequest("expected_phone inválido: use o número com DDD (ex.: 5521999999999).", { field: "expected_phone" });
  }
  return { channel, externalId: ext.trim(), context: (ctx as Record<string, unknown> | null) ?? null, display: display && Object.keys(display).length ? display : null, expectedPhone };
}

export async function postPairing(req: Request, api: ApiContext): Promise<Response> {
  const { raw, body } = await readJsonBody(req);
  const botId = api.requireBot(body.bot_id);
  const p = parsePairingBody(body);
  // o canal precisa estar conectado: é para ele que o link leva
  const target =
    p.channel === "whatsapp"
      ? await api.db.from("whatsapp_channels").select("display_phone").eq("bot_id", botId).limit(1).maybeSingle()
      : await api.db.from("instagram_channels").select("username").eq("bot_id", botId).is("disconnected_at", null).limit(1).maybeSingle();
  if (!target.data) throw new ApiError(422, "channel_not_connected", `O chatbot não tem ${p.channel === "whatsapp" ? "WhatsApp" : "Instagram"} conectado.`, { channel: p.channel });
  return withIdempotency(api, req, raw, async () => {
    const created = await createPairing(
      api.db,
      { botId, channel: p.channel, externalId: p.externalId, context: p.context, display: p.display, expectedPhone: p.expectedPhone, apiKeyId: api.key.id },
      { phone: (target.data as { display_phone?: string | null }).display_phone ?? null, username: (target.data as { username?: string | null }).username ?? null },
    );
    await audit(api.db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "pareamento.codigo", targetType: "bot", targetId: botId, after: { channel: p.channel, expira: created.expires_at }, ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    return { status: 201, body: { code: created.code, link: created.link, expires_at: created.expires_at } };
  });
}

/** Telefone com só os 4 últimos dígitos ("*********1234"). Função pura. */
export const maskPhone = (phone: string | null) => (phone ? `${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}` : null);

async function linksOf(req: Request, api: ApiContext, contactParam: string) {
  const addr = parseContactAddress(decodeURIComponent(contactParam));
  if (!addr) throw invalidRequest("{contact} inválido: use ctc_<id>, phone:<número>, wa:<BSUID>, ig:<id> ou ext:<id>.", { field: "contact" });
  const botParam = new URL(req.url).searchParams.get("bot_id");
  const botIds = botParam ? [api.requireBot(botParam)] : api.botIds;
  const contacts = await apiContacts(api.db, botIds, addr);
  if (!contacts.length) throw notFound();
  const { data } = await api.db
    .from("contact_links")
    .select("id, bot_id, contact_id, channel, external_id_enc, context_enc, display, linked_at")
    .in("contact_id", contacts.map((c) => c.id))
    .is("unlinked_at", null)
    .order("linked_at");
  const phoneOf = new Map(contacts.map((c) => [c.id, c.phone]));
  return Promise.all(
    (data ?? []).map(async (l) => ({
    raw: l,
    out: {
      id: `lnk_${l.id}`,
      bot_id: `bot_${l.bot_id}`,
      contact_id: `ctc_${l.contact_id}`,
      channel: l.channel,
      external_id: await openField("contact_links.external_id_enc", String(l.external_id_enc)),
      context: l.context_enc ? (JSON.parse(await openField("contact_links.context_enc", String(l.context_enc))) as unknown) : null,
      display: l.display ?? null,
      phone_masked: l.channel === "whatsapp" ? maskPhone(phoneOf.get(l.contact_id as string) ?? null) : null,
      linked_at: l.linked_at,
    },
  })),
  );
}

export async function getLinks(req: Request, api: ApiContext, contactParam: string): Promise<Response> {
  return Response.json({ data: (await linksOf(req, api, contactParam)).map((l) => l.out) });
}

export async function deleteLink(req: Request, api: ApiContext, contactParam: string, linkParam: string): Promise<Response> {
  const id = /^lnk_([0-9a-f-]{36})$/i.exec(linkParam)?.[1]?.toLowerCase();
  if (!id) throw invalidRequest("id do vínculo inválido: use lnk_<id>.", { field: "id" });
  const link = (await linksOf(req, api, contactParam)).find((l) => l.raw.id === id);
  if (!link) throw notFound();
  await unlinkLink(api.db, { id, contact_id: link.raw.contact_id as string }, "api");
  await audit(api.db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "pareamento.desvincular", targetType: "contact", targetId: link.raw.contact_id as string, after: { link: `lnk_${id}` }, ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  return new Response(null, { status: 204 });
}
