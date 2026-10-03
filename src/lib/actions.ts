import { createHash, randomBytes } from "node:crypto";
import { generateText } from "ai";
import { Webhook } from "standardwebhooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seal, unseal } from "./secret-box";
import { BlockedUrlError, checkUrl, safePost } from "./safe-fetch";
import { chatModel, classifierModelId, modelCallOptions } from "./ai";
import { recordAiUsage, usageFrom } from "./ai-usage";

/*
 * Ações (Integrações, núcleo da P1; spec "Peça 1" e "Formatos de payload", seção 2): um endpoint
 * HTTP do desenvolvedor que a IA do bot chama durante a conversa. Na P1 só existem ações de
 * consulta, configuradas à mão pelo BoaVoz. Toda chamada:
 *   - vai pelo safePost (só HTTPS, sem redirecionamento, prazo de 8 s, resposta até 32 KB);
 *   - é assinada no padrão Standard Webhooks (pacote oficial) com o segredo de ações do bot (ou o
 *     da ação), a cada tentativa; na troca, as duas assinaturas por 24 horas;
 *   - fica em action_calls (uma linha por tentativa; o call_id repete no reprocesso, e uma
 *     resposta ok já gravada é reaproveitada sem chamar o endpoint).
 */

export type ActionType = "query" | "execute";
export type ActionLevel = "anonimo" | "canal" | "usuario";
export type CallStatus = "ok" | "not_found" | "error" | "timeout" | "uncertain" | "blocked";
export type CallMode = "normal" | "preview" | "test";

export interface ActionRow {
  id: string;
  bot_id: string;
  name: string;
  description: string;
  type: ActionType;
  min_level: ActionLevel;
  context_required: "none" | "signed";
  outcomes: string[];
  params_schema: ParamsSchema;
  supports_preview: boolean;
  url: string;
  secret_enc: string | null;
  headers_enc: string | null;
  active: boolean;
  creates_order: boolean | null;
  /** Transação (pedido, carrinho, reserva, cobrança): bebida e remédio nunca listados nos canais da Meta. */
  transactional: boolean;
}

export interface ParamsSchema {
  type: "object";
  properties: Record<string, ParamSchema>;
  required?: string[];
}

export interface ParamSchema {
  type: "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  enum?: Array<string | number>;
  items?: { type: "string" | "number" | "integer" | "boolean"; enum?: Array<string | number> };
}

/** Prazo e tamanho (spec: 8 s nas consultas, 20 s nas "executa", resposta até 32 KB). */
export const QUERY_TIMEOUT_MS = 8_000;
export const EXECUTE_TIMEOUT_MS = 20_000;
export const MAX_RESPONSE_BYTES = 32 * 1024;
/** Acima disso, aviso no Testar e no log, sem cortar. */
export const DATA_WARN_BYTES = 8 * 1024;
export const MAX_PARAMS = 10;
export const MAX_DESCRIPTION = 500;

/** Nomes das ferramentas nativas do assistente: reservados (e o prefixo boavoz_). */
export const RESERVED_NAMES = new Set(["registrar_lead", "chamar_atendente", "registrar_pergunta_sem_resposta", "registrar_recusa", "pedir_confirmacao_18", "mostrar_opcoes", "mostrar_link", "iniciar_roteiro"]);

/* ------------------------------------------------------------------ cadastro */

export interface ActionInput {
  name: string;
  description: string;
  url: string;
  params_schema: unknown;
  min_level?: ActionLevel;
  outcomes?: string[];
  active?: boolean;
}

const SIMPLE = new Set(["string", "number", "integer", "boolean"]);

