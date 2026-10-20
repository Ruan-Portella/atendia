import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, invalidRequest, notFound, readJsonBody, requirePermission, withIdempotency, type ApiContext } from "./api-v1";
import { applyBotBilling, assertCanBill, parseBillingFields, patchBot } from "./api-billing";
import { hasPack } from "./entitlements";
import { audit } from "./audit";
import { clientIp, firstExceeded } from "./rate-limit";
import { asContext, parseBotDisplay, parseFixedContext } from "./bot-context";
import { complianceOf, complianceSummary } from "./platform-events";
import { TEMPLATE_COLS, applyTemplate, createDerivedBot, readySourceCount, unlockedFields, type OverrideField, type TemplateField, type TemplateRow } from "./bot-template";
import { entryNoticeProblem, type BusinessHours } from "./handoff-hours";
import { assistantName, isEmail } from "./validation";
import { initials, normalizeUrl } from "./utils";

/*
 * API de provisionamento (D', parte 4a, 19/10/2026; spec, "API de provisionamento"), permissão
 * provisioning, do pacote Plataforma ("lojas pela API"):
 * - POST /v1/clients {name, external_id, site?, utility_consent?}: o cliente (a loja), só com chave
 *   de escopo da conta inteira; o external_id torna idempotente (o mesmo external_id devolve o
 *   cliente que já existe, com 200).
 * - POST /v1/bots {client_id, template_id, external_id?, context?, display?, overrides?, size?,
 *   overage?}: o chatbot da loja a partir do modelo, com Idempotency-Key obrigatório; idempotente
 *   por cliente e external_id. size e overage pedem também a permissão billing (subir cobra).
 * - GET /v1/clients/{id}: os dados, os chatbots e a conformidade do cliente (nunca
 *   feature_suspended).
 */

const CLI_ID = /^cli_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const BOT_ID = /^bot_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
/** Clientes e chatbots novos por chave, por hora. */
const CREATE_PER_HOUR = 300;
export const EXTERNAL_ID_MAX = 120;
const UTILITY_ORIGINS = ["cadastro", "contrato", "compra", "outro"] as const;

const NO_PACK = () => new ApiError(403, "plan_not_allowed", "Clientes e chatbots pela API fazem parte do pacote Plataforma. Assine em Cobrança → Assinatura.", { pack: "plataforma" });

export async function requirePlatform(api: ApiContext) {
  if (!(await hasPack(api.db, api.key.agency_id, "plataforma"))) throw NO_PACK();
}

async function creationLimit(api: ApiContext, what: "clients" | "bots") {
  const limited = await firstExceeded(api.db, [{ key: `api-${what}:${api.key.id}`, max: CREATE_PER_HOUR, windowSeconds: 3600, message: "rate_limited" }]);
  if (limited) throw new ApiError(429, "rate_limited", `Até ${CREATE_PER_HOUR} ${what === "clients" ? "clientes" : "chatbots"} novos por hora com a mesma chave.`, undefined, { "Retry-After": "600" });
}

/** Quem fez, para as declarações e as versões do modelo: a chave (nunca o texto dela). */
export const keyAuthor = (api: ApiContext) => `Chave da API "${api.key.name}" (${api.key.prefix}…)`;

export const meta = (req: Request) => ({ ip: clientIp(req), userAgent: req.headers.get("user-agent") });

/* ------------------------------------------------------------------ leitura do corpo (puras) */

/** external_id: texto de 1 a 120 caracteres, sem quebra de linha. */
export function parseExternalId(v: unknown, field = "external_id"): string {
  if (typeof v !== "string" || !v.trim()) throw invalidRequest(`${field} é obrigatório: o id deste registro no seu sistema.`, { field });
  const t = v.trim();
  if (t.length > EXTERNAL_ID_MAX || /[\u0000-\u001f\u007f]/.test(t)) throw invalidRequest(`${field} vai até ${EXTERNAL_ID_MAX} caracteres, sem quebra de linha.`, { field });
  return t;
}

/** Campo fora da lista: 400 apontando o campo. */
export const only = (body: Record<string, unknown>, allowed: readonly string[]) => {
  const extra = Object.keys(body).find((k) => !allowed.includes(k));
  if (extra) throw invalidRequest(`Campo não aceito aqui: ${extra.slice(0, 40)}. Use ${allowed.join(", ")}.`, { field: extra.slice(0, 40) });
};

export interface ClientInput {
  name: string;
  externalId: string;
  site: string | null;
  utilityConsent: { source: (typeof UTILITY_ORIGINS)[number]; text: string } | null;
}

