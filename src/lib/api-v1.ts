import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./supabase/admin";
import { isCustomHost } from "./domain";
import { firstExceeded } from "./rate-limit";
import { API_KEY_COLS, apiKeyHash, looksLikeApiKey, scopeBotIds, type ApiKeyRow, type ApiPermission } from "./api-keys";

/*
 * Ponto único de acesso da API pública /api/v1 (spec "Modelo central", isolamento entre bots):
 * withApiKey autentica a chave, confere a permissão e o ritmo, e entrega à rota só os bots do
 * escopo. As rotas de /api/v1 não abrem o banco por conta própria (um teste no CI confere): tudo
 * passa pelo contexto daqui. Erros no formato {"error": {"code", "message", "details"}}. A API
 * não responde nos domínios das agências (o proxy barra antes; aqui de novo, por garantia).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const apiErrorResponse = (status: number, code: string, message: string, details?: Record<string, unknown>, headers?: Record<string, string>) =>
  Response.json({ error: { code, message, ...(details ? { details } : {}) } }, { status, headers: { "Cache-Control": "no-store", ...headers } });

export const invalidRequest = (message: string, details?: Record<string, unknown>) => new ApiError(400, "invalid_request", message, details);
export const notFound = () => new ApiError(404, "not_found", "Recurso inexistente ou fora do escopo da chave.");

/** Corpo até 32 KB. */
const MAX_BODY = 32 * 1024;
/** 10 por segundo com rajada de 50 (spec, "Limites de requisições"): 50 a cada 5 segundos. */
const RATE = { max: 50, windowSeconds: 5 };
/** last_used_at é gravado no máximo uma vez por minuto. */
const TOUCH_MS = 60_000;

export interface ApiContext {
  /** Service role: use só com os bots de `botIds` (as funções de leitura recebem a lista). */
  db: SupabaseClient;
  key: Pick<ApiKeyRow, "id" | "agency_id" | "prefix" | "name">;
  /** Bots que a chave alcança agora (não demo, da agência da chave). */
  botIds: string[];
  /** bot_ do corpo ou da query → uuid do bot, se estiver no escopo; senão 403 forbidden_scope. */
  requireBot(value: unknown): string;
  /** Corpo JSON (objeto), até 32 KB; senão 400 invalid_request. */
  json(req: Request): Promise<Record<string, unknown>>;
}

const BOT_ID = /^bot_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Lê "Authorization: Bearer <chave>". */
export function bearerKey(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1] : null;
}

/** Monta o contexto da rota a partir da chave já conferida. Função pura (exceto o db). */
export function apiContext(db: SupabaseClient, key: ApiContext["key"], botIds: string[]): ApiContext {
  const scope = new Set(botIds);
  return {
    db,
    key,
    botIds,
    requireBot(value) {
      if (value === undefined || value === null || value === "") throw invalidRequest("bot_id é obrigatório nesta operação.", { field: "bot_id" });
      const m = typeof value === "string" ? BOT_ID.exec(value) : null;
      if (!m) throw invalidRequest("bot_id inválido: use o id com o prefixo bot_.", { field: "bot_id" });
      const id = m[1].toLowerCase();
      if (!scope.has(id)) throw new ApiError(403, "forbidden_scope", "Este bot está fora do escopo da chave.");
      return id;
    },
    async json(req) {
      return (await readJsonBody(req)).body;
    },
  };
}