/** Confere o JSON Schema dos parâmetros: objeto com até 10 parâmetros de tipos simples (ou listas deles). */
export function paramsSchemaProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || (raw as ParamsSchema).type !== "object") return "Os parâmetros precisam ser um JSON Schema com \"type\": \"object\".";
  const s = raw as ParamsSchema;
  const props = s.properties ?? {};
  if (typeof props !== "object" || Array.isArray(props)) return "\"properties\" precisa ser um objeto.";
  const names = Object.keys(props);
  if (names.length > MAX_PARAMS) return `No máximo ${MAX_PARAMS} parâmetros.`;
  for (const n of names) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(n)) return `Nome de parâmetro inválido: ${n} (use snake_case).`;
    const p = props[n];
    if (!p || typeof p !== "object") return `Parâmetro ${n} sem definição.`;
    if (p.type === "array") {
      if (!p.items || !SIMPLE.has(p.items.type)) return `Parâmetro ${n}: lista só de tipos simples (texto, número, sim/não).`;
    } else if (!SIMPLE.has(p.type)) return `Parâmetro ${n}: tipo ${String(p.type)} não aceito (use string, number, integer, boolean ou array).`;
    if (p.description && p.description.length > 200) return `Descrição do parâmetro ${n} longa demais (até 200 caracteres).`;
  }
  for (const r of s.required ?? []) if (!names.includes(r)) return `"required" cita um parâmetro que não existe: ${r}.`;
  return null;
}

/**
 * Parâmetros que a IA mandou, conferidos contra o schema antes de chamar o endpoint: obrigatório
 * ausente ou vazio, tipo errado ou fora da lista. Devolve o que pedir à pessoa ("pedido (número do
 * pedido)"); vazio = pode chamar. Função pura.
 */
export function paramsProblems(schema: ParamsSchema, params: Record<string, unknown>): string[] {
  const props = schema.properties ?? {};
  const label = (n: string) => (props[n]?.description ? `${n} (${props[n].description})` : n);
  const empty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
  const fits = (t: string, v: unknown, e?: Array<string | number>) => {
    const ok = t === "string" ? typeof v === "string" : t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" && Number.isFinite(v) : t === "boolean" ? typeof v === "boolean" : false;
    return ok && (!e?.length || e.includes(v as string | number));
  };
  const problems = new Set<string>();
  for (const r of schema.required ?? []) if (empty(params[r])) problems.add(label(r));
  for (const [n, v] of Object.entries(params)) {
    const p = props[n];
    if (!p || empty(v)) continue;
    const ok = p.type === "array" ? Array.isArray(v) && !!p.items && v.every((x) => fits(p.items!.type, x, p.items!.enum)) : fits(p.type, v, p.enum);
    if (!ok) problems.add(label(n));
  }
  return [...problems];
}

/** O que impede salvar a ação (null = pode). Função pura, sem a checagem de DNS. */
export function actionInputProblem(i: ActionInput): string | null {
  if (!/^[a-z][a-z0-9_]{1,47}$/.test(i.name)) return "Nome em snake_case: letras minúsculas, números e _, começando por letra (até 48).";
  if (RESERVED_NAMES.has(i.name) || i.name.startsWith("boavoz_")) return `O nome ${i.name} é reservado.`;
  const d = i.description.trim();
  if (d.length < 20) return "Descreva quando a IA deve chamar a ação (pelo menos 20 caracteres).";
  if (d.length > MAX_DESCRIPTION) return `A descrição pode ter no máximo ${MAX_DESCRIPTION} caracteres.`;
  try {
    const u = checkUrl(i.url);
    if (u.protocol !== "https:") return "A URL precisa ser HTTPS.";
  } catch (e) {
    return e instanceof BlockedUrlError ? `URL recusada: ${e.message}.` : "URL inválida.";
  }
  for (const o of i.outcomes ?? []) if (!/^[a-z0-9_]{1,40}$/.test(o)) return `Resultado inválido: ${o} (até 40 caracteres, a-z, 0-9 e _).`;
  return paramsSchemaProblem(i.params_schema);
}

/* ------------------------------------------------------------------ segredo e assinatura */

/** whsec_ + base64 de 32 bytes aleatórios (formato do Standard Webhooks). */
export const newActionSecret = () => `whsec_${randomBytes(32).toString("base64")}`;

/** Segredos que assinam as chamadas deste bot agora: o atual e, durante a troca, o anterior. */
export async function botActionSecrets(db: SupabaseClient, botId: string): Promise<string[]> {
  const { data } = await db.from("bots").select("action_secret_enc, action_secret_prev_enc, action_secret_prev_until").eq("id", botId).maybeSingle();
  const out: string[] = [];
  if (data?.action_secret_enc) out.push(unseal(data.action_secret_enc as string));
  if (data?.action_secret_prev_enc && data.action_secret_prev_until && Date.parse(data.action_secret_prev_until as string) > Date.now()) out.push(unseal(data.action_secret_prev_enc as string));
  return out;
}

