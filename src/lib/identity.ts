import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seal, unseal } from "./secret-box";
import { hmacHex, stableJson } from "./hash";

/*
 * Contato identificado no widget (P2, spec "Peça 4" e "Formatos de payload", seção 5): o servidor
 * do SaaS assina um JWT com o segredo de identidade e o widget manda em toda requisição. Regras:
 * só HS256 (o alg do cabeçalho não muda isso); kid buscado só entre os segredos da agência do
 * chatbot e dentro do escopo (chatbot, cliente ou todos); aud igual à chave do widget; exp até
 * agora + 3.660 s; iat até agora + 60 s; folga de 60 s; datas em milissegundos são recusadas;
 * context limitado. Sem external_id, o token só define o contexto (o contato segue anônimo).
 */

export const TOKEN_MAX_TTL_S = 3660;
export const CLOCK_SKEW_S = 60;
/** Contexto em JSON até 2 KB (vai para as ações, nunca para a IA). */
export const MAX_CONTEXT_BYTES = 2048;
const MAX_DISPLAY_BYTES = 512;

export interface IdentityClaims {
  externalId: string | null;
  context: Record<string, unknown> | null;
  /** Vai para o contato (ex.: {"name": "Ruan"}). */
  userDisplay: Record<string, unknown> | null;
  /** Vai para a conversa (ex.: "Família Portella"). */
  contextDisplay: string | null;
  /** A empresa verificou a idade (true) ou informou menor (false). */
  ageVerified: boolean | null;
  exp: number;
}

export type TokenProblem = "malformed" | "alg" | "kid" | "scope" | "signature" | "aud" | "exp" | "iat" | "external_id" | "context" | "display";

const json = (part: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Partes do JWT (sem conferir nada). Função pura. */
export function parseJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signingInput: string; signature: Buffer } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || token.length > 8192) return null;
  const header = json(parts[0]);
  const payload = json(parts[1]);
  if (!header || !payload) return null;
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], "base64url") };
}

export const hs256 = (signingInput: string, secret: string) => createHmac("sha256", secret).update(signingInput).digest();

/** Assinatura confere (tempo constante). */
export function signatureOk(signingInput: string, signature: Buffer, secret: string): boolean {
  const expected = hs256(signingInput, secret);
  return signature.length === expected.length && timingSafeEqual(signature, expected);
}

const sizeOf = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

/** Datas, destino e campos do payload. Função pura. */
export function checkClaims(p: Record<string, unknown>, o: { aud: string; now?: number }): IdentityClaims | TokenProblem {
  const nowS = Math.floor((o.now ?? Date.now()) / 1000);
  const aud = p.aud;
  if (!(aud === o.aud || (Array.isArray(aud) && aud.includes(o.aud)))) return "aud";
  // segundos desde 1970; milissegundos (13 dígitos) são recusados
  const exp = p.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp > 1e11 || exp > nowS + TOKEN_MAX_TTL_S || exp < nowS - CLOCK_SKEW_S) return "exp";
  const iat = p.iat;
  if (typeof iat !== "number" || !Number.isFinite(iat) || iat > 1e11 || iat > nowS + CLOCK_SKEW_S) return "iat";
  const ext = p.external_id;
  if (ext !== undefined && ext !== null && (typeof ext !== "string" || !ext.trim() || ext.length > 128)) return "external_id";
  const ctx = p.context;
  if (ctx !== undefined && ctx !== null && (typeof ctx !== "object" || Array.isArray(ctx) || sizeOf(ctx) > MAX_CONTEXT_BYTES)) return "context";
  const ud = p.user_display;
  const userDisplay = typeof ud === "string" ? { name: ud } : ud && typeof ud === "object" && !Array.isArray(ud) ? (ud as Record<string, unknown>) : null;
  if ((ud !== undefined && ud !== null && !userDisplay) || (userDisplay && sizeOf(userDisplay) > MAX_DISPLAY_BYTES)) return "display";
  const cd = p.context_display;
  const contextDisplay = typeof cd === "string" ? cd : cd && typeof cd === "object" && typeof (cd as { name?: unknown }).name === "string" ? String((cd as { name: string }).name) : null;
  if ((cd !== undefined && cd !== null && contextDisplay === null) || (contextDisplay && contextDisplay.length > 120)) return "display";
  return {
    externalId: typeof ext === "string" ? ext.trim() : null,
    context: ctx && typeof ctx === "object" ? (ctx as Record<string, unknown>) : null,
    userDisplay,
    contextDisplay: contextDisplay?.trim() || null,
    ageVerified: typeof p.age_verified === "boolean" ? p.age_verified : null,
    exp,
  };
}

