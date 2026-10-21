import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";

/*
 * Leva das sobras, parte 1: o aviso do momento pela API (GET, PUT e DELETE /v1/bots/{id}/notice,
 * com o escopo da chave e as permissões sources ou provisioning) e o webhook da resposta da
 * pesquisa de satisfação (survey.answered, só a primeira resposta).
 */

const env = vi.hoisted(() => ({ db: null as unknown as SupabaseClient, events: [] as Array<{ conv: string; data: Record<string, unknown> }> }));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => env.db }));
vi.mock("../message-events", async (orig) => ({
  ...(await orig<typeof import("../message-events")>()),
  queueSurveyAnswered: vi.fn(async (_db: unknown, conv: string, s: Parameters<typeof import("../message-events").surveyEventData>[0]) => {
    const { surveyEventData } = await orig<typeof import("../message-events")>();
    env.events.push({ conv, data: surveyEventData(s) });
  }),
}));

import { newApiKey } from "../api-keys";
import { untilFromApi, checkMomentNotice } from "../moment-notice";
import { GET, PUT, DELETE } from "../../app/api/v1/bots/[id]/notice/route";
import { handleSatisfactionReplies } from "../satisfaction";
import { surveyEventData } from "../message-events";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const BOT = "aaaaaaaa-0000-4000-8000-0000000000a1";
const OTHER = "aaaaaaaa-0000-4000-8000-0000000000a2";

let keys: Record<string, string>;
let tables: Record<string, MemRow[]>;

beforeEach(() => {
  env.events.length = 0;
  const k = { sources: newApiKey(), prov: newApiKey(), msgs: newApiKey(), one: newApiKey() };
  const key = (x: { prefix: string; hash: string }, id: string, extra: MemRow = {}) => ({ id, agency_id: A, name: id, prefix: x.prefix, key_hash: x.hash, scope_type: "all", scope_bot_ids: [], scope_client_id: null, permissions: ["sources"], last_used_at: null, revoked_at: null, ...extra });
  keys = { sources: k.sources.key, prov: k.prov.key, msgs: k.msgs.key, one: k.one.key };
  tables = {
    api_keys: [key(k.sources, "k-sources"), key(k.prov, "k-prov", { permissions: ["provisioning"] }), key(k.msgs, "k-msgs", { permissions: ["messages"] }), key(k.one, "k-one", { scope_type: "bots", scope_bot_ids: [OTHER] })],
    agency_packs: [{ agency_id: A, pack: "integracoes", ends_at: null }],
    agencies: [{ id: A }],
    clients: [],
    bots: [
      { id: BOT, agency_id: A, client_id: null, name: "Lia", client_name: "Provedor Net", is_demo: false, is_template: false, version_of: null, moment_notice: null, moment_notice_until: null, moment_notice_by: null },
      { id: OTHER, agency_id: A, client_id: null, name: "Outro", client_name: "Outra", is_demo: false, is_template: false, version_of: null },
    ],
    audit_log: [],
    idempotency_keys: [],
  };
  env.db = memoryDb(tables);
});