/** O corpo do POST /v1/clients. Pura. */
export function parseClientBody(body: Record<string, unknown>): ClientInput {
  only(body, ["name", "external_id", "site", "utility_consent"]);
  const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 2 || name.length > 80) throw invalidRequest("name vai de 2 a 80 caracteres.", { field: "name" });
  const externalId = parseExternalId(body.external_id);
  let site: string | null = null;
  if (body.site !== undefined && body.site !== null && body.site !== "") {
    site = typeof body.site === "string" && body.site.length <= 200 ? normalizeUrl(body.site) : null;
    if (!site) throw invalidRequest("site precisa ser um endereço, como pizzariadoze.com.br (até 200 caracteres).", { field: "site" });
  }
  let utilityConsent: ClientInput["utilityConsent"] = null;
  if (body.utility_consent !== undefined && body.utility_consent !== null) {
    const c = body.utility_consent;
    if (!c || typeof c !== "object" || Array.isArray(c)) throw invalidRequest("utility_consent deve ser um objeto {source, text}.", { field: "utility_consent" });
    const { source, text } = c as Record<string, unknown>;
    if (typeof source !== "string" || !(UTILITY_ORIGINS as readonly string[]).includes(source)) throw invalidRequest(`utility_consent.source deve ser ${UTILITY_ORIGINS.join(", ")}.`, { field: "utility_consent.source" });
    const t = typeof text === "string" ? text.trim() : "";
    if (t.length < 20 || t.length > 1000) throw invalidRequest("utility_consent.text vai de 20 a 1.000 caracteres: como os contatos aceitaram (o trecho do contrato ou do cadastro).", { field: "utility_consent.text" });
    utilityConsent = { source: source as (typeof UTILITY_ORIGINS)[number], text: t };
  }
  return { name, externalId, site, utilityConsent };
}

/** Os valores próprios pela API e o campo do modelo que cada um precisa liberado. */
export const OVERRIDE_KEYS = {
  assistant_name: "nome",
  welcome: "saudacao",
  appearance: "aparencia",
  handoff_notice: "anuncio",
  extra_instructions: "instrucoes",
} as const satisfies Record<string, TemplateField>;
type OverrideKey = keyof typeof OVERRIDE_KEYS;
const isOverrideKey = (k: string): k is OverrideKey => Object.prototype.hasOwnProperty.call(OVERRIDE_KEYS, k);

export interface OverridesInput {
  overrides: Partial<Record<OverrideField, unknown>>;
  /** undefined: não veio; null: sem instruções extras. */
  extraInstructions?: string | null;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * overrides do corpo: só os campos que o modelo libera (senão 403 field_locked), com as regras do
 * painel. A aparência vale por cima da do modelo (as iniciais do cliente quando não vêm). Pura.
 */
export function parseOverrides(raw: unknown, o: { unlocked: TemplateField[]; templateAppearance: Record<string, unknown> | null; clientName: string }): OverridesInput {
  if (raw === undefined || raw === null) return { overrides: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalidRequest("overrides deve ser um objeto.", { field: "overrides" });
  const out: OverridesInput = { overrides: {} };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isOverrideKey(k)) throw invalidRequest(`overrides.${k.slice(0, 40)} não existe. Use ${Object.keys(OVERRIDE_KEYS).join(", ")}.`, { field: `overrides.${k.slice(0, 40)}` });
    const field = `overrides.${k}`;
    if (!o.unlocked.includes(OVERRIDE_KEYS[k])) throw new ApiError(403, "field_locked", `O modelo não libera ${k} para os chatbots derivados.`, { field });
    if (k === "extra_instructions") {
      if (v !== null && typeof v !== "string") throw invalidRequest(`${field} deve ser texto ou null.`, { field });
      const t = typeof v === "string" ? v.trim() : "";
      if (t.length > 4000) throw invalidRequest(`${field} vai até 4.000 caracteres.`, { field });
      out.extraInstructions = t || null;
      continue;
    }
    if (k === "assistant_name") {
      const n = assistantName(typeof v === "string" ? v : "");
      if ("error" in n) throw invalidRequest(`${field}: ${n.error}`, { field });
      out.overrides.nome = n.name;
    } else if (k === "welcome") {
      const t = typeof v === "string" ? v.trim() : "";
      if (!t || t.length > 300) throw invalidRequest(`${field} vai de 1 a 300 caracteres.`, { field });
      out.overrides.saudacao = t;
    } else if (k === "handoff_notice") {
      const t = typeof v === "string" ? v.trim() : "";
      const problem = t ? entryNoticeProblem(t) : "O anúncio não pode ficar vazio.";
      if (problem) throw invalidRequest(`${field}: ${problem}`, { field });
      out.overrides.anuncio = t;
    } else {
      out.overrides.aparencia = parseAppearance(v, field, o);
    }
  }
  return out;
}

