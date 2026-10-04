import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkClaims, contextHashOf, signIdentityToken, verifyIdentityToken } from "../identity";
import { seal } from "../secret-box";
import { conversationAccess, identityColumns, identityPromptNote, type WidgetWho } from "../widget-identity";
import { callBody } from "../actions";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const nowS = Math.floor(NOW / 1000);
const AGENCY = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_AGENCY = "bbbbbbbb-0000-4000-8000-000000000002";
const BOT = { id: "aaaaaaaa-0000-4000-8000-0000000000a1", agency_id: AGENCY, client_id: "aaaaaaaa-0000-4000-8000-0000000000c1", public_key: "0123456789abcdef0123" };
const KID = "idk_abcdefghij012345";
const SECRET = "idsec_segredo-de-teste";

const payload = (o: Record<string, unknown> = {}) => ({ aud: BOT.public_key, iat: nowS, exp: nowS + 3600, external_id: "user_42", context: { workspace_id: "ws_abc" }, user_display: { name: "Ruan" }, context_display: "Família Portella", ...o });

/** Banco com só a tabela de segredos. */
function secretsDb(rows: Array<Record<string, unknown>>) {
  return {
    from: () => {
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
        is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), b),
        update: () => b,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
        maybeSingle: async () => ({ data: rows.find((r) => filters.every((f) => f(r))) ?? null }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe("token de identidade", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-de-teste-dos-segredos-123");
    vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16");
  });
  const row = (o: Record<string, unknown> = {}) => ({ id: "s1", kid: KID, agency_id: AGENCY, scope_type: "bot", scope_bot_id: BOT.id, scope_client_id: null, secret_enc: seal(SECRET), revoked_at: null, last_used_at: null, ...o });

  it("token válido: pessoa, contexto e display", async () => {
    const r = await verifyIdentityToken(secretsDb([row()]), BOT, signIdentityToken(KID, SECRET, payload()), NOW);
    expect(r).toMatchObject({ ok: true, claims: { externalId: "user_42", context: { workspace_id: "ws_abc" }, userDisplay: { name: "Ruan" }, contextDisplay: "Família Portella" } });
  });

  it("só HS256: alg none ou RS256 são recusados", async () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const none = `${b64({ alg: "none", kid: KID })}.${b64(payload())}.`;
    expect(await verifyIdentityToken(secretsDb([row()]), BOT, none, NOW)).toEqual({ ok: false, problem: "alg" });
    const rs = `${b64({ alg: "RS256", kid: KID })}.${b64(payload())}.abc`;
    expect(await verifyIdentityToken(secretsDb([row()]), BOT, rs, NOW)).toEqual({ ok: false, problem: "alg" });
  });

  it("segredo de outra agência, fora do escopo, revogado ou assinatura errada: recusado", async () => {
    const token = signIdentityToken(KID, SECRET, payload());
    expect(await verifyIdentityToken(secretsDb([row({ agency_id: OTHER_AGENCY })]), BOT, token, NOW)).toEqual({ ok: false, problem: "kid" });
    expect(await verifyIdentityToken(secretsDb([row({ scope_bot_id: "outro" })]), BOT, token, NOW)).toEqual({ ok: false, problem: "scope" });
    expect(await verifyIdentityToken(secretsDb([row({ scope_type: "client", scope_bot_id: null, scope_client_id: "outro-cliente" })]), BOT, token, NOW)).toEqual({ ok: false, problem: "scope" });
    expect((await verifyIdentityToken(secretsDb([row({ scope_type: "client", scope_bot_id: null, scope_client_id: BOT.client_id })]), BOT, token, NOW)).ok).toBe(true);
    expect(await verifyIdentityToken(secretsDb([row({ revoked_at: "2026-10-01T00:00:00Z" })]), BOT, token, NOW)).toEqual({ ok: false, problem: "kid" });
    expect(await verifyIdentityToken(secretsDb([row()]), BOT, signIdentityToken(KID, "outro-segredo", payload()), NOW)).toEqual({ ok: false, problem: "signature" });
    // payload trocado depois de assinado
    const [h, , s] = token.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify(payload({ external_id: "user_99" }))).toString("base64url")}.${s}`;
    expect(await verifyIdentityToken(secretsDb([row()]), BOT, forged, NOW)).toEqual({ ok: false, problem: "signature" });
  });

  it("datas e destino", () => {
    const c = (o: Record<string, unknown>) => checkClaims(payload(o), { aud: BOT.public_key, now: NOW });
    expect(c({ aud: "outra-chave" })).toBe("aud");
    expect(c({ exp: nowS + 3661 })).toBe("exp");
    expect(c({ exp: nowS - 61 })).toBe("exp");
    expect(c({ exp: (nowS + 3600) * 1000 })).toBe("exp"); // milissegundos
    expect(c({ iat: nowS + 61 })).toBe("iat");
    expect(c({ iat: undefined })).toBe("iat");
    expect(c({ exp: nowS - 30 })).toMatchObject({ externalId: "user_42" }); // folga de 60 s
    expect(c({ external_id: "x".repeat(129) })).toBe("external_id");
    expect(c({ context: { blob: "x".repeat(2100) } })).toBe("context");
    expect(c({ external_id: undefined })).toMatchObject({ externalId: null }); // só contexto
    expect(c({ user_display: "Ruan" })).toMatchObject({ userDisplay: { name: "Ruan" } });
  });
});

describe("conversa presa à pessoa (teste de aceite da P2)", () => {
  beforeEach(() => vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16"));
  const who = (identityHash: string | null, ctx: Record<string, unknown> | null): WidgetWho => ({
    kind: "token",
    claims: { externalId: identityHash ? "x" : null, context: ctx, userDisplay: null, contextDisplay: null, ageVerified: null, exp: 0 },
    identityHash,
    contextHash: contextHashOf(ctx),
    contactId: null,
  });
  const ws = { workspace_id: "ws_abc" };
  const convA = () => ({ visitor_id: "navegador-1", identity_hash: "hA", context_hash: contextHashOf(ws) });

  it("a pessoa A conversa; a B entra no mesmo navegador sem logout: nada de A aparece", () => {
    expect(conversationAccess(convA(), who("hA", ws), "navegador-1")).toBe("ok");
    expect(conversationAccess(convA(), who("hB", ws), "navegador-1")).toBe("denied");
    // sem token (logout, getToken falhou) a conversa de usuário não volta
    expect(conversationAccess(convA(), { kind: "anon" }, "navegador-1")).toBe("denied");
    // a mesma pessoa em outro workspace: outra conversa
    expect(conversationAccess(convA(), who("hA", { workspace_id: "ws_xyz" }), "navegador-1")).toBe("denied");
    // a mesma pessoa em outro navegador: volta (presa à pessoa, não ao navegador)
    expect(conversationAccess(convA(), who("hA", ws), "navegador-2")).toBe("ok");
  });

  it("conversa anônima: sobe para usuário uma vez, só no mesmo navegador", () => {
    const anon = { visitor_id: "navegador-1", identity_hash: null, context_hash: null };
    expect(conversationAccess(anon, { kind: "anon" }, "navegador-1")).toBe("ok");
    expect(conversationAccess(anon, who("hA", ws), "navegador-1")).toBe("upgrade");
    expect(conversationAccess(anon, who("hA", ws), "navegador-2")).toBe("denied");
  });

  it("token só com contexto: a conversa fica presa ao contexto e ao navegador", () => {
    const conv = { visitor_id: "navegador-1", identity_hash: null, context_hash: contextHashOf(ws) };
    expect(conversationAccess(conv, who(null, ws), "navegador-1")).toBe("ok");
    expect(conversationAccess(conv, who(null, ws), "navegador-2")).toBe("denied");
  });

  it("colunas da conversa de usuário: o contexto vai selado, nunca em texto para a IA", async () => {
    const cols = await identityColumns(who("hA", ws), "bot-1");
    expect(cols).toMatchObject({ identity_hash: "hA", context_hash: contextHashOf(ws), context_source: "token" });
    expect(await identityColumns({ kind: "anon" }, "bot-1")).toEqual({});
  });
});

describe("o que a IA e as ações recebem", () => {
  it("a IA vê só o display; as ações recebem external_id e o contexto", () => {
    const note = identityPromptNote({ externalId: "user_42", userDisplay: { name: "Ruan" }, contextDisplay: "Família Portella", context: { workspace_id: "ws_abc" }, source: "token", ageVerified: null });
    expect(note).toContain("Ruan");
    expect(note).toContain("Família Portella");
    expect(note).not.toContain("ws_abc");
    expect(identityPromptNote(null)).toBeNull();
    const body = callBody({ name: "saldo", bot_id: BOT.id }, "call_x", {
      params: {},
      contact: { id: "c1", level: "usuario", verified_by: "signed_token", external_id: "user_42", display: { name: "Ruan" }, phone: null, whatsapp_user_id: null, age_confirmed: null, age_confirmed_source: null },
      context: { source: "token", data: { workspace_id: "ws_abc" } },
    });
    expect(body).toMatchObject({ contact: { level: "usuario", verified_by: "signed_token", external_id: "user_42" }, context: { source: "token", data: { workspace_id: "ws_abc" } } });
  });
});