/**
 * Gera (ou troca) o segredo de ações do bot e devolve o novo (mostrado uma vez). Na troca, o
 * anterior continua valendo 24 horas, a não ser que invalidatePrevious.
 */
export async function rotateActionSecret(db: SupabaseClient, botId: string, o: { invalidatePrevious?: boolean } = {}): Promise<string> {
  const { data: bot } = await db.from("bots").select("action_secret_enc").eq("id", botId).maybeSingle();
  const secret = newActionSecret();
  const keepPrevious = bot?.action_secret_enc && !o.invalidatePrevious;
  const { error } = await db
    .from("bots")
    .update({
      action_secret_enc: seal(secret),
      action_secret_prev_enc: keepPrevious ? bot!.action_secret_enc : null,
      action_secret_prev_until: keepPrevious ? new Date(Date.now() + 24 * 3_600_000).toISOString() : null,
    })
    .eq("id", botId);
  if (error) throw new Error(`segredo não gravado: ${error.message}`);
  return secret;
}

/** Cabeçalho webhook-signature com uma assinatura por segredo ("v1,<nova> v1,<antiga>"). */
export function signatureHeader(secrets: string[], id: string, timestamp: Date, body: string): string {
  return secrets.map((s) => new Webhook(s).sign(id, timestamp, body)).join(" ");
}

/* ------------------------------------------------------------------ chamada */

export interface CallContact {
  id: string | null;
  level: ActionLevel;
  verified_by: "meta" | null;
  phone: string | null;
  whatsapp_user_id: string | null;
  age_confirmed: boolean | null;
  age_confirmed_source: "chat" | "company" | null;
}

export interface CallInput {
  params: Record<string, unknown>;
  mode?: CallMode;
  /** Chave da mensagem (evento do canal ou id da mensagem): forma o call_id de uma consulta. */
  messageKey?: string;
  conversation?: { id: string; channel: "widget" | "whatsapp" | "instagram" } | null;
  contact?: CallContact | null;
}

export interface CallResult {
  status: CallStatus;
  callId: string;
  httpStatus: number | null;
  durationMs: number;
  /** Resposta lida (só com status ok ou not_found). */
  data?: unknown;
  reply?: string | null;
  attachments?: Array<{ url: string; filename?: string }>;
  outcome?: string | null;
  /** Mensagem de erro para o log, para o Testar e para a IA ("não encontrado: …"). */
  error?: string;
  /** Avisos (data acima de 8 KB, resposta cortada). */
  warnings: string[];
  /** Resposta ok já gravada reaproveitada (reprocesso). */
  reused?: boolean;
}

const stableJson = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** call_id de uma consulta: hash da mensagem, da ação e dos parâmetros (o mesmo no reprocesso). */
export const queryCallId = (messageKey: string, actionId: string, params: Record<string, unknown>) => `call_${sha(`${messageKey}|${actionId}|${stableJson(params)}`).slice(0, 32)}`;
export const paramsHash = (actionId: string, params: Record<string, unknown>) => sha(`${actionId}|${stableJson(params)}`);

/** Corpo enviado ao endpoint (formato beta da P1). */
export function callBody(a: Pick<ActionRow, "name" | "bot_id">, callId: string, i: CallInput): Record<string, unknown> {
  return {
    call_id: callId,
    action: a.name,
    params: i.params,
    confirmed: false,
    ...(i.mode === "test" ? { test: true } : {}),
    bot: { id: `bot_${a.bot_id}` },
    conversation: i.conversation ? { id: `conv_${i.conversation.id}`, channel: i.conversation.channel } : null,
    contact: i.contact ? { ...i.contact, id: i.contact.id ? `ctc_${i.contact.id}` : null } : null,
    context: null,
  };
}

const RESERVED_HEADERS = /^(webhook-|host$|content-length$|content-type$|connection$|transfer-encoding$)/i;

