import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * API pública /v1 (P1): chave, escopo e a rota de idade. É também o começo da suíte de isolamento
 * (spec "Modelo central"): duas agências, dois clientes, bots de cada lado; cada leva acrescenta
 * os casos das suas rotas.
 */

type Row = Record<string, unknown>;

/** Banco em memória com o pedaço do PostgREST que estas rotas usam. */
function memoryDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let max = Infinity;
    const run = () => {
      const rows = (tables[table] ??= []).filter((r) => filters.every((f) => f(r))).slice(0, max);
      if (patch) rows.forEach((r) => Object.assign(r, patch));
      return rows;
    };
    const b = {
      select: () => b,
      order: () => b,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), b),
      limit: (n: number) => ((max = n), b),
      update: (p: Row) => ((patch = p), b),
      insert: async (r: Row | Row[]) => ((tables[table] ??= []).push(...(Array.isArray(r) ? r : [r])), { error: null }),
      upsert: async (rs: Row | Row[], o: { onConflict: string }) => {
        const keys = o.onConflict.split(",");
        for (const r of Array.isArray(rs) ? rs : [rs]) {
          const t = (tables[table] ??= []);
          const i = t.findIndex((x) => keys.every((k) => x[k] === r[k]));
          if (i >= 0) t[i] = { ...t[i], ...r };
          else t.push({ ...r });
        }
        return { error: null };
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (ok: (v: { data: Row[]; error: null }) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(ok, ko),
    };
    return b;
  };
  return { from, rpc: async () => ({ data: true, error: null }) } as unknown as SupabaseClient;
}

const env = vi.hoisted(() => ({ db: null as unknown as SupabaseClient }));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => env.db }));

import { apiKeyHash, apiKeyProblem, looksLikeApiKey, newApiKey } from "../api-keys";
import { apiContext, bearerKey, withApiKey } from "../api-v1";
import { adultOn, parseAgeBody } from "../api-age";
import { parseContactAddress, phoneHash } from "../contacts";
import { getAge } from "../gate/age";
import { contactHash } from "../suppression";
import { PUT } from "../../app/api/v1/contacts/[contact]/age/route";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const BOT_A1 = "aaaaaaaa-0000-4000-8000-0000000000a1";
const BOT_A2 = "aaaaaaaa-0000-4000-8000-0000000000a2";
const BOT_A_DEMO = "aaaaaaaa-0000-4000-8000-0000000000ad";
const BOT_B1 = "bbbbbbbb-0000-4000-8000-0000000000b1";
const CLIENT_A1 = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CTC_A1 = "aaaaaaaa-0000-4000-8000-0000000000e1";
const CTC_B1 = "bbbbbbbb-0000-4000-8000-0000000000e2";
const PHONE = "5521999999999";

function world() {
  const keys = { all: newApiKey(), bots: newApiKey(), client: newApiKey(), noPerm: newApiKey(), revoked: newApiKey(), b: newApiKey() };
  const key = (k: { prefix: string; hash: string }, id: string, agency: string, extra: Row) => ({ id, agency_id: agency, name: id, prefix: k.prefix, key_hash: k.hash, scope_type: "all", scope_bot_ids: [], scope_client_id: null, permissions: ["contacts"], last_used_at: null, revoked_at: null, ...extra });
  const tables: Record<string, Row[]> = {
    bots: [
      { id: BOT_A1, agency_id: A, client_id: CLIENT_A1, is_demo: false },
      { id: BOT_A2, agency_id: A, client_id: null, is_demo: false },
      { id: BOT_A_DEMO, agency_id: A, client_id: CLIENT_A1, is_demo: true },
      { id: BOT_B1, agency_id: B, client_id: null, is_demo: false },
    ],
    api_keys: [
      key(keys.all, "k-all", A, {}),
      key(keys.bots, "k-bots", A, { scope_type: "bots", scope_bot_ids: [BOT_A2] }),
      key(keys.client, "k-client", A, { scope_type: "client", scope_client_id: CLIENT_A1 }),
      key(keys.noPerm, "k-noperm", A, { permissions: ["messages"] }),
      key(keys.revoked, "k-revoked", A, { revoked_at: "2026-10-01T00:00:00Z" }),
      key(keys.b, "k-b", B, {}),
    ],
    contacts: [
      { id: CTC_A1, bot_id: BOT_A1, channel: "whatsapp", phone_hash: null, phone_enc: PHONE, wa_user_hash: null, wa_user_enc: null, ig_hash: null, ig_enc: null },
      { id: CTC_B1, bot_id: BOT_B1, channel: "whatsapp", phone_hash: null, phone_enc: PHONE, wa_user_hash: null, wa_user_enc: null, ig_hash: null, ig_enc: null },
    ],
    contact_ages: [],
    audit_log: [],
  };
  return { tables, keys };
}

