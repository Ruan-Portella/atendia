import { beforeEach, describe, expect, it, vi } from "vitest";

// o envio de verdade fica de fora: cada aviso vira uma linha aqui; os endereços em `gone` o
// navegador já recusou de vez (410)
const sent: Array<{ endpoint: string; payload: { title: string; body: string; url: string; tag: string } }> = [];
const gone = new Set<string>();
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (sub: { endpoint: string }, payload: string) => {
      if (gone.has(sub.endpoint)) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    }),
  },
}));
// o limite de verdade é uma função do banco: aqui, um contador por chave
const hits = new Map<string, number>();
vi.mock("../rate-limit", () => ({
  firstExceeded: vi.fn(async (_db: unknown, rules: Array<{ key: string; max: number }>) => {
    for (const r of rules) hits.set(r.key, (hits.get(r.key) ?? 0) + 1);
    return rules.find((r) => (hits.get(r.key) ?? 0) > r.max) ?? null;
  }),
}));

import { memoryDb, type MemRow } from "../memory-db";
import { agencyPushKinds, deviceLabel, listPushDevices, parseSubscription, pushForNotice, pushOn, pushTo, removePushEndpoint, savePushPrefs, savePushSubscription } from "../push";

const AGENCY = "33333333-3333-4333-8333-333333333333";
const BOT = "77777777-7777-4777-8777-777777777777";
const CLIENT = "88888888-8888-4888-8888-888888888888";
const OWNER = "44444444-4444-4444-8444-444444444444";
const AGENT = "55555555-5555-4555-8555-555555555555";
const GONE_MEMBER = "66666666-6666-4666-8666-666666666666";
const CM1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CM2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const sub = (n: string) => ({ endpoint: `https://push.example.com/${n}`, keys: { p256dh: `p-${n}`, auth: `a-${n}` } });
const ep = (n: string) => `https://push.example.com/${n}`;

function tables(): Record<string, MemRow[]> {
  const member = (id: string, role: string, removed: string | null = null) => ({ id, agency_id: AGENCY, role, scope: "all", accepted_at: "2026-10-01T00:00:00.000Z", removed_at: removed, push_prefs: null });
  return {
    agency_members: [member(OWNER, "owner"), member(AGENT, "agent"), member(GONE_MEMBER, "agent", "2026-10-10T00:00:00.000Z")],
    agency_member_scopes: [],
    clients: [{ id: CLIENT, allow_handoff: true, handoff_notify: "agency" }],
    client_members: [
      { id: CM1, client_id: CLIENT, email: "a@cliente.com.br", push_prefs: null },
      { id: CM2, client_id: CLIENT, email: "b@cliente.com.br", push_prefs: null },
    ],
    push_subscriptions: [],
  };
}

const notice = (kind: "urgente" | "atendente" | "lead" | "canal", extra: Record<string, unknown> = {}) => ({ kind, agencyId: AGENCY, botId: BOT, clientId: CLIENT, vars: ["Bar do Zé (Zé)"], path: `painel/bots/${BOT}/conversas/conv-1`, ref: "conv-1", conversationId: "conv-1", ...extra });
const endpoints = () => sent.map((s) => s.endpoint).sort();

beforeEach(() => {
  sent.length = 0;
  gone.clear();
  hits.clear();
  vi.stubEnv("VAPID_PUBLIC_KEY", "chave-publica-de-teste");
  vi.stubEnv("VAPID_PRIVATE_KEY", "chave-privada-de-teste");
});

describe("avisos push: puras", () => {
  it("confere o endereço que o navegador manda", () => {
    expect(parseSubscription(sub("x"))).toEqual(sub("x"));
    expect(parseSubscription({ ...sub("x"), endpoint: "http://push.example.com/x" })).toBeNull();
    expect(parseSubscription({ endpoint: ep("x"), keys: { p256dh: "p" } })).toBeNull();
    expect(parseSubscription("lixo")).toBeNull();
  });

  it("o nome do aparelho, pelo navegador", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari no iPhone");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge no Windows");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome no Android");
    expect(deviceLabel(null)).toBe("navegador no aparelho");
  });

  it("sem escolha gravada, tudo ligado; os tipos de cada papel levam a transferência", () => {
    expect(pushOn(null, "lead")).toBe(true);
    expect(pushOn({ lead: false }, "lead")).toBe(false);
    expect(agencyPushKinds("agent")).toEqual(["urgente", "atendente", "transferencia", "lead"]);
    expect(agencyPushKinds("owner")).toEqual(["urgente", "atendente", "transferencia", "lead", "canal", "pagamento", "cota"]);
  });
});

