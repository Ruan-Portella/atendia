import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";

/*
 * API de provisionamento (D', parte 4a): POST /v1/clients, POST /v1/bots do modelo e GET
 * /v1/clients/{id}, com o escopo da chave, o pacote Plataforma, a idempotência pelo external_id e o
 * display do chatbot na IA. Banco em memória, com os índices únicos do external_id.
 */

const env = vi.hoisted(() => {
  // o link de conexão guarda o token cifrado com a chave mestra (secret-box)
  process.env.WHATSAPP_TOKEN_KEY ??= "chave-mestra-dos-testes-0123456789";
  return { db: null as unknown as SupabaseClient };
});
vi.mock("../supabase/admin", () => ({ createAdminClient: () => env.db }));

import { newApiKey } from "../api-keys";
import { parseClientBody, parseOverrides } from "../api-provisioning";
import { displayContext, withDisplay } from "../bot-context";
import { ApiError } from "../api-v1";
import { POST as POST_CLIENT } from "../../app/api/v1/clients/route";
import { GET as GET_CLIENT } from "../../app/api/v1/clients/[id]/route";
import { POST as POST_BOT } from "../../app/api/v1/bots/route";
import { POST as POST_LINK } from "../../app/api/v1/bots/[id]/connect-links/route";
import { GET as GET_CHANNELS } from "../../app/api/v1/bots/[id]/channels/route";
import { DELETE as DELETE_CHANNEL } from "../../app/api/v1/bots/[id]/channels/[channel]/route";
import { POST as POST_PAUSE } from "../../app/api/v1/bots/[id]/pause/route";
import { POST as POST_RESUME } from "../../app/api/v1/bots/[id]/resume/route";
import { GET as GET_MEMBERS, POST as POST_MEMBER } from "../../app/api/v1/clients/[id]/members/route";
import { DELETE as DELETE_MEMBER } from "../../app/api/v1/clients/[id]/members/[member]/route";
import { apiInvitesDigest, parseMemberBody } from "../api-members";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const CLIENT_A1 = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CLIENT_A2 = "aaaaaaaa-0000-4000-8000-0000000000c2";
const CLIENT_B1 = "bbbbbbbb-0000-4000-8000-0000000000c1";
const BOT_A1 = "aaaaaaaa-0000-4000-8000-0000000000a1";
const BOT_A2 = "aaaaaaaa-0000-4000-8000-0000000000a2";
const T = "aaaaaaaa-0000-4000-8000-0000000000f1";
const V1 = "aaaaaaaa-0000-4000-8000-0000000000f2";

const TEMPLATE_FIELDS = { name: "Duda", persona: { tone: "simpático", welcome: "Olá! Sou {assistente}, da {empresa}.", instructions: "Fale do cardápio do dia." }, appearance: { color: "#c0392b", suggested_questions: ["Qual o cardápio?"] }, human_handoff: { widget_button: true }, business_topics: null };

let keys: Record<string, string>;
let tables: Record<string, MemRow[]>;