/** Lê a resposta do endpoint: 2xx = ok; 404 = não encontrado; o resto = falha. Função pura. */
export function readResponse(httpStatus: number, text: string): Pick<CallResult, "status" | "data" | "reply" | "attachments" | "outcome" | "error"> {
  let json: Record<string, unknown> | null = null;
  if (text.trim()) {
    try {
      const v = JSON.parse(text) as unknown;
      json = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return { status: "error", error: `resposta não é JSON (HTTP ${httpStatus})` };
    }
  }
  if (httpStatus === 404) return { status: "not_found", error: typeof json?.error === "string" ? json.error.slice(0, 300) : "não encontrado" };
  if (httpStatus < 200 || httpStatus >= 300) return { status: "error", error: `HTTP ${httpStatus}${typeof json?.error === "string" ? `: ${json.error.slice(0, 200)}` : ""}` };
  if (!json) return { status: "error", error: "resposta vazia" };
  const attachments = Array.isArray(json.attachments)
    ? (json.attachments as Array<Record<string, unknown>>).filter((a) => typeof a?.url === "string").map((a) => ({ url: String(a.url), ...(typeof a.filename === "string" ? { filename: a.filename } : {}) }))
    : [];
  const outcome = typeof json.outcome === "string" && /^[a-z0-9_]{1,40}$/.test(json.outcome) ? json.outcome : null;
  return { status: "ok", data: json.data ?? null, reply: typeof json.reply === "string" ? json.reply.slice(0, 4000) : null, attachments, outcome };
}

/**
 * Chama a ação e registra a tentativa. Consulta: o call_id vem da mensagem, da ação e dos
 * parâmetros; no reprocesso, resposta ok já gravada é devolvida sem chamar o endpoint.
 */
export async function callAction(db: SupabaseClient, action: ActionRow, i: CallInput): Promise<CallResult> {
  const mode = i.mode ?? "normal";
  const callId = mode === "test" ? `call_test_${randomBytes(12).toString("hex")}` : queryCallId(i.messageKey ?? randomBytes(8).toString("hex"), action.id, i.params);
  const { data: previous } = await db.from("action_calls").select("attempt, status, response_enc, http_status").eq("call_id", callId).order("attempt", { ascending: false });
  const done = (previous ?? []).find((p) => p.status === "ok" && p.response_enc);
  if (done) return { ...readResponse((done.http_status as number) ?? 200, String(done.response_enc)), callId, httpStatus: (done.http_status as number) ?? 200, durationMs: 0, warnings: [], reused: true };
  const attempt = ((previous?.[0]?.attempt as number | undefined) ?? 0) + 1;

  const body = JSON.stringify(callBody(action, callId, { ...i, mode }));
  const secrets = action.secret_enc ? [unseal(action.secret_enc)] : await botActionSecrets(db, action.bot_id);
  const custom = action.headers_enc ? (JSON.parse(unseal(action.headers_enc)) as Record<string, string>) : {};
  const started = Date.now();
  let result: CallResult;
  if (!secrets.length) {
    result = { status: "error", callId, httpStatus: null, durationMs: 0, error: "o bot ainda não tem segredo de ações", warnings: [] };
  } else {
    const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "BoaVoz-Acoes/1" };
    for (const [k, v] of Object.entries(custom)) if (!RESERVED_HEADERS.test(k)) headers[k] = String(v);
    const now = new Date();
    headers["webhook-id"] = callId;
    headers["webhook-timestamp"] = String(Math.floor(now.getTime() / 1000));
    headers["webhook-signature"] = signatureHeader(secrets, callId, now, body);
    try {
      const r = await safePost(action.url, { body, headers, timeoutMs: action.type === "execute" ? EXECUTE_TIMEOUT_MS : QUERY_TIMEOUT_MS, maxBytes: MAX_RESPONSE_BYTES });
      const durationMs = Date.now() - started;
      if (r.redirect) {
        result = { status: "error", callId, httpStatus: r.status, durationMs, error: `seu endpoint respondeu ${r.status} para ${r.redirect}; cadastre essa URL`, warnings: [] };
      } else {
        const read = readResponse(r.status, r.text);
        const warnings: string[] = [];
        if (r.truncated) warnings.push("resposta acima de 32 KB foi cortada");
        if (read.data && JSON.stringify(read.data).length > DATA_WARN_BYTES) warnings.push("data acima de 8 KB (pesa em cada resposta da IA)");
        result = { ...read, ...(r.truncated && read.status === "ok" ? { status: "error" as const, error: "resposta acima de 32 KB" } : {}), callId, httpStatus: r.status, durationMs, warnings };
        await logCall(db, { action, callId, attempt, mode, params: i.params, status: result.status, httpStatus: r.status, durationMs, headerNames: Object.keys(custom), body, response: r.text });
        return result;
      }
    } catch (e) {
      const durationMs = Date.now() - started;
      const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
      const status: CallStatus = timedOut ? (action.type === "execute" ? "uncertain" : "timeout") : "error";
      result = { status, callId, httpStatus: null, durationMs, error: timedOut ? "o endpoint não respondeu a tempo" : e instanceof BlockedUrlError ? `URL recusada: ${e.message}` : `falha de conexão: ${(e as Error).message}`, warnings: [] };
    }
  }
  await logCall(db, { action, callId, attempt, mode, params: i.params, status: result.status, httpStatus: result.httpStatus, durationMs: result.durationMs, headerNames: Object.keys(custom), body, response: result.error ?? null });
  return result;
}