describe("avisos push: aparelhos e envio", () => {
  it("o mesmo aparelho troca de dono quando outra pessoa ativa nele", async () => {
    const t = tables();
    const db = memoryDb(t);
    await savePushSubscription(db, { type: "agency_member", id: OWNER }, sub("pc"), "Chrome no Windows");
    await savePushSubscription(db, { type: "agency_member", id: AGENT }, sub("pc"), "Chrome no Windows");
    expect(t.push_subscriptions).toHaveLength(1);
    expect(await listPushDevices(db, { type: "agency_member", id: OWNER })).toEqual([]);
    expect((await listPushDevices(db, { type: "agency_member", id: AGENT })).map((d) => d.label)).toEqual(["Chrome no Windows"]);
    // as chaves ficam cifradas no campo (nos testes a cifra é a identidade)
    expect(JSON.parse(String(t.push_subscriptions[0].keys_enc))).toEqual(sub("pc").keys);
    await removePushEndpoint(db, { type: "agency_member", id: OWNER }, ep("pc"));
    expect(t.push_subscriptions).toHaveLength(1);
    await removePushEndpoint(db, { type: "agency_member", id: AGENT }, ep("pc"));
    expect(t.push_subscriptions).toHaveLength(0);
  });

  it("respeita a escolha de tipos, não repete o mesmo acontecimento e tira o aparelho recusado", async () => {
    const t = tables();
    const db = memoryDb(t);
    await savePushSubscription(db, { type: "agency_member", id: OWNER }, sub("dono-pc"), "Chrome no Windows");
    await savePushSubscription(db, { type: "agency_member", id: OWNER }, sub("dono-cel"), "Chrome no Android");
    await savePushSubscription(db, { type: "agency_member", id: AGENT }, sub("agente"), "Safari no iPhone");
    await savePushSubscription(db, { type: "agency_member", id: GONE_MEMBER }, sub("saiu"), "Chrome no Mac");
    await savePushPrefs(db, { type: "agency_member", id: AGENT }, agencyPushKinds("agent"), new Set(["urgente", "atendente"]));

    const targets = [OWNER, AGENT, GONE_MEMBER].map((id) => ({ type: "agency_member" as const, id }));
    const msg = { kind: "lead" as const, title: "Lead novo", body: "x", url: "/painel/leads", ref: "lead-1" };
    expect(await pushTo(db, targets, msg)).toBe(2);
    // quem desligou o lead e quem saiu da agência não recebem
    expect(endpoints()).toEqual([ep("dono-cel"), ep("dono-pc")]);
    expect(sent[0].payload).toMatchObject({ title: "Lead novo", url: "/painel/leads", tag: "lead:lead-1" });

    sent.length = 0;
    expect(await pushTo(db, targets, msg)).toBe(0);

    // o teste ignora a escolha de tipos e o prazo
    gone.add(ep("dono-pc"));
    expect(await pushTo(db, targets, { ...msg, kind: "teste", ref: "t1" })).toBe(2);
    expect(endpoints()).toEqual([ep("agente"), ep("dono-cel")]);
    expect(t.push_subscriptions.map((s) => s.endpoint).sort()).toEqual([ep("agente"), ep("dono-cel"), ep("saiu")]);
    expect(t.push_subscriptions.find((s) => s.endpoint === ep("agente"))?.last_sent_at).toBeTruthy();
  });

  it("sem as chaves VAPID, nada sai", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const t = tables();
    const db = memoryDb(t);
    await savePushSubscription(db, { type: "agency_member", id: OWNER }, sub("pc"), "Chrome no Windows");
    expect(await pushTo(db, [{ type: "agency_member", id: OWNER }], { kind: "teste", title: "t", body: "t", url: "/", ref: "1" })).toBe(0);
    expect(await pushForNotice(db, notice("atendente"))).toBe(0);
  });
});