beforeEach(() => {
  const k = { all: newApiKey(), billing: newApiKey(), client: newApiKey(), bots: newApiKey(), b: newApiKey(), members: newApiKey() };
  const key = (x: { prefix: string; hash: string }, id: string, agency: string, extra: MemRow) => ({ id, agency_id: agency, name: id, prefix: x.prefix, key_hash: x.hash, scope_type: "all", scope_bot_ids: [], scope_client_id: null, permissions: ["provisioning"], last_used_at: null, revoked_at: null, ...extra });
  keys = { all: k.all.key, billing: k.billing.key, client: k.client.key, bots: k.bots.key, b: k.b.key, members: k.members.key };
  tables = {
    api_keys: [
      key(k.all, "k-all", A, {}),
      key(k.billing, "k-billing", A, { permissions: ["provisioning", "billing"] }),
      key(k.client, "k-client", A, { scope_type: "client", scope_client_id: CLIENT_A1 }),
      key(k.bots, "k-bots", A, { scope_type: "bots", scope_bot_ids: [BOT_A1] }),
      key(k.b, "k-b", B, {}),
      key(k.members, "k-members", A, { scope_type: "client", scope_client_id: CLIENT_A1, permissions: ["members"] }),
    ],
    // a conta B tem a API (Integrações), mas não o Plataforma
    agency_packs: [
      { agency_id: A, pack: "integracoes", ends_at: null },
      { agency_id: A, pack: "plataforma", ends_at: null },
      { agency_id: B, pack: "integracoes", ends_at: null },
    ],
    agencies: [{ id: A, billing_status: "trial", features: ["whatsapp"] }],
    clients: [
      { id: CLIENT_A1, agency_id: A, name: "Pizzaria do Zé", site: null, external_id: "loja-1", created_at: "2026-10-01T12:00:00Z" },
      { id: CLIENT_A2, agency_id: A, name: "Sushi da Ana", site: null, external_id: null, created_at: "2026-10-02T12:00:00Z" },
      { id: CLIENT_B1, agency_id: B, name: "Outra conta", site: null, external_id: null },
    ],
    bots: [
      { id: T, agency_id: A, client_id: null, client_name: "Modelo", is_demo: false, is_template: true, version_of: null, published_bot_id: V1, template_unlocked: ["nome", "saudacao", "instrucoes"], ...TEMPLATE_FIELDS },
      { id: V1, agency_id: A, client_id: null, client_name: "Modelo", is_demo: false, is_template: true, version_of: T, template_unlocked: ["nome", "saudacao", "instrucoes"], ...TEMPLATE_FIELDS },
      { id: BOT_A1, agency_id: A, client_id: CLIENT_A1, client_name: "Pizzaria do Zé", name: "Zé", status: "live", is_demo: false, is_template: false, version_of: null, external_id: "site", created_at: "2026-10-01T12:00:00Z", size: "M", quota_override: null, paused_at: null },
      { id: BOT_A2, agency_id: A, client_id: CLIENT_A1, client_name: "Pizzaria do Zé", name: "Zé 2", status: "draft", is_demo: false, is_template: false, version_of: null, created_at: "2026-10-02T12:00:00Z", size: null, quota_override: null },
    ],
    whatsapp_channels: [{ id: "wa-1", bot_id: BOT_A1, phone_number_id: "1092", waba_id: "W1", display_phone: "+55 21 99999-0000", created_at: "2026-10-03T12:00:00Z", disconnected_at: null, disconnect_reason: null, payment_issue_at: null }],
    instagram_channels: [],
    business_compliance: [],
    enforcement_actions: [],
    audit_log: [],
    idempotency_keys: [],
    client_members: [{ id: "aaaaaaaa-0000-4000-8000-0000000000e1", client_id: CLIENT_A1, email: "gerente@pizzariadoze.com.br", role: "manager", display_name: null, last_login_at: null, created_at: "2026-10-01T12:00:00Z", invited_by_key: null }],
  };
  env.db = memoryDb(tables);
});