async function logCall(db: SupabaseClient, c: { action: ActionRow; callId: string; attempt: number; mode: CallMode; params: Record<string, unknown>; status: CallStatus; httpStatus: number | null; durationMs: number; headerNames: string[]; body: string; response: string | null }) {
  const { error } = await db.from("action_calls").insert({
    action_id: c.action.id,
    conversation_id: (JSON.parse(c.body) as { conversation?: { id?: string } | null }).conversation?.id?.replace(/^conv_/, "") ?? null,
    call_id: c.callId,
    attempt: c.attempt,
    params_hash: paramsHash(c.action.id, c.params),
    mode: c.mode,
    status: c.status,
    http_status: c.httpStatus,
    duration_ms: c.durationMs,
    // só os nomes dos cabeçalhos personalizados, nunca os valores
    request_enc: JSON.stringify({ body: JSON.parse(c.body), headers: c.headerNames }),
    response_enc: c.response,
  });
  if (error) console.error("ação: chamada não registrada", error.message);
}

/* ------------------------------------------------------------------ efeito (pedido, reserva ou cobrança) */

/**
 * A ação cria pedido, reserva ou cobrança do negócio para o contato? Classificado pela IA do
 * BoaVoz no cadastro e na edição (registro de dados do usuário não conta). Erro da IA: "sim"
 * (lado seguro: fica desativada até a revisão).
 */
export async function classifyAction(db: SupabaseClient, agencyId: string, a: Pick<ActionInput, "name" | "description" | "params_schema">): Promise<{ createsOrder: boolean; transactional: boolean }> {
  const modelId = classifierModelId();
  try {
    const r = await generateText({
      model: chatModel(modelId),
      system: "Você classifica ações de integração de um chatbot de atendimento. Responda só com JSON válido.",
      prompt: `Ação: ${a.name}\nDescrição: ${a.description}\nParâmetros (JSON Schema): ${JSON.stringify(a.params_schema).slice(0, 2000)}\n\n1. cria_pedido: chamar esta ação CRIA um pedido, uma reserva ou uma cobrança do negócio para o contato (ex.: criar pedido, agendar, reservar mesa, gerar Pix ou boleto, cobrar)? Consultar informação (cardápio, status de pedido, horários, saldo) não cria. Registrar dados do próprio usuário (cadastro, endereço) não conta.\n2. transacao: a resposta traz uma transação da pessoa (pedido, carrinho, compra, reserva, cobrança, fatura, itens comprados, status de entrega)? Catálogo, cardápio, produtos, preços, estoque, horários e informações gerais não são transação.\nResponda só: {"cria_pedido": true|false, "transacao": true|false}`,
      ...modelCallOptions(modelId, { temperature: 0 }),
      maxRetries: 2,
    });
    void recordAiUsage(db, { agencyId, kind: "classificacao", ...usageFrom(r.response?.modelId ?? modelId, r.totalUsage) });
    const j = JSON.parse(r.text.replace(/^\s*```(?:json)?|```\s*$/g, "").trim()) as { cria_pedido?: unknown; transacao?: unknown };
    // na dúvida, o mais restrito
    return { createsOrder: j.cria_pedido !== false, transactional: j.transacao !== false };
  } catch {
    return { createsOrder: true, transactional: true };
  }
}