/** HMAC do contexto em JSON canônico (prende a conversa ao workspace). */
export const contextHashOf = (ctx: Record<string, unknown> | null) => (ctx ? hmacHex(`ctx:${stableJson(ctx)}`) : null);

export interface IdentityBot {
  id: string;
  agency_id: string;
  client_id?: string | null;
  public_key: string;
}

/** Confere o token para este chatbot. */
export async function verifyIdentityToken(db: SupabaseClient, bot: IdentityBot, token: string, now = Date.now()): Promise<{ ok: true; claims: IdentityClaims; kid: string } | { ok: false; problem: TokenProblem }> {
  const jwt = parseJwt(token);
  if (!jwt) return { ok: false, problem: "malformed" };
  // só HS256: "none", RS256 com a chave pública como segredo e afins são recusados
  if (jwt.header.alg !== "HS256") return { ok: false, problem: "alg" };
  const kid = jwt.header.kid;
  if (typeof kid !== "string" || !/^idk_[a-z0-9]{16}$/.test(kid)) return { ok: false, problem: "kid" };
  const { data: s } = await db.from("identity_secrets").select("id, scope_type, scope_bot_id, scope_client_id, secret_enc, last_used_at").eq("kid", kid).eq("agency_id", bot.agency_id).is("revoked_at", null).maybeSingle();
  if (!s) return { ok: false, problem: "kid" };
  // um token feito com o segredo de um cliente nunca vale no chatbot de outro cliente da agência
  if ((s.scope_type === "bot" && s.scope_bot_id !== bot.id) || (s.scope_type === "client" && (!bot.client_id || s.scope_client_id !== bot.client_id))) return { ok: false, problem: "scope" };
  if (!signatureOk(jwt.signingInput, jwt.signature, unseal(String(s.secret_enc)))) return { ok: false, problem: "signature" };
  const claims = checkClaims(jwt.payload, { aud: bot.public_key, now });
  if (typeof claims === "string") return { ok: false, problem: claims };
  if (!s.last_used_at || now - Date.parse(String(s.last_used_at)) > 60_000) {
    void db.from("identity_secrets").update({ last_used_at: new Date(now).toISOString() }).eq("id", s.id).then(({ error }) => error && console.error("identidade: last_used_at", error.message));
  }
  return { ok: true, claims, kid };
}

/* ------------------------------------------------------------------ segredos (backoffice nos pilotos) */

export type IdentityScope = { type: "bot"; botId: string } | { type: "client"; clientId: string } | { type: "all" };

/** kid público (cabeçalho do token) e o segredo (mostrado uma vez). */
export function newIdentitySecret(): { kid: string; secret: string } {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const kid = `idk_${[...randomBytes(16)].map((b) => alphabet[b % alphabet.length]).join("")}`;
  return { kid, secret: `idsec_${randomBytes(32).toString("base64url")}` };
}

export async function createIdentitySecret(db: SupabaseClient, i: { agencyId: string; name: string; scope: IdentityScope; createdBy: string }): Promise<{ id: string; kid: string; secret: string }> {
  const { kid, secret } = newIdentitySecret();
  const { data, error } = await db
    .from("identity_secrets")
    .insert({
      kid,
      agency_id: i.agencyId,
      name: i.name.trim(),
      scope_type: i.scope.type,
      scope_bot_id: i.scope.type === "bot" ? i.scope.botId : null,
      scope_client_id: i.scope.type === "client" ? i.scope.clientId : null,
      secret_enc: seal(secret),
      created_by: i.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(`segredo de identidade não criado: ${error.message}`);
  return { id: data.id as string, kid, secret };
}

export async function revokeIdentitySecret(db: SupabaseClient, agencyId: string, id: string, by: string): Promise<{ kid: string; name: string } | null> {
  const { data, error } = await db.from("identity_secrets").update({ revoked_at: new Date().toISOString(), revoked_by: by }).eq("id", id).eq("agency_id", agencyId).is("revoked_at", null).select("kid, name").maybeSingle();
  if (error) throw new Error(`segredo não revogado: ${error.message}`);
  return data ? { kid: String(data.kid), name: String(data.name) } : null;
}

/** Monta um token (testes e exemplo da documentação; o SaaS faz isso no servidor dele). */
export function signIdentityToken(kid: string, secret: string, payload: Record<string, unknown>): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const signingInput = `${b64({ alg: "HS256", typ: "JWT", kid })}.${b64(payload)}`;
  return `${signingInput}.${hs256(signingInput, secret).toString("base64url")}`;
}