describe("avisos push: os avisos da equipe", () => {
  async function devices(t: Record<string, MemRow[]>) {
    const db = memoryDb(t);
    await savePushSubscription(db, { type: "agency_member", id: OWNER }, sub("dono"), "Chrome no Windows");
    await savePushSubscription(db, { type: "agency_member", id: AGENT }, sub("agente"), "Chrome no Android");
    await savePushSubscription(db, { type: "client_member", id: CM1 }, sub("cliente-1"), "Safari no iPhone");
    await savePushSubscription(db, { type: "client_member", id: CM2 }, sub("cliente-2"), "Chrome no Android");
    return db;
  }

  it("pedido de atendente: a agência e a área do cliente que atende, cada uma com a sua página", async () => {
    const db = await devices(tables());
    expect(await pushForNotice(db, notice("atendente"))).toBe(4);
    const byEp = Object.fromEntries(sent.map((s) => [s.endpoint, s.payload.url]));
    expect(byEp[ep("dono")]).toBe(`/painel/bots/${BOT}/conversas/conv-1`);
    expect(byEp[ep("cliente-1")]).toBe(`/cliente/${CLIENT}/caixa?fila=todas&c=conv-1`);
  });

  it("o setor escolhe quem recebe, dos dois lados", async () => {
    const db = await devices(tables());
    await pushForNotice(db, notice("atendente", { onlyMemberIds: [AGENT], onlyClientMemberIds: [CM2] }));
    expect(endpoints()).toEqual([ep("agente"), ep("cliente-2")]);
  });

  it("atendimento com o cliente: a agência só recebe o urgente; o lead abre a conversa direto", async () => {
    const t = tables();
    t.clients[0].handoff_notify = "client";
    const db = await devices(t);
    await pushForNotice(db, notice("atendente"));
    expect(endpoints()).toEqual([ep("cliente-1"), ep("cliente-2")]);
    sent.length = 0;
    await pushForNotice(db, notice("urgente"));
    expect(endpoints()).toEqual([ep("agente"), ep("cliente-1"), ep("cliente-2"), ep("dono")]);
    sent.length = 0;
    await pushForNotice(db, notice("lead"));
    expect(sent.map((s) => s.payload.url)).toEqual([`/cliente/${CLIENT}/conversas/conv-1`, `/cliente/${CLIENT}/conversas/conv-1`]);
  });

  it("os avisos da agência (canal) e o cliente sem atendimento não chegam à área do cliente", async () => {
    const t = tables();
    const db = await devices(t);
    await pushForNotice(db, notice("canal"));
    // o agente não recebe o aviso de canal (é do papel de configurar)
    expect(endpoints()).toEqual([ep("dono")]);
    sent.length = 0;
    t.clients[0].allow_handoff = false;
    await pushForNotice(db, notice("atendente", { ref: "conv-2" }));
    expect(endpoints()).toEqual([ep("agente"), ep("dono")]);
  });
});

describe("avisos push: a transferência", () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const S1 = "5e1d3c2a-0000-4000-8000-000000000001";
  const vivi = { type: "agency_member" as const, id: OWNER, name: "Vivi", legacy: "agência" };
  function setup() {
    const t: Record<string, MemRow[]> = {
      ...tables(),
      bots: [{ id: BOT, name: "Lia", client_name: "Loja da Ana", client_id: CLIENT, agency_id: AGENCY, lead_capture: null, human_handoff: null }],
      sectors: [{ id: S1, agency_id: AGENCY, client_id: CLIENT, name: "Financeiro", hours: null, distribution: "manual", position: 0 }],
      sector_members: [
        { sector_id: S1, member_type: "agency_member", member_id: OWNER, last_assigned_at: null },
        { sector_id: S1, member_type: "client_member", member_id: CM1, last_assigned_at: null },
      ],
      conversations: [{ id: "conv1", bot_id: BOT, channel: "widget", sector_id: null, handoff_requested_at: ago(30), takeover_at: ago(20), handled_at: null, assigned_to_type: "agency_member", assigned_to_id: OWNER, assigned_to_name: "Vivi", assigned_at: ago(20), announce_pending: false, transfer_from_name: null, snoozed_until: null, snoozed_at: null, last_contact_at: ago(21) }],
      conversation_notes: [],
    };
    t.agency_members = t.agency_members.map((m) => ({ ...m, email: `${String(m.id).slice(0, 4)}@x.com`, display_name: m.id === AGENT ? "Carlos" : "Vivi", available: true, last_seen_at: ago(1) }));
    t.client_members = t.client_members.map((m) => ({ ...m, display_name: "Carla", available: true, last_seen_at: ago(1) }));
    return t;
  }

  it("para a pessoa: só ela, na página do painel; para o setor: as pessoas dele, menos quem transferiu", async () => {
    const { transferConversation } = await import("../transfer");
    const t = setup();
    const db = await (async () => {
      const db = memoryDb(t);
      for (const [type, id, n] of [["agency_member", OWNER, "dono"], ["agency_member", AGENT, "agente"], ["client_member", CM1, "cliente-1"], ["client_member", CM2, "cliente-2"]] as const) await savePushSubscription(db, { type, id }, sub(n), "x");
      return db;
    })();
    await transferConversation(db, "conv1", vivi, { kind: "pessoa", type: "agency_member", id: AGENT }, null, new Date());
    expect(endpoints()).toEqual([ep("agente")]);
    expect(sent[0].payload).toMatchObject({ title: "Conversa transferida", body: "Vivi transferiu uma conversa do chatbot Lia (Loja da Ana) para você.", url: `/painel/bots/${BOT}/conversas/conv1` });

    sent.length = 0;
    t.conversations[0] = { ...t.conversations[0], assigned_to_id: OWNER, assigned_to_type: "agency_member", assigned_to_name: "Vivi" };
    await transferConversation(db, "conv1", vivi, { kind: "setor", id: S1 }, null, new Date(Date.now() + 1000));
    expect(endpoints()).toEqual([ep("cliente-1")]);
    expect(sent[0].payload.url).toBe(`/cliente/${CLIENT}/caixa?fila=todas&c=conv1`);
  });
});