/** Corpo JSON (objeto) até 32 KB, com o texto cru (para a Idempotency-Key); senão 400. */
export async function readJsonBody(req: Request): Promise<{ raw: string; body: Record<string, unknown> }> {
  const raw = await req.text();
  if (raw.length > MAX_BODY) throw invalidRequest("Corpo maior que 32 KB.");
  let body: unknown;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    throw invalidRequest("Corpo não é um JSON válido.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidRequest("O corpo deve ser um objeto JSON.");
  return { raw, body: body as Record<string, unknown> };
}

const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;

/**
 * Idempotency-Key (spec "Formatos de payload"): vale 24 horas, única por chave de API, guarda o
 * hash de método, rota e corpo. A mesma chave com o mesmo corpo devolve a resposta guardada (sem
 * criar de novo); com outro corpo, 409 idempotency_conflict. Uma requisição ao mesmo tempo com a
 * mesma chave espera a resposta da primeira. Erro (validação, 5xx, 429) não fica guardado: dá para
 * repetir com a mesma chave. Sem o cabeçalho, roda normalmente.
 */
export async function withIdempotency(api: ApiContext, req: Request, raw: string, run: () => Promise<{ status: number; body: unknown }>): Promise<Response> {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key) {
    const r = await run();
    return Response.json(r.body, { status: r.status });
  }
  if (key.length > 255) throw invalidRequest("Idempotency-Key com mais de 255 caracteres.", { field: "Idempotency-Key" });
  const requestHash = createHash("sha256").update(`${req.method} ${new URL(req.url).pathname}\n${raw}`).digest("hex");
  const row = { api_key_id: api.key.id, key };
  // vencida (24 h): sai e a chave vale como nova
  await api.db.from("idempotency_keys").delete().match(row).lt("created_at", new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString());
  const { error } = await api.db.from("idempotency_keys").insert({ ...row, request_hash: requestHash });
  if (error) {
    for (let i = 0; i < 10; i++) {
      const { data } = await api.db.from("idempotency_keys").select("request_hash, status, response").match(row).maybeSingle();
      if (!data) break;
      if (data.request_hash !== requestHash) throw new ApiError(409, "idempotency_conflict", "Esta Idempotency-Key já foi usada com outro corpo.");
      if (data.status) return Response.json(data.response, { status: Number(data.status), headers: { "Idempotent-Replayed": "true" } });
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new ApiError(409, "idempotency_conflict", "Uma requisição com esta Idempotency-Key ainda está em andamento. Tente de novo em instantes.");
  }
  try {
    const r = await run();
    if (r.status >= 500 || r.status === 429) await api.db.from("idempotency_keys").delete().match(row);
    else await api.db.from("idempotency_keys").update({ status: r.status, response: r.body }).match(row);
    return Response.json(r.body, { status: r.status });
  } catch (e) {
    await api.db.from("idempotency_keys").delete().match(row);
    throw e;
  }
}

type Handler<P> = (req: Request, api: ApiContext, params: P) => Promise<Response>;

/** Invólucro de toda rota de /api/v1. */
export function withApiKey<P extends Record<string, string> = Record<string, never>>(permission: ApiPermission, handler: Handler<P>) {
  return async (req: Request, route: { params: Promise<P> }): Promise<Response> => {
    try {
      if (isCustomHost(req.headers.get("host"))) return apiErrorResponse(404, "not_found", "A API do BoaVoz responde só em boavoz.com.");
      const raw = bearerKey(req.headers.get("authorization"));
      if (!raw || !looksLikeApiKey(raw)) return apiErrorResponse(401, "invalid_api_key", "Chave ausente ou inválida. Envie Authorization: Bearer <chave>.");
      const db = createAdminClient();
      const { data: key } = await db.from("api_keys").select(API_KEY_COLS).eq("key_hash", apiKeyHash(raw)).maybeSingle<ApiKeyRow>();
      if (!key || key.revoked_at) return apiErrorResponse(401, "invalid_api_key", "Chave inválida ou revogada.");
      const limited = await firstExceeded(db, [{ key: `api:${key.id}`, ...RATE, message: "rate_limited" }]);
      if (limited) return apiErrorResponse(429, "rate_limited", "Muitas requisições com esta chave. Tente de novo em instantes.", undefined, { "Retry-After": String(RATE.windowSeconds) });
      if (!key.permissions.includes(permission)) return apiErrorResponse(403, "forbidden_scope", `A chave não tem a permissão ${permission}.`, { permission });
      if (!key.last_used_at || Date.now() - Date.parse(key.last_used_at) > TOUCH_MS) {
        void db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id).then(({ error }) => error && console.error("api: last_used_at", error.message));
      }
      const botIds = await scopeBotIds(db, key);
      const ctx = apiContext(db, { id: key.id, agency_id: key.agency_id, prefix: key.prefix, name: key.name }, botIds);
      return await handler(req, ctx, await route.params);
    } catch (e) {
      if (e instanceof ApiError) return apiErrorResponse(e.status, e.code, e.message, e.details, e.headers);
      console.error("api v1:", e);
      return apiErrorResponse(500, "internal_error", "Erro interno. Tente de novo; se continuar, fale com o suporte.");
    }
  };
}