function parseAppearance(v: unknown, field: string, o: { templateAppearance: Record<string, unknown> | null; clientName: string }): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw invalidRequest(`${field} deve ser um objeto {color, avatar_text, suggested_questions, position, offset}.`, { field });
  const a = v as Record<string, unknown>;
  const extra = Object.keys(a).find((k) => !["color", "avatar_text", "suggested_questions", "position", "offset"].includes(k));
  if (extra) throw invalidRequest(`${field}.${extra.slice(0, 40)} não existe.`, { field: `${field}.${extra.slice(0, 40)}` });
  // as iniciais do cliente quando a aparência de partida não tem (a do modelo nunca tem)
  const base: Record<string, unknown> = { avatar_text: initials(o.clientName), ...(o.templateAppearance ?? {}) };
  if (a.color !== undefined) {
    if (typeof a.color !== "string" || !COLOR.test(a.color)) throw invalidRequest(`${field}.color é uma cor como #1f4e3d.`, { field: `${field}.color` });
    base.color = a.color;
  }
  if (a.avatar_text !== undefined) {
    if (typeof a.avatar_text !== "string" || !a.avatar_text.trim() || a.avatar_text.trim().length > 2) throw invalidRequest(`${field}.avatar_text vai de 1 a 2 letras.`, { field: `${field}.avatar_text` });
    base.avatar_text = a.avatar_text.trim().toUpperCase();
  }
  if (a.suggested_questions !== undefined) {
    const q = a.suggested_questions;
    if (!Array.isArray(q) || q.length > 6 || q.some((s) => typeof s !== "string" || !s.trim() || s.length > 100)) throw invalidRequest(`${field}.suggested_questions é uma lista de até 6 perguntas (até 100 caracteres cada).`, { field: `${field}.suggested_questions` });
    base.suggested_questions = q.map((s) => (s as string).trim());
  }
  if (a.position !== undefined) {
    if (a.position !== "left" && a.position !== "right") throw invalidRequest(`${field}.position é left ou right.`, { field: `${field}.position` });
    base.position = a.position;
  }
  if (a.offset !== undefined) {
    if (typeof a.offset !== "number" || !Number.isInteger(a.offset) || a.offset < 0 || a.offset > 200) throw invalidRequest(`${field}.offset vai de 0 a 200 (pixels).`, { field: `${field}.offset` });
    base.offset = a.offset;
  }
  return base;
}

export interface BotInput {
  clientId: string;
  templateId: string;
  externalId: string | null;
  context: Record<string, unknown> | null;
  display: Record<string, unknown> | null;
  /** O que veio em overrides (lido depois, com o modelo: parseOverrides). */
  overrides: unknown;
}

/** O corpo do POST /v1/bots, sem os valores próprios (dependem do modelo) e sem a cobrança. Pura. */
export function parseBotBody(body: Record<string, unknown>): BotInput {
  only(body, ["client_id", "template_id", "external_id", "context", "display", "overrides", "size", "volume_packs", "overage"]);
  const c = typeof body.client_id === "string" ? CLI_ID.exec(body.client_id) : null;
  if (!c) throw invalidRequest("client_id é obrigatório, com o prefixo cli_ (o id que o POST /v1/clients devolveu).", { field: "client_id" });
  const t = typeof body.template_id === "string" ? BOT_ID.exec(body.template_id) : null;
  if (!t) throw invalidRequest("template_id é obrigatório: o id do modelo, com o prefixo bot_.", { field: "template_id" });
  const externalId = body.external_id === undefined || body.external_id === null ? null : parseExternalId(body.external_id);
  const ctx = parseFixedContext(body.context);
  if ("error" in ctx) throw invalidRequest(ctx.error, { field: "context" });
  const display = parseBotDisplay(body.display);
  if ("error" in display) throw invalidRequest(display.error, { field: "display" });
  return { clientId: c[1].toLowerCase(), templateId: t[1].toLowerCase(), externalId, context: ctx.value, display: display.value, overrides: body.overrides };
}

/* ------------------------------------------------------------------ escopo do cliente */

/**
 * O cliente de um id cli_, se a chave alcança: escopo da conta, o cliente da chave, ou (escopo de
 * chatbots) um cliente com algum chatbot da lista. Fora do escopo ou inexistente: 404.
 */