const req = (key: string | null, o: { host?: string; body?: unknown } = {}) =>
  new Request("http://localhost/api/v1/x", { method: "PUT", headers: { host: o.host ?? "localhost", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: o.body === undefined ? undefined : JSON.stringify(o.body) });

describe("chaves de API", () => {
  it("formato bv_live_, hash e só o início guardado", () => {
    const k = newApiKey();
    expect(looksLikeApiKey(k.key)).toBe(true);
    expect(k.prefix).toBe(k.key.slice(0, 14));
    expect(k.hash).toBe(apiKeyHash(k.key));
    expect(k.hash).not.toContain(k.key.slice(8));
    expect(looksLikeApiKey("bv_live_curta")).toBe(false);
    expect(bearerKey(`Bearer ${k.key}`)).toBe(k.key);
    expect(bearerKey(k.key)).toBeNull();
  });

  it("cadastro pede nome, permissão e bots no escopo de lista", () => {
    expect(apiKeyProblem({ name: "Duck", scope: { type: "all" }, permissions: ["contacts"] })).toBeNull();
    expect(apiKeyProblem({ name: " ", scope: { type: "all" }, permissions: ["contacts"] })).toMatch(/nome/);
    expect(apiKeyProblem({ name: "Duck", scope: { type: "all" }, permissions: [] })).toMatch(/permissão/);
    expect(apiKeyProblem({ name: "Duck", scope: { type: "all" }, permissions: ["admin"] })).toMatch(/desconhecida/);
    expect(apiKeyProblem({ name: "Duck", scope: { type: "bots", botIds: [] }, permissions: ["contacts"] })).toMatch(/chatbot/);
  });
});

describe("ponto único de acesso (isolamento)", () => {
  let w: ReturnType<typeof world>;
  let seen: string[] | null;
  const route = withApiKey("contacts", async (_req, api) => ((seen = api.botIds), Response.json({ ok: true })));
  const call = (key: string | null, host?: string) => route(req(key, { host }), { params: Promise.resolve({}) });

  beforeEach(() => {
    w = world();
    env.db = memoryDb(w.tables);
    seen = null;
  });

  it("sem chave, chave desconhecida ou revogada: 401", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call(newApiKey().key)).status).toBe(401);
    const r = await call(w.keys.revoked.key);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: { code: "invalid_api_key", message: expect.any(String) } });
  });

  it("domínio de agência: a API não responde", async () => {
    expect((await call(w.keys.all.key, "chat.agencia.com.br")).status).toBe(404);
    expect(seen).toBeNull();
  });

  it("sem a permissão: 403 forbidden_scope", async () => {
    const r = await call(w.keys.noPerm.key);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("forbidden_scope");
  });

  it("escopo: todos = bots da própria agência (sem demo); lista; cliente inclui os futuros", async () => {
    await call(w.keys.all.key);
    expect(seen?.sort()).toEqual([BOT_A1, BOT_A2].sort());
    await call(w.keys.bots.key);
    expect(seen).toEqual([BOT_A2]);
    await call(w.keys.client.key);
    expect(seen).toEqual([BOT_A1]);
    w.tables.bots.push({ id: "aaaaaaaa-0000-4000-8000-0000000000a3", agency_id: A, client_id: CLIENT_A1, is_demo: false });
    await call(w.keys.client.key);
    expect(seen).toHaveLength(2);
    await call(w.keys.b.key);
    expect(seen).toEqual([BOT_B1]);
  });

  it("requireBot: obrigatório, com prefixo bot_, e dentro do escopo", () => {
    const api = apiContext(env.db, { id: "k", agency_id: A, prefix: "bv_live_x", name: "k" }, [BOT_A1]);
    expect(api.requireBot(`bot_${BOT_A1}`)).toBe(BOT_A1);
    expect(() => api.requireBot(undefined)).toThrow(/obrigatório/);
    expect(() => api.requireBot(BOT_A1)).toThrow(/prefixo/);
    expect(() => api.requireBot(`bot_${BOT_B1}`)).toThrow(/fora do escopo/);
  });
});