const call = (method: string, key: string, body?: unknown) =>
  new Request(`http://localhost/api/v1/bots/bot_${BOT}/notice`, { method, headers: { host: "localhost", authorization: `Bearer ${key}` }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = { params: Promise.resolve({ id: `bot_${BOT}` }) };
const errorOf = async (r: Response) => ((await r.json()) as { error: { code: string; details?: Record<string, unknown> } }).error;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");

describe("aviso do momento pela API", () => {
  it("o prazo em ISO 8601 com o fuso; as mesmas regras do painel", () => {
    expect(untilFromApi("2026-10-22T18:00:00-03:00")).toBe("2026-10-22T21:00:00.000Z");
    expect(untilFromApi("2026-10-22T18:00Z")).toBe("2026-10-22T18:00:00.000Z");
    expect(untilFromApi("2026-10-22 18:00")).toBeNull();
    expect(untilFromApi("2026-10-22T18:00:00")).toBeNull();
    expect(untilFromApi(1761170000)).toBeNull();
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(checkMomentNotice("oi", "2026-10-22T12:00:00.000Z", now)).toMatchObject({ ok: false, field: "text" });
    expect(checkMomentNotice("Internet fora no Centro", "2026-10-21T12:05:00.000Z", now)).toMatchObject({ ok: false, field: "until" });
    expect(checkMomentNotice("Internet fora no Centro", "2026-11-30T12:00:00.000Z", now)).toMatchObject({ ok: false, field: "until" });
  });

  it("PUT põe o aviso, GET mostra, DELETE tira (com a auditoria)", async () => {
    const until = inHours(6);
    const put = await PUT(call("PUT", keys.sources, { text: "Instabilidade na fibra no bairro Centro; previsão de volta às 18h.", until }), params);
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ bot_id: `bot_${BOT}`, notice: { text: "Instabilidade na fibra no bairro Centro; previsão de volta às 18h.", until: new Date(until).toISOString(), set_by: "API (k-sources)" } });
    expect(tables.bots[0]).toMatchObject({ moment_notice_by: "API (k-sources)" });

    const got = await GET(call("GET", keys.prov), params);
    expect((await got.json()).notice).toMatchObject({ text: "Instabilidade na fibra no bairro Centro; previsão de volta às 18h." });

    const del = await DELETE(call("DELETE", keys.sources), params);
    expect(await del.json()).toEqual({ bot_id: `bot_${BOT}`, notice: null, removed: true });
    expect(tables.bots[0].moment_notice).toBeNull();
    const again = await DELETE(call("DELETE", keys.sources), params);
    expect((await again.json()).removed).toBe(false);
    expect(tables.audit_log.map((a) => a.action)).toEqual(["bot.aviso_momento", "bot.aviso_momento_apagar"]);
  });

  it("aviso vencido sai como null; erros claros; a permissão e o escopo da chave valem", async () => {
    tables.bots[0].moment_notice = "Manutenção";
    tables.bots[0].moment_notice_until = new Date(Date.now() - 60_000).toISOString();
    expect((await (await GET(call("GET", keys.sources), params)).json()).notice).toBeNull();

    const short = await PUT(call("PUT", keys.sources, { text: "oi", until: inHours(2) }), params);
    expect(short.status).toBe(400);
    expect((await errorOf(short)).details).toEqual({ field: "text" });
    const badDate = await PUT(call("PUT", keys.sources, { text: "Manutenção às 22h", until: "amanhã" }), params);
    expect((await errorOf(badDate)).details).toEqual({ field: "until" });
    const extra = await PUT(call("PUT", keys.sources, { text: "Manutenção às 22h", until: inHours(2), canal: "whatsapp" }), params);
    expect((await errorOf(extra)).details).toEqual({ field: "canal" });

    expect((await errorOf(await GET(call("GET", keys.msgs), params))).code).toBe("forbidden_scope");
    // a chave só de outro chatbot: este fica fora do escopo
    const out = await GET(call("GET", keys.one), params);
    expect(out.status).toBe(403);
    expect((await errorOf(out)).code).toBe("forbidden_scope");
  });
});

describe("survey.answered", () => {
  it("a nota, o rótulo e o que fez a pesquisa sair", () => {
    expect(surveyEventData({ id: "s1", score: 1, trigger: "ia", sentAt: "2026-10-21T10:00:00Z", answeredAt: "2026-10-21T10:02:00Z" })).toEqual({ survey: { id: "srv_s1", sent_at: "2026-10-21T10:00:00Z", trigger: "ai_idle" }, score: 1, rating: "bad", answered_at: "2026-10-21T10:02:00Z" });
  });

  it("sai só na primeira resposta de cada pesquisa", async () => {
    const id = "aaaaaaaa-0000-4000-8000-00000000c5a1";
    const t: Record<string, MemRow[]> = { satisfaction_surveys: [{ id, bot_id: BOT, conversation_id: "c1", channel: "whatsapp", trigger: "equipe", sent_at: "2026-10-21T10:00:00Z", score: null, answered_at: null }] };
    const io = { db: memoryDb(t), conversation: async () => "c1", store: async () => undefined, reply: async () => undefined };
    await handleSatisfactionReplies(io, [{ text: "Ótimo", buttonId: `csat:3:${id}` }]);
    await handleSatisfactionReplies(io, [{ text: "Ruim", buttonId: `csat:1:${id}` }]);
    expect(env.events).toHaveLength(1);
    expect(env.events[0]).toMatchObject({ conv: "c1", data: { survey: { id: `srv_${id}`, trigger: "agent_finished" }, score: 3, rating: "great" } });
  });
});