export async function requireClient(api: ApiContext, raw: unknown): Promise<string> {
  const m = typeof raw === "string" ? CLI_ID.exec(raw) : null;
  if (!m) throw notFound();
  const id = m[1].toLowerCase();
  if (api.key.scope_type === "client" && api.key.scope_client_id !== id) throw notFound();
  const { data } = await api.db.from("clients").select("id").eq("id", id).eq("agency_id", api.key.agency_id).maybeSingle();
  if (!data) throw notFound();
  if (api.key.scope_type === "bots") {
    const { data: bots } = api.botIds.length ? await api.db.from("bots").select("id").eq("client_id", id).in("id", api.botIds).limit(1) : { data: [] };
    if (!bots?.length) throw notFound();
  }
  return id;
}

/* ------------------------------------------------------------------ POST /v1/clients */

const CLIENT_COLS = "id, name, site, external_id, created_at, utility_consent_origin, utility_consent_text, utility_consent_by, utility_consent_at";

async function clientByExternalId(db: SupabaseClient, agencyId: string, externalId: string) {
  const { data } = await db.from("clients").select(CLIENT_COLS).eq("agency_id", agencyId).eq("external_id", externalId).maybeSingle();
  return data;
}

async function createdClientJson(db: SupabaseClient, c: Record<string, unknown>) {
  const compliance = (await complianceOf(db, [c.id as string])).get(c.id as string);
  return { client_id: `cli_${c.id}`, external_id: c.external_id ?? null, name: c.name, compliance_status: compliance?.status ?? "active" };
}

export async function postClient(req: Request, api: ApiContext): Promise<Response> {
  if (!api.scopeAll) throw new ApiError(403, "forbidden_scope", "Criar cliente é operação da conta: use uma chave com escopo de toda a conta.");
  await requirePlatform(api);
  const { raw, body } = await readJsonBody(req);
  const input = parseClientBody(body);
  return withIdempotency(api, req, raw, async () => {
    const existing = await clientByExternalId(api.db, api.key.agency_id, input.externalId);
    if (existing) return { status: 200, body: await createdClientJson(api.db, existing) };
    await creationLimit(api, "clients");
    const at = new Date().toISOString();
    const consent = input.utilityConsent ? { utility_consent_origin: input.utilityConsent.source, utility_consent_text: input.utilityConsent.text, utility_consent_by: keyAuthor(api), utility_consent_at: at } : {};
    const { data, error } = await api.db.from("clients").insert({ agency_id: api.key.agency_id, name: input.name, site: input.site, external_id: input.externalId, ...consent }).select(CLIENT_COLS).single();
    if (error || !data) {
      // dois pedidos ao mesmo tempo com o mesmo external_id: o segundo devolve o do primeiro
      const again = /duplicate|unique/i.test(error?.message ?? "") ? await clientByExternalId(api.db, api.key.agency_id, input.externalId) : null;
      if (again) return { status: 200, body: await createdClientJson(api.db, again) };
      throw new Error(`cliente não criado: ${error?.message ?? "sem linha"}`);
    }
    const who = { agencyId: api.key.agency_id, actorType: "api_key" as const, actorId: api.key.id, targetType: "client", targetId: data.id as string, ...meta(req) };
    await audit(api.db, { ...who, action: "cliente.criar", after: { nome: input.name, external_id: input.externalId, site: input.site } });
    if (input.utilityConsent) await audit(api.db, { ...who, action: "cliente.lembretes_declarar", after: { origem: input.utilityConsent.source, texto: input.utilityConsent.text, por: keyAuthor(api) } });
    return { status: 201, body: await createdClientJson(api.db, data) };
  });
}

/* ------------------------------------------------------------------ GET /v1/clients/{id} */