describe("PUT /v1/contacts/{contact}/age", () => {
  let w: ReturnType<typeof world>;
  const put = (key: string, contact: string, body: unknown) => PUT(req(key, { body }), { params: Promise.resolve({ contact }) });
  const ageRow = (bot: string) => w.tables.contact_ages.find((r) => r.bot_id === bot && r.contact_hash === contactHash("whatsapp", PHONE));

  beforeEach(() => {
    vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16");
    w = world();
    // o hash do telefone depende da chave de hash do ambiente
    for (const c of w.tables.contacts) c.phone_hash = phoneHash(PHONE);
    env.db = memoryDb(w.tables);
  });

  it("phone: grava a idade da empresa com a origem, e o chat passa a ver 'sim'", async () => {
    const r = await put(w.keys.all.key, "phone:21999999999", { bot_id: `bot_${BOT_A1}`, age_verified: true, origin: "CPF conferido no cadastro" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ age_confirmed: true, age_confirmed_source: "company" });
    expect(ageRow(BOT_A1)).toMatchObject({ status: "sim", source: "empresa", origin: "CPF conferido no cadastro", api_key_id: "k-all" });
    expect(await getAge(env.db, { botId: BOT_A1, channel: "whatsapp", contact: PHONE })).toBe("sim");
    expect(w.tables.audit_log[0]).toMatchObject({ actor_type: "api_key", actor_id: "k-all", action: "idade.informar", target_id: CTC_A1 });
    // o mesmo telefone no bot da outra agência não muda
    expect(ageRow(BOT_B1)).toBeUndefined();
  });

  it("o 'Não' do chat vence", async () => {
    w.tables.contact_ages.push({ bot_id: BOT_A1, contact_hash: contactHash("whatsapp", PHONE), status: "nao", source: "chat", decided_at: new Date().toISOString() });
    const r = await put(w.keys.all.key, `ctc_${CTC_A1}`, { age_verified: true, origin: "cadastro" });
    expect(await r.json()).toEqual({ age_confirmed: false, age_confirmed_source: "chat" });
    expect(ageRow(BOT_A1)).toMatchObject({ status: "nao", source: "chat" });
  });

  it("menor informado pela empresa vale como 'Não' e não vence em 60 dias", async () => {
    await put(w.keys.all.key, `ctc_${CTC_A1}`, { birth_date: "2015-01-01", origin: "data de nascimento do cadastro" });
    expect(ageRow(BOT_A1)).toMatchObject({ status: "nao", source: "empresa" });
    expect(ageRow(BOT_A1)).not.toHaveProperty("birth_date");
    const later = Date.now() + 90 * 86_400_000;
    expect(await getAge(env.db, { botId: BOT_A1, channel: "whatsapp", contact: PHONE }, later)).toBe("nao");
  });

  it("isolamento: contato de outra agência é 404; bot fora do escopo é 403", async () => {
    expect((await put(w.keys.all.key, `ctc_${CTC_B1}`, { age_verified: true, origin: "cadastro" })).status).toBe(404);
    expect((await put(w.keys.all.key, "phone:21999999999", { bot_id: `bot_${BOT_B1}`, age_verified: true, origin: "cadastro" })).status).toBe(403);
    expect((await put(w.keys.bots.key, `ctc_${CTC_A1}`, { age_verified: true, origin: "cadastro" })).status).toBe(404);
    expect(w.tables.contact_ages).toHaveLength(0);
  });

  it("erros de corpo e de contato", async () => {
    const code = async (r: Response) => [r.status, ((await r.json()) as { error: { code: string } }).error.code];
    expect(await code(await put(w.keys.all.key, "phone:21999999999", { age_verified: true, origin: "cadastro" }))).toEqual([400, "invalid_request"]);
    expect(await code(await put(w.keys.all.key, "telefone:2199", { bot_id: `bot_${BOT_A1}`, age_verified: true, origin: "cadastro" }))).toEqual([400, "invalid_request"]);
    expect(await code(await put(w.keys.all.key, "phone:21988887777", { bot_id: `bot_${BOT_A1}`, age_verified: true, origin: "cadastro" }))).toEqual([404, "not_found"]);
    expect(await code(await put(w.keys.all.key, "ext:user_42", { bot_id: `bot_${BOT_A1}`, age_verified: true, origin: "cadastro" }))).toEqual([404, "not_found"]);
    expect(await code(await put(w.keys.noPerm.key, `ctc_${CTC_A1}`, { age_verified: true, origin: "cadastro" }))).toEqual([403, "forbidden_scope"]);
  });
});