const call = (method: string, path: string, key: string | null, o: { body?: unknown; idem?: string } = {}) =>
  new Request(`http://localhost/api/v1/${path}`, {
    method,
    headers: { host: "localhost", ...(key ? { authorization: `Bearer ${key}` } : {}), ...(o.idem ? { "idempotency-key": o.idem } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
const noParams = { params: Promise.resolve({}) };
const errorOf = async (r: Response) => ((await r.json()) as { error: { code: string; details?: Record<string, unknown> } }).error;

describe("POST /v1/clients", () => {
  it("cria o cliente (201) e o mesmo external_id devolve o mesmo (200), sem um segundo", async () => {
    const body = { name: "Hamburgueria do Léo", external_id: "loja-42", site: "hamburgueriadoleo.com.br" };
    const r = await POST_CLIENT(call("POST", "clients", keys.all, { body }), noParams);
    expect(r.status).toBe(201);
    const created = await r.json();
    expect(created).toMatchObject({ external_id: "loja-42", name: "Hamburgueria do Léo", compliance_status: "active" });
    expect(created.client_id).toMatch(/^cli_[0-9a-f-]{36}$/);
    const row = tables.clients.find((c) => c.external_id === "loja-42");
    expect(row).toMatchObject({ agency_id: A, site: "https://hamburgueriadoleo.com.br/" });
    expect(tables.audit_log.map((a) => a.action)).toEqual(["cliente.criar"]);

    const again = await POST_CLIENT(call("POST", "clients", keys.all, { body: { ...body, name: "Outro nome" } }), noParams);
    expect(again.status).toBe(200);
    expect((await again.json()).client_id).toBe(created.client_id);
    expect(tables.clients.filter((c) => c.external_id === "loja-42")).toHaveLength(1);
  });

  it("a declaração de lembretes vai junto, com a chave como autor", async () => {
    const r = await POST_CLIENT(call("POST", "clients", keys.all, { body: { name: "Clínica Sorriso", external_id: "c-9", utility_consent: { source: "contrato", text: "Cláusula 7 do contrato: o paciente aceita lembretes de consulta pelo WhatsApp." } } }), noParams);
    expect(r.status).toBe(201);
    const row = tables.clients.find((c) => c.external_id === "c-9");
    expect(row).toMatchObject({ utility_consent_origin: "contrato", utility_consent_by: expect.stringContaining('Chave da API "k-all"') });
    expect(tables.audit_log.map((a) => a.action)).toEqual(["cliente.criar", "cliente.lembretes_declarar"]);
  });

  it("só com chave da conta inteira e com o pacote Plataforma", async () => {
    const scoped = await POST_CLIENT(call("POST", "clients", keys.client, { body: { name: "X Lanches", external_id: "x" } }), noParams);
    expect(scoped.status).toBe(403);
    expect((await errorOf(scoped)).code).toBe("forbidden_scope");
    const noPack = await POST_CLIENT(call("POST", "clients", keys.b, { body: { name: "X Lanches", external_id: "x" } }), noParams);
    expect(noPack.status).toBe(403);
    expect(await errorOf(noPack)).toMatchObject({ code: "plan_not_allowed", details: { pack: "plataforma" } });
    expect(tables.clients).toHaveLength(3);
  });

  it("corpo: nome, external_id, site, campos desconhecidos e a declaração", () => {
    const field = (body: Record<string, unknown>) => {
      try {
        parseClientBody(body);
        return null;
      } catch (e) {
        return ((e as ApiError).details as { field: string }).field;
      }
    };
    expect(field({ name: "Z", external_id: "a" })).toBe("name");
    expect(field({ name: "Zé Lanches" })).toBe("external_id");
    expect(field({ name: "Zé Lanches", external_id: "a\nb" })).toBe("external_id");
    expect(field({ name: "Zé Lanches", external_id: "a", site: "não é site" })).toBe("site");
    expect(field({ name: "Zé Lanches", external_id: "a", instagram: "@ze" })).toBe("instagram");
    expect(field({ name: "Zé Lanches", external_id: "a", utility_consent: { source: "contrato", text: "curto" } })).toBe("utility_consent.text");
    expect(field({ name: "Zé Lanches", external_id: "a", utility_consent: { source: "whatsapp", text: "x".repeat(30) } })).toBe("utility_consent.source");
    expect(parseClientBody({ name: "  Zé   Lanches ", external_id: " loja-7 " })).toEqual({ name: "Zé Lanches", externalId: "loja-7", site: null, utilityConsent: null });
  });
});

describe("POST /v1/bots", () => {
  const body = (o: Record<string, unknown> = {}) => ({ client_id: `cli_${CLIENT_A1}`, template_id: `bot_${T}`, external_id: "loja-1-site", context: { loja_id: "42" }, display: { nome: "Pizzaria do Zé, Centro", horario: "terça a domingo, das 18h às 23h" }, ...o });

  it("cria o derivado da versão publicada, com o contexto, o display e os valores próprios liberados", async () => {
    const r = await POST_BOT(call("POST", "bots", keys.all, { idem: "k1", body: body({ overrides: { assistant_name: "Bia", extra_instructions: "Aos domingos, rodízio." } }) }), noParams);
    expect(r.status).toBe(201);
    const out = await r.json();
    expect(out).toMatchObject({ client_id: `cli_${CLIENT_A1}`, external_id: "loja-1-site", template_id: `bot_${T}`, name: "Bia", context: { loja_id: "42" }, display: { nome: "Pizzaria do Zé, Centro" }, size_change: null });
    expect(out.widget_key).toMatch(/^[0-9a-f]{24}$/);
    const bot = tables.bots.find((b) => `bot_${b.id}` === out.bot_id)!;
    expect(bot).toMatchObject({ template_id: T, config_bot_id: V1, client_name: "Pizzaria do Zé", overrides: { nome: "Bia" }, extra_instructions: "Aos domingos, rodízio.", fixed_context: { loja_id: "42" } });
    expect((bot.persona as { instructions: string }).instructions).toBe("Fale do cardápio do dia.\n\nAos domingos, rodízio.");
    expect((bot.persona as { welcome: string }).welcome).toBe("Olá! Sou Bia, da Pizzaria do Zé.");
    expect(tables.audit_log.find((a) => a.action === "modelo.derivar")).toMatchObject({ actor_type: "api_key", target_id: bot.id });
  });

  it("idempotente: a mesma Idempotency-Key repete a resposta; o mesmo external_id devolve o mesmo chatbot (200)", async () => {
    const first = await (await POST_BOT(call("POST", "bots", keys.all, { idem: "k1", body: body() }), noParams)).json();
    const replay = await POST_BOT(call("POST", "bots", keys.all, { idem: "k1", body: body() }), noParams);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect((await replay.json()).bot_id).toBe(first.bot_id);
    const again = await POST_BOT(call("POST", "bots", keys.all, { idem: "k2", body: body({ display: { nome: "outro" } }) }), noParams);
    expect(again.status).toBe(200);
    const out = await again.json();
    expect(out.bot_id).toBe(first.bot_id);
    // o que já existe não muda: para mudar, o PATCH
    expect(out.display).toEqual({ nome: "Pizzaria do Zé, Centro", horario: "terça a domingo, das 18h às 23h" });
    expect(tables.bots.filter((b) => b.template_id === T)).toHaveLength(1);
    const conflict = await POST_BOT(call("POST", "bots", keys.all, { idem: "k1", body: body({ external_id: "outro" }) }), noParams);
    expect((await errorOf(conflict)).code).toBe("idempotency_conflict");
  });

  it("Idempotency-Key obrigatória, campo travado pelo modelo, modelo de outra conta e size sem billing", async () => {
    const noKey = await POST_BOT(call("POST", "bots", keys.all, { body: body() }), noParams);
    expect(await errorOf(noKey)).toMatchObject({ code: "invalid_request", details: { field: "Idempotency-Key" } });
    const locked = await POST_BOT(call("POST", "bots", keys.all, { idem: "k3", body: body({ overrides: { appearance: { color: "#000000" } } }) }), noParams);
    expect(locked.status).toBe(403);
    expect(await errorOf(locked)).toMatchObject({ code: "field_locked", details: { field: "overrides.appearance" } });
    const noTemplate = await POST_BOT(call("POST", "bots", keys.all, { idem: "k4", body: body({ template_id: `bot_${BOT_A1}` }) }), noParams);
    expect(noTemplate.status).toBe(404);
    expect((await errorOf(noTemplate)).details).toEqual({ field: "template_id" });
    const noBilling = await POST_BOT(call("POST", "bots", keys.all, { idem: "k5", body: body({ size: "M" }) }), noParams);
    expect(await errorOf(noBilling)).toMatchObject({ code: "forbidden_scope", details: { permission: "billing" } });
    // com billing, mas sem assinatura: nada é criado antes de recusar
    const noSub = await POST_BOT(call("POST", "bots", keys.billing, { idem: "k6", body: body({ size: "M" }) }), noParams);
    expect(noSub.status).toBe(422);
    expect((await errorOf(noSub)).code).toBe("subscription_required");
    expect(tables.bots.filter((b) => b.template_id === T)).toHaveLength(0);
  });

  it("escopo: chave de chatbots não cria; chave do cliente só no cliente dela; cliente de outra conta é 404", async () => {
    const bots = await POST_BOT(call("POST", "bots", keys.bots, { idem: "k1", body: body() }), noParams);
    expect((await errorOf(bots)).code).toBe("forbidden_scope");
    const other = await POST_BOT(call("POST", "bots", keys.client, { idem: "k1", body: body({ client_id: `cli_${CLIENT_A2}` }) }), noParams);
    expect(other.status).toBe(404);
    const foreign = await POST_BOT(call("POST", "bots", keys.all, { idem: "k1", body: body({ client_id: `cli_${CLIENT_B1}` }) }), noParams);
    expect(foreign.status).toBe(404);
    const mine = await POST_BOT(call("POST", "bots", keys.client, { idem: "k2", body: body() }), noParams);
    expect(mine.status).toBe(201);
  });
});

describe("GET /v1/clients/{id}", () => {
  const get = (key: string, id: string) => GET_CLIENT(call("GET", `clients/cli_${id}`, key), { params: Promise.resolve({ id: `cli_${id}` }) });

  it("os dados, os chatbots com os canais da Meta e a conformidade", async () => {
    const r = await get(keys.all, CLIENT_A1);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      id: `cli_${CLIENT_A1}`,
      external_id: "loja-1",
      name: "Pizzaria do Zé",
      site: null,
      created_at: "2026-10-01T12:00:00Z",
      utility_consent: null,
      bots: [
        { id: `bot_${BOT_A1}`, external_id: "site", name: "Zé", status: "live", paused: false, template_id: null, channels: ["whatsapp"] },
        { id: `bot_${BOT_A2}`, external_id: null, name: "Zé 2", status: "draft", paused: false, template_id: null, channels: [] },
      ],
      compliance: { status: "active", restrictions: [], reason_summary: "Sem restrições em vigor.", next_step: null },
    });
  });

  it("o escopo da chave: o cliente dela, ou os chatbots da lista; fora disso, 404", async () => {
    expect((await get(keys.client, CLIENT_A2)).status).toBe(404);
    expect((await get(keys.all, CLIENT_B1)).status).toBe(404);
    const viaBots = await (await get(keys.bots, CLIENT_A1)).json();
    expect(viaBots.bots.map((b: { id: string }) => b.id)).toEqual([`bot_${BOT_A1}`]);
    expect((await get(keys.bots, CLIENT_A2)).status).toBe(404);
    const bad = await GET_CLIENT(call("GET", "clients/123", keys.all), { params: Promise.resolve({ id: "123" }) });
    expect(bad.status).toBe(404);
  });
});

describe("valores próprios pela API", () => {
  const o = { unlocked: ["nome", "saudacao", "aparencia", "anuncio", "instrucoes"] as never, templateAppearance: { color: "#c0392b", suggested_questions: ["Qual o cardápio?"] }, clientName: "Pizzaria do Zé" };

  it("a aparência vale por cima da do modelo, com as iniciais do cliente", () => {
    expect(parseOverrides({ appearance: { position: "left" } }, o).overrides.aparencia).toEqual({ color: "#c0392b", suggested_questions: ["Qual o cardápio?"], avatar_text: "PD", position: "left" });
  });

  it("as regras do painel: o anúncio pede {atendente}, a cor é #rrggbb, campo desconhecido é 400", () => {
    const code = (raw: unknown) => {
      try {
        parseOverrides(raw, o);
        return "ok";
      } catch (e) {
        return `${(e as ApiError).status} ${((e as ApiError).details as { field: string }).field}`;
      }
    };
    expect(code({ handoff_notice: "Oi, sou da equipe." })).toBe("400 overrides.handoff_notice");
    expect(code({ handoff_notice: "Oi, sou {atendente}, da equipe." })).toBe("ok");
    expect(code({ appearance: { color: "vermelho" } })).toBe("400 overrides.appearance.color");
    expect(code({ tone: "sério" })).toBe("400 overrides.tone");
    expect(code({ welcome: "" })).toBe("400 overrides.welcome");
    expect(parseOverrides({ extra_instructions: "  " }, o)).toEqual({ overrides: {}, extraInstructions: null });
  });
});

describe("display do chatbot na IA", () => {
  it("vira o primeiro trecho da base, no mesmo formato dos outros", () => {
    expect(displayContext({ nome: "Pizzaria do Zé, Centro", horario_de_entrega: "18h às 23h" })).toBe("[Dados deste atendimento, informados pela empresa]\nnome: Pizzaria do Zé, Centro\nhorario de entrega: 18h às 23h");
    expect(withDisplay("[1] Cardápio\nCalabresa R$ 40", { nome: "Zé" })).toBe("[Dados deste atendimento, informados pela empresa]\nnome: Zé\n\n---\n\n[1] Cardápio\nCalabresa R$ 40");
    expect(withDisplay("", { nome: "Zé" })).toBe("[Dados deste atendimento, informados pela empresa]\nnome: Zé");
    expect(withDisplay("[1] x", null)).toBe("[1] x");
  });
});

describe("canais e pausa pela API (parte 4b)", () => {
  const route = (id: string) => ({ params: Promise.resolve({ id: `bot_${id}` }) });
  const link = (key: string, id: string, body: unknown) => POST_LINK(call("POST", `bots/bot_${id}/connect-links`, key, { body }), route(id));

  it("link de conexão: devolve o mesmo enquanto aberto; rotate troca; canal conectado não é erro", async () => {
    const first = await link(keys.all, BOT_A1, { channel: "whatsapp" });
    expect(first.status).toBe(200);
    const a = await first.json();
    expect(a).toMatchObject({ channel: "whatsapp", channel_connected: true, connected_channel: { id: "chn_wa_1092", display: "+55 21 99999-0000", status: "connected" } });
    expect(a.url).toMatch(/\/conectar\/[A-Za-z0-9_-]{20,}$/);
    const again = await (await link(keys.all, BOT_A1, { channel: "whatsapp" })).json();
    expect(again.url).toBe(a.url);
    const rotated = await (await link(keys.all, BOT_A1, { channel: "whatsapp", rotate: true })).json();
    expect(rotated.url).not.toBe(a.url);
    // o anterior deixou de valer: só o novo fica aberto
    expect(tables.whatsapp_connect_links.filter((l) => l.bot_id === BOT_A1)).toHaveLength(1);
    expect(tables.audit_log.filter((r) => r.action === "canal.link_gerar")).toHaveLength(2);
  });

  it("link: só com tamanho, só canal liberado na conta, nunca no modelo", async () => {
    const unsized = await link(keys.all, BOT_A2, { channel: "whatsapp" });
    expect(unsized.status).toBe(422);
    expect((await errorOf(unsized)).code).toBe("bot_without_size");
    const closed = await link(keys.all, BOT_A1, { channel: "instagram" });
    expect(await errorOf(closed)).toMatchObject({ code: "feature_suspended", details: { feature: "channel", channel: "instagram" } });
    const template = await link(keys.all, T, { channel: "whatsapp" });
    expect(template.status).toBe(400);
    const bad = await link(keys.all, BOT_A1, { channel: "sms" });
    expect((await errorOf(bad)).details).toEqual({ field: "channel" });
  });

  it("canais: lista com o estado e o problema de pagamento; desconectar avisa o dono e some da lista", async () => {
    tables.whatsapp_channels[0].payment_issue_at = "2026-10-18T10:00:00Z";
    const list = await (await GET_CHANNELS(call("GET", `bots/bot_${BOT_A1}/channels`, keys.all), route(BOT_A1))).json();
    expect(list.data).toEqual([
      { id: "chn_wa_1092", type: "whatsapp", display: "+55 21 99999-0000", status: "connected", connected_at: "2026-10-03T12:00:00Z", disconnected_at: null, reason: null, issue: { code: "131042", message: "a conta do WhatsApp está sem forma de pagamento na Meta", since: "2026-10-18T10:00:00Z" } },
    ]);
    const params = (ch: string) => ({ params: Promise.resolve({ id: `bot_${BOT_A1}`, channel: ch }) });
    const unknown = await DELETE_CHANNEL(call("DELETE", `bots/bot_${BOT_A1}/channels/chn_wa_999`, keys.all), params("chn_wa_999"));
    expect(unknown.status).toBe(404);
    const gone = await DELETE_CHANNEL(call("DELETE", `bots/bot_${BOT_A1}/channels/chn_wa_1092`, keys.all), params("chn_wa_1092"));
    expect(gone.status).toBe(204);
    expect(tables.whatsapp_channels).toHaveLength(0);
    expect(tables.audit_log.find((r) => r.action === "canal.desconectar_api")).toMatchObject({ actor_type: "api_key", target_id: BOT_A1 });
    // fora do escopo da chave: 403 (como toda rota de chatbot)
    const scoped = await GET_CHANNELS(call("GET", `bots/bot_${BOT_A2}/channels`, keys.bots), route(BOT_A2));
    expect(scoped.status).toBe(403);
  });

  it("pausa: grava a do dono pela API; de novo devolve o paused_at de antes; retomar traz as restrições", async () => {
    const p1 = await (await POST_PAUSE(call("POST", `bots/bot_${BOT_A1}/pause`, keys.all, { body: { reason: "loja fechada para reforma", notify_contacts: true } }), route(BOT_A1))).json();
    expect(p1).toMatchObject({ paused: true, already_paused: false });
    expect(tables.bots.find((b) => b.id === BOT_A1)).toMatchObject({ paused_by: "API (k-all)", pause_reason: "loja fechada para reforma", pause_notify: true });
    const p2 = await (await POST_PAUSE(call("POST", `bots/bot_${BOT_A1}/pause`, keys.all, { body: {} }), route(BOT_A1))).json();
    expect(p2).toMatchObject({ paused_at: p1.paused_at, already_paused: true });
    tables.enforcement_actions.push({ source: "boavoz", feature: "channel", channel: "instagram", agency_id: A, bot_id: BOT_A1, waba_id: null, lifted_at: null });
    const r = await (await POST_RESUME(call("POST", `bots/bot_${BOT_A1}/resume`, keys.all), route(BOT_A1))).json();
    expect(r).toEqual({ bot_id: `bot_${BOT_A1}`, paused: false, was_paused: true, restrictions: [{ type: "channel", channel: "instagram", source: "boavoz" }] });
    expect(tables.bots.find((b) => b.id === BOT_A1)?.paused_at).toBeNull();
    expect(tables.audit_log.filter((a) => a.action === "bot.pausar" || a.action === "bot.retomar").map((a) => a.action)).toEqual(["bot.pausar", "bot.retomar"]);
    const bad = await POST_PAUSE(call("POST", `bots/bot_${BOT_A1}/pause`, keys.all, { body: { notify_contacts: "sim" } }), route(BOT_A1));
    expect((await errorOf(bad)).details).toEqual({ field: "notify_contacts" });
  });
});

describe("equipe do portal pela API (parte 4c)", () => {
  const route = (id: string) => ({ params: Promise.resolve({ id: `cli_${id}` }) });
  const invite = (key: string, client: string, body: unknown) => POST_MEMBER(call("POST", `clients/cli_${client}/members`, key, { body }), route(client));

  it("convida com a chave registrada; o mesmo e-mail devolve a pessoa (200); a lista mostra quem convidou", async () => {
    const r = await invite(keys.members, CLIENT_A1, { email: "Atendente@PizzariaDoZe.com.br", role: "agent", display_name: "Carla" });
    expect(r.status).toBe(201);
    const m = await r.json();
    // sem RESEND_API_KEY nos testes, o e-mail não sai (o acesso fica criado)
    expect(m).toMatchObject({ email: "atendente@pizzariadoze.com.br", role: "agent", display_name: "Carla", invited_by: { type: "api_key", name: "k-members" }, invite_email: "failed" });
    expect(m.id).toMatch(/^mbr_/);
    expect(tables.client_members.find((x) => x.email === "atendente@pizzariadoze.com.br")).toMatchObject({ invited_by_key: "k-members" });
    expect(tables.audit_log.find((a) => a.action === "portal.pessoa_adicionar")).toMatchObject({ actor_type: "api_key", target_id: CLIENT_A1 });

    const again = await invite(keys.members, CLIENT_A1, { email: "atendente@pizzariadoze.com.br", role: "manager" });
    expect(again.status).toBe(200);
    expect((await again.json()).role).toBe("agent");

    const list = await (await GET_MEMBERS(call("GET", `clients/cli_${CLIENT_A1}/members`, keys.members), route(CLIENT_A1))).json();
    expect(list.data.map((x: { email: string; invited_by: unknown }) => [x.email, x.invited_by])).toEqual([
      ["gerente@pizzariadoze.com.br", null],
      ["atendente@pizzariadoze.com.br", { type: "api_key", name: "k-members", prefix: expect.stringMatching(/…$/) }],
    ]);
  });

  it("só com a permissão members; a chave do cliente não alcança outro; remover tira o acesso", async () => {
    const noPerm = await invite(keys.all, CLIENT_A1, { email: "x@y.com.br", role: "agent" });
    expect(await errorOf(noPerm)).toMatchObject({ code: "forbidden_scope", details: { permission: "members" } });
    const other = await invite(keys.members, CLIENT_A2, { email: "x@y.com.br", role: "agent" });
    expect(other.status).toBe(404);
    const params = (member: string) => ({ params: Promise.resolve({ id: `cli_${CLIENT_A1}`, member }) });
    const gone = await DELETE_MEMBER(call("DELETE", `clients/cli_${CLIENT_A1}/members/mbr_aaaaaaaa-0000-4000-8000-0000000000e1`, keys.members), params("mbr_aaaaaaaa-0000-4000-8000-0000000000e1"));
    expect(gone.status).toBe(204);
    expect(tables.client_members).toHaveLength(0);
    const twice = await DELETE_MEMBER(call("DELETE", `clients/cli_${CLIENT_A1}/members/mbr_aaaaaaaa-0000-4000-8000-0000000000e1`, keys.members), params("mbr_aaaaaaaa-0000-4000-8000-0000000000e1"));
    expect(twice.status).toBe(404);
  });

  it("limite de 20 pessoas por cliente e o corpo do convite", async () => {
    for (let i = 0; i < 19; i++) tables.client_members.push({ id: `m-${i}`, client_id: CLIENT_A1, email: `p${i}@x.com.br`, role: "agent" });
    const full = await invite(keys.members, CLIENT_A1, { email: "vinte-e-um@x.com.br", role: "agent" });
    expect(full.status).toBe(422);
    expect((await errorOf(full)).code).toBe("plan_limit_reached");
    const field = (body: Record<string, unknown>) => {
      try {
        parseMemberBody(body);
        return null;
      } catch (e) {
        return ((e as ApiError).details as { field: string }).field;
      }
    };
    expect(field({ email: "não é e-mail", role: "agent" })).toBe("email");
    expect(field({ email: "a@b.com", role: "admin" })).toBe("role");
    expect(field({ email: "a@b.com", role: "agent", display_name: "x".repeat(41) })).toBe("display_name");
    expect(field({ email: "a@b.com", role: "agent", phone: "55" })).toBe("phone");
  });

  it("o resumo do dia junta os convites pela API de cada conta", async () => {
    await invite(keys.members, CLIENT_A1, { email: "um@x.com.br", role: "agent" });
    await invite(keys.members, CLIENT_A1, { email: "dois@x.com.br", role: "manager" });
    // um convite pelo painel não entra no resumo
    tables.audit_log.push({ agency_id: A, action: "portal.pessoa_adicionar", actor_type: "user", created_at: new Date().toISOString(), after: { email: "painel@x.com.br" } });
    expect(await apiInvitesDigest(env.db)).toEqual({ agencies: 1, invites: 2 });
  });
});