export async function getClient(api: ApiContext, rawId: string): Promise<Response> {
  await requirePlatform(api);
  const id = await requireClient(api, rawId);
  const { data: c } = await api.db.from("clients").select(CLIENT_COLS).eq("id", id).maybeSingle();
  if (!c) throw notFound();
  // os chatbots do cliente que a chave alcança (na conta inteira, todos)
  let q = api.db.from("bots").select("id, name, external_id, status, paused_at, template_id, created_at").eq("client_id", id).eq("is_demo", false).order("created_at");
  if (!api.scopeAll) q = q.in("id", api.botIds.length ? api.botIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: bots, error } = await q;
  if (error) throw new Error(`chatbots do cliente: ${error.message}`);
  const ids = (bots ?? []).map((b) => b.id as string);
  const [wa, ig, compliance] = await Promise.all([
    ids.length ? api.db.from("whatsapp_channels").select("bot_id").in("bot_id", ids).is("disconnected_at", null) : Promise.resolve({ data: [] }),
    ids.length ? api.db.from("instagram_channels").select("bot_id").in("bot_id", ids).is("disconnected_at", null) : Promise.resolve({ data: [] }),
    complianceOf(api.db, [id]),
  ]);
  const has = (rows: Array<{ bot_id: unknown }> | null, botId: string) => (rows ?? []).some((r) => r.bot_id === botId);
  const state = compliance.get(id) ?? { status: "active" as const, restrictions: [] };
  return Response.json({
    id: `cli_${c.id}`,
    external_id: c.external_id ?? null,
    name: c.name,
    site: c.site ?? null,
    created_at: c.created_at,
    utility_consent: c.utility_consent_origin ? { source: c.utility_consent_origin, text: c.utility_consent_text, declared_by: c.utility_consent_by, declared_at: c.utility_consent_at } : null,
    bots: (bots ?? []).map((b) => ({
      id: `bot_${b.id}`,
      external_id: b.external_id ?? null,
      name: b.name,
      status: b.status,
      paused: Boolean(b.paused_at),
      template_id: b.template_id ? `bot_${b.template_id}` : null,
      // o chat do site vale sempre; aqui, os canais da Meta conectados
      channels: [...(has(wa.data, b.id as string) ? ["whatsapp"] : []), ...(has(ig.data, b.id as string) ? ["instagram"] : [])],
    })),
    compliance: { status: state.status, restrictions: state.restrictions, ...complianceSummary(state) },
  });
}

/* ------------------------------------------------------------------ POST /v1/bots */

async function botByExternalId(db: SupabaseClient, clientId: string, externalId: string) {
  const { data } = await db.from("bots").select("id").eq("client_id", clientId).eq("external_id", externalId).maybeSingle();
  return data ? String(data.id) : null;
}

export async function postBot(req: Request, api: ApiContext): Promise<Response> {
  if (!req.headers.get("idempotency-key")?.trim()) throw invalidRequest("Idempotency-Key é obrigatório em POST /v1/bots (uma chave por chatbot: repetir não cria outro).", { field: "Idempotency-Key" });
  if (api.key.scope_type === "bots") throw new ApiError(403, "forbidden_scope", "Uma chave com escopo de chatbots não cria chatbot: use uma chave do cliente ou da conta inteira.");
  await requirePlatform(api);
  const { raw, body } = await readJsonBody(req);
  const input = parseBotBody(body);
  const billing = parseBillingFields(body);
  if ((billing.size || billing.overage) && !api.key.permissions?.includes("billing")) {
    throw new ApiError(403, "forbidden_scope", "size e overage pedem também a permissão billing na chave (subir de tamanho cobra no cartão da assinatura).", { permission: "billing" });
  }
  const clientId = await requireClient(api, `cli_${input.clientId}`);
  return withIdempotency(api, req, raw, async () => {
    const db = api.db;
    const { data: template } = await db.from("bots").select(TEMPLATE_COLS).eq("id", input.templateId).eq("agency_id", api.key.agency_id).eq("is_template", true).is("version_of", null).maybeSingle<TemplateRow>();
    if (!template) throw new ApiError(404, "not_found", "Modelo não encontrado nesta conta.", { field: "template_id" });
    const { data: client } = await db.from("clients").select("id, name, site").eq("id", clientId).single();
    if (!client) throw notFound();
    const own = parseOverrides(input.overrides, { unlocked: unlockedFields(template), templateAppearance: template.appearance, clientName: String(client.name) });
    await assertCanBill(api, billing);
    let botId = input.externalId ? await botByExternalId(db, clientId, input.externalId) : null;
    let created = false;
    if (!botId) {
      await creationLimit(api, "bots");
      // nasce no ar quando o modelo tem fonte pronta (a regra do Publicar do painel): a loja já atende
      const live = (await readySourceCount(db, { id: template.id })) > 0;
      try {
        botId = await createDerivedBot(db, {
          live,
          agencyId: api.key.agency_id,
          templateId: template.id,
          client: { id: String(client.id), name: String(client.name), site: (client.site as string | null) ?? null },
          fixedContext: input.context,
          fixedDisplay: input.display,
          externalId: input.externalId,
          overrides: own.overrides,
          extraInstructions: own.extraInstructions ?? null,
          publishedBy: keyAuthor(api),
        });
        created = true;
      } catch (e) {
        // dois pedidos ao mesmo tempo com o mesmo external_id: o segundo fica com o do primeiro
        const again = input.externalId && /duplicate|unique/i.test((e as Error).message) ? await botByExternalId(db, clientId, input.externalId) : null;
        if (!again) throw e;
        botId = again;
      }
      if (created) {
        await audit(db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "modelo.derivar", targetType: "bot", targetId: botId, after: { modelo: template.id, cliente: clientId, external_id: input.externalId, contexto: input.context ? Object.keys(input.context) : [], display: input.display ? Object.keys(input.display) : [], valores_proprios: [...Object.keys(own.overrides), ...(own.extraInstructions !== undefined ? ["instrucoes"] : [])] }, ...meta(req) });
      }
    }
    // tamanho e excedente: as regras do PATCH (repetir depois de um 402 tenta de novo)
    let sizeChange: unknown = null;
    if (billing.size || billing.overage) {
      const r = await applyBotBilling(api, botId, billing, { bot_id: `bot_${botId}` });
      if ("paymentRequired" in r) return r.paymentRequired;
      sizeChange = r.sizeChange;
    }
    const { data: bot } = await db.from("bots").select("id, name, status, public_key, external_id, fixed_context, fixed_display, template_id").eq("id", botId).single();
    if (!bot) throw new Error("chatbot criado e não encontrado");
    return {
      status: created ? 201 : 200,
      body: {
        bot_id: `bot_${bot.id}`,
        widget_key: bot.public_key,
        client_id: `cli_${clientId}`,
        external_id: bot.external_id ?? null,
        template_id: bot.template_id ? `bot_${bot.template_id}` : null,
        name: bot.name,
        status: bot.status,
        context: asContext(bot.fixed_context),
        display: asContext(bot.fixed_display),
        size_change: sizeChange,
      },
    };
  });
}