describe("corpo e endereço do contato", () => {
  it("{contact}: ctc_, phone canônico, wa:, ig:, ext:", () => {
    expect(parseContactAddress(`ctc_${CTC_A1}`)).toEqual({ kind: "id", id: CTC_A1 });
    expect(parseContactAddress("phone:21 99999-9999")).toEqual({ kind: "phone", phone: PHONE });
    expect(parseContactAddress("phone:552199999999")).toEqual({ kind: "phone", phone: PHONE });
    expect(parseContactAddress("wa:BR.abc123")).toEqual({ kind: "wa", bsuid: "BR.abc123" });
    expect(parseContactAddress("ig:178414")).toEqual({ kind: "ig", igsid: "178414" });
    expect(parseContactAddress("ext:user_42")).toEqual({ kind: "ext", externalId: "user_42" });
    expect(parseContactAddress("ctc_123")).toBeNull();
    expect(parseContactAddress("phone:abc")).toBeNull();
    expect(parseContactAddress("5521999999999")).toBeNull();
  });

  it("18 anos completos no dia, em São Paulo", () => {
    const now = Date.parse("2026-10-03T12:00:00-03:00");
    expect(adultOn("2008-10-03", now)).toBe(true);
    expect(adultOn("2008-10-04", now)).toBe(false);
    expect(adultOn("2030-01-01", now)).toBeNull();
    expect(adultOn("2008-02-30", now)).toBeNull();
    expect(adultOn("03/10/2008", now)).toBeNull();
  });

  it("origin obrigatório; age_verified ou birth_date, e os dois têm de bater", () => {
    const now = Date.parse("2026-10-03T12:00:00-03:00");
    expect(parseAgeBody({ age_verified: false, origin: "cadastro" }, now).verified).toBe(false);
    expect(parseAgeBody({ birth_date: "1990-05-01", origin: "cadastro" }, now).verified).toBe(true);
    expect(() => parseAgeBody({ age_verified: true }, now)).toThrow(/origin/);
    expect(() => parseAgeBody({ origin: "cadastro" }, now)).toThrow(/age_verified/);
    expect(() => parseAgeBody({ age_verified: "sim", origin: "cadastro" }, now)).toThrow(/true ou false/);
    expect(() => parseAgeBody({ age_verified: true, birth_date: "2015-01-01", origin: "cadastro" }, now)).toThrow(/não bate/);
  });
});

describe("rotas de /api/v1 só pelo invólucro", () => {
  const dir = join(__dirname, "..", "..", "app", "api", "v1");
  const files = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : /\.tsx?$/.test(n) ? [join(d, n)] : []));

  it("nenhuma rota abre o banco por conta própria nem fica fora do withApiKey", () => {
    const list = files(dir);
    expect(list.length).toBeGreaterThan(0);
    for (const f of list) {
      const code = readFileSync(f, "utf8");
      expect(code, f).not.toMatch(/supabase\/(admin|server)|createAdminClient|createClient|\.from\(/);
      for (const m of code.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b(.*)/g)) expect(m[2], `${f} ${m[1]}`).toMatch(/=\s*withApiKey/);
    }
  });
});