/* ------------------------------------------------------------------ PATCH /v1/bots/{id} (parte 4d) */

const BILLING_FIELDS = ["size", "volume_packs", "overage"];
const BOT_FIELDS = ["display", "overrides", "business_hours", "handoff_destination"];

/**
 * PATCH /v1/bots/{id}: a cobrança (size e overage, permissão billing, a resposta é o uso) ou o
 * chatbot (display, overrides, business_hours e handoff_destination, permissão provisioning, a
 * resposta é o chatbot). Os dois juntos no mesmo pedido: 400.
 */
export async function patchBotAny(req: Request, api: ApiContext, rawBotId: string): Promise<Response> {
  const read = await readJsonBody(req);
  const billing = Object.keys(read.body).some((k) => BILLING_FIELDS.includes(k));
  const bot = Object.keys(read.body).some((k) => BOT_FIELDS.includes(k));
  if (billing && bot) throw invalidRequest("Mande a cobrança (size, volume_packs, overage) e os dados do chatbot em pedidos separados: as respostas são diferentes.");
  if (billing) {
    requirePermission(api, "billing");
    return patchBot(req, api, rawBotId, read);
  }
  requirePermission(api, "provisioning");
  return patchBotFields(req, api, rawBotId, read);
}

const KEY_OF_FIELD: Record<OverrideField, string> = { nome: "assistant_name", saudacao: "welcome", aparencia: "appearance", anuncio: "handoff_notice" };
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DESTINATION_KEYS = ["email", "phone", "site", "form_url", "address"] as const;
type DestinationKey = (typeof DESTINATION_KEYS)[number];

/** overrides do PATCH: null volta ao modelo; o resto, com as regras do POST. Pura. */
export function parseOverridesPatch(raw: unknown, o: { unlocked: TemplateField[]; templateAppearance: Record<string, unknown> | null; clientName: string }): OverridesInput & { reset: OverrideField[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidRequest("overrides deve ser um objeto.", { field: "overrides" });
  const reset: OverrideField[] = [];
  const rest: Record<string, unknown> = {};
  let extraReset = false;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v !== null || !isOverrideKey(k)) {
      rest[k] = v;
      continue;
    }
    if (!o.unlocked.includes(OVERRIDE_KEYS[k])) throw new ApiError(403, "field_locked", `O modelo não libera ${k} para os chatbots derivados.`, { field: `overrides.${k}` });
    if (k === "extra_instructions") extraReset = true;
    else reset.push(OVERRIDE_KEYS[k] as OverrideField);
  }
  const parsed = parseOverrides(rest, o);
  return { overrides: parsed.overrides, extraInstructions: parsed.extraInstructions !== undefined ? parsed.extraInstructions : extraReset ? null : undefined, reset };
}

/** business_hours: {sun..sat: ["09:00", "18:00"] | null}; null (ou tudo fechado) tira o horário. Pura. */
export function parseBusinessHours(raw: unknown): BusinessHours | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidRequest('business_hours deve ser um objeto como {"mon": ["09:00", "18:00"]} (sun a sat; null para fechado).', { field: "business_hours" });
  const out: BusinessHours = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const day = (DAY_KEYS as readonly string[]).indexOf(k);
    if (day < 0) throw invalidRequest(`business_hours.${k.slice(0, 20)} não existe: use sun, mon, tue, wed, thu, fri e sat.`, { field: `business_hours.${k.slice(0, 20)}` });
    if (v === null) continue;
    const ok = Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "string" && HHMM.test(x)) && (v[0] as string) < (v[1] as string);
    if (!ok) throw invalidRequest(`business_hours.${k} é ["HH:MM", "HH:MM"], com a abertura antes do fechamento (horário de Brasília).`, { field: `business_hours.${k}` });
    out[String(day) as keyof BusinessHours] = [v[0] as string, v[1] as string];
  }
  return Object.keys(out).length ? out : null;
}

/** handoff_destination: os outros jeitos de falar com a equipe (null tira cada um), como no painel. */
async function parseHandoffDestination(db: SupabaseClient, botId: string, raw: unknown): Promise<Partial<Record<DestinationKey, string | null>>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidRequest("handoff_destination deve ser um objeto {email, phone, site, form_url, address}.", { field: "handoff_destination" });
  const out: Partial<Record<DestinationKey, string | null>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(DESTINATION_KEYS as readonly string[]).includes(k)) throw invalidRequest(`handoff_destination.${k.slice(0, 20)} não existe: use ${DESTINATION_KEYS.join(", ")}.`, { field: `handoff_destination.${k.slice(0, 20)}` });
    const key = k as DestinationKey;
    const field = `handoff_destination.${key}`;
    if (v === null || v === "") {
      out[key] = null;
      continue;
    }
    if (typeof v !== "string") throw invalidRequest(`${field} deve ser texto ou null.`, { field });
    const t = v.trim();
    if (key === "email") {
      if (!isEmail(t) || t.length > 200) throw invalidRequest(`${field} inválido.`, { field });
      out.email = t.toLowerCase();
    } else if (key === "site" || key === "form_url") {
      const u = t.length <= 300 ? normalizeUrl(t) : null;
      if (!u) throw invalidRequest(`${field} precisa ser um endereço, como pizzariadoze.com.br/contato.`, { field });
      out[key] = u;
    } else if (key === "phone") {
      const digits = t.replace(/\D/g, "");
      if (digits.length < 10 || t.length > 30) throw invalidRequest(`${field} precisa do DDD, como (21) 3333-4444.`, { field });
      // fora da coexistência, o número do próprio chatbot é atendido pelo chatbot
      const { data: wa } = await db.from("whatsapp_channels").select("display_phone, coexistence").eq("bot_id", botId).maybeSingle();
      const botDigits = String(wa?.display_phone ?? "").replace(/\D/g, "");
      if (botDigits && !wa?.coexistence && (botDigits.endsWith(digits) || digits.endsWith(botDigits))) throw invalidRequest(`${field} é o número do WhatsApp do próprio chatbot: informe outro telefone da equipe.`, { field });
      out.phone = t;
    } else {
      out.address = t.slice(0, 200);
    }
  }
  return out;
}

const BOT_VIEW_COLS = "id, name, client_id, external_id, template_id, public_key, fixed_display, overrides, extra_instructions, human_handoff";

/** O chatbot como o PATCH devolve (o que a plataforma muda pela API). */
export function botFieldsJson(b: Record<string, unknown>) {
  const ov = (b.overrides ?? {}) as Record<string, unknown>;
  const h = (b.human_handoff ?? {}) as Record<string, unknown>;
  const hours = (h.hours ?? null) as BusinessHours | null;
  return {
    bot_id: `bot_${b.id}`,
    name: b.name,
    client_id: b.client_id ? `cli_${b.client_id}` : null,
    external_id: b.external_id ?? null,
    template_id: b.template_id ? `bot_${b.template_id}` : null,
    widget_key: b.public_key,
    display: asContext(b.fixed_display),
    // só no derivado: os valores próprios guardados (vale o que o modelo libera agora)
    overrides: b.template_id
      ? { ...Object.fromEntries(Object.entries(ov).filter(([k]) => k in KEY_OF_FIELD).map(([k, v]) => [KEY_OF_FIELD[k as OverrideField], v])), ...(b.extra_instructions ? { extra_instructions: b.extra_instructions } : {}) }
      : null,
    business_hours: hours ? Object.fromEntries(DAY_KEYS.map((d, i) => [d, hours[String(i) as keyof BusinessHours] ?? null])) : null,
    handoff_destination: Object.fromEntries(DESTINATION_KEYS.map((k) => [k, (h[k] as string | null | undefined) ?? null])),
  };
}

async function patchBotFields(req: Request, api: ApiContext, rawBotId: string, read: { raw: string; body: Record<string, unknown> }): Promise<Response> {
  await requirePlatform(api);
  const botId = api.requireBot(rawBotId);
  const { raw, body } = read;
  only(body, BOT_FIELDS);
  if (!Object.keys(body).length) throw invalidRequest(`Mande ${BOT_FIELDS.join(", ")} (ou, com a permissão billing, size e overage).`);
  return withIdempotency(api, req, raw, async () => {
    const db = api.db;
    const { data: bot } = await db.from("bots").select(`${BOT_VIEW_COLS}, client_name, is_template, appearance`).eq("id", botId).maybeSingle();
    if (!bot) throw notFound();
    if (bot.is_template) throw invalidRequest("O modelo muda no painel (e chega aos derivados ao publicar).", { field: "id" });
    const patch: Record<string, unknown> = {};
    const changed: string[] = [];
    if ("display" in body) {
      const d = parseBotDisplay(body.display);
      if ("error" in d) throw invalidRequest(d.error, { field: "display" });
      patch.fixed_display = d.value;
      changed.push("display");
    }
    let reapply = false;
    if ("overrides" in body) {
      if (!bot.template_id) throw invalidRequest("overrides vale só para chatbot criado de um modelo; nos outros, o painel muda tudo.", { field: "overrides" });
      const { data: t } = await db.from("bots").select(TEMPLATE_COLS).eq("id", bot.template_id).maybeSingle<TemplateRow>();
      if (!t) throw new Error("modelo do derivado não encontrado");
      // a aparência parte da que o chatbot tem agora
      const own = parseOverridesPatch(body.overrides, { unlocked: unlockedFields(t), templateAppearance: (bot.appearance as Record<string, unknown> | null) ?? t.appearance, clientName: String(bot.client_name) });
      const next = { ...((bot.overrides ?? {}) as Record<string, unknown>) };
      for (const f of own.reset) delete next[f];
      Object.assign(next, own.overrides);
      patch.overrides = next;
      if (own.extraInstructions !== undefined) patch.extra_instructions = own.extraInstructions;
      reapply = true;
      changed.push("overrides");
    }
    let destination: { before: Record<string, unknown>; after: Record<string, unknown> } | null = null;
    if ("business_hours" in body || "handoff_destination" in body) {
      const h: Record<string, unknown> = { ...((bot.human_handoff ?? {}) as Record<string, unknown>) };
      if ("business_hours" in body) {
        h.hours = parseBusinessHours(body.business_hours);
        changed.push("business_hours");
      }
      if ("handoff_destination" in body) {
        const dest = await parseHandoffDestination(db, botId, body.handoff_destination);
        const before = Object.fromEntries(Object.keys(dest).map((k) => [k, h[k] ?? null]));
        Object.assign(h, dest);
        if (JSON.stringify(before) !== JSON.stringify(dest)) destination = { before, after: dest };
        changed.push("handoff_destination");
      }
      patch.human_handoff = h;
    }
    const { error } = await db.from("bots").update(patch).eq("id", botId);
    if (error) throw new Error(`chatbot não salvo: ${error.message}`);
    // os valores próprios valem pela propagação do modelo (a mesma do painel)
    if (reapply) await applyTemplate(db, String(bot.template_id), [botId]);
    const who = { agencyId: api.key.agency_id, actorType: "api_key" as const, actorId: api.key.id, targetType: "bot", targetId: botId, ...meta(req) };
    await audit(db, { ...who, action: "bot.editar_api", after: { campos: changed } });
    // para onde a pessoa é mandada quando quer falar com a equipe: alerta de segurança ao dono
    if (destination) await audit(db, { ...who, action: "bot.destino_atendimento_api", before: destination.before, after: destination.after });
    const { data: saved } = await db.from("bots").select(BOT_VIEW_COLS).eq("id", botId).single();
    return { status: 200, body: botFieldsJson(saved ?? {}) };
  });
}
