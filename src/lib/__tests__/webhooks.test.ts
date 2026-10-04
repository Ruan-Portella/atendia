import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Webhook } from "standardwebhooks";
import type { SupabaseClient } from "@supabase/supabase-js";

const posted = vi.hoisted(() => ({ calls: [] as Array<{ url: string; body: string; headers: Record<string, string> }>, status: 200 }));
vi.mock("../safe-fetch", async (orig) => ({
  ...(await orig<typeof import("../safe-fetch")>()),
  safePost: vi.fn(async (url: string, o: { body: string; headers: Record<string, string> }) => {
    posted.calls.push({ url, body: o.body, headers: o.headers });
    return { status: posted.status, text: "", truncated: false, redirect: false };
  }),
}));

import { MAX_ATTEMPTS, base32, emitEvent, emitLinkEvent, eventId, nextAttemptAt, retryDueDeliveries, webhookCovers } from "../webhooks";
import { checkIdentityKey, unlinkInactive } from "../pairing";
import { seal } from "../secret-box";

type Row = Record<string, unknown>;

/** Banco em memória com o pedaço do PostgREST que webhooks e vínculos usam. */
function memDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let inserted: Row[] | null = null;
    let max = Infinity;
    const run = () => {
      if (inserted) {
        const dup = table === "webhook_deliveries" && inserted.some((n) => rows.some((r) => r.webhook_id === n.webhook_id && r.event_id === n.event_id));
        if (dup) return { rows: [], error: { message: "duplicate key value violates unique constraint" } };
        rows.push(...inserted);
        const out = inserted;
        inserted = null;
        return { rows: out, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, max);
      if (patch) hit.forEach((r) => Object.assign(r, patch));
      return { rows: hit, error: null };
    };
    const b = {
      select: () => b,
      order: () => b,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), b),
      lt: (k: string, v: string) => (filters.push((r) => String(r[k] ?? "") < v), b),
      lte: (k: string, v: string) => (filters.push((r) => String(r[k] ?? "") <= v), b),
      gt: (k: string, v: string) => (filters.push((r) => String(r[k] ?? "") > v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      limit: (n: number) => ((max = n), b),
      update: (p: Row) => ((patch = p), b),
      insert: (r: Row | Row[]) => ((inserted = (Array.isArray(r) ? r : [r]).map((x) => ({ id: randomUUID(), created_at: new Date().toISOString(), status: "pending", attempts: 0, next_attempt_at: new Date().toISOString(), ...x }))), b),
      maybeSingle: async () => {
        const r = run();
        return { data: r.rows[0] ?? null, error: r.error };
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const r = run();
        return Promise.resolve({ data: r.rows, error: r.error }).then(ok, ko);
      },
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const BOT = { id: "b0000000-0000-4000-8000-000000000001", agency_id: "a0000000-0000-4000-8000-000000000001", client_id: "c1000000-0000-4000-8000-000000000001", name: "Fintra" };

function setup(hook: Row = {}) {
  const tables: Record<string, Row[]> = {
    webhooks: [{ id: "w1", agency_id: BOT.agency_id, url: "https://saas.example.com/hook", secret_enc: seal(SECRET), events: ["contact.linked", "contact.unlinked"], scope_type: "all", scope_bot_ids: [], scope_client_id: null, active: true, failing_since: null, ...hook }],
    webhook_deliveries: [],
    bots: [BOT],
    contacts: [{ id: "ctc1", phone_enc: "5521999991234", wa_user_enc: "BR.abc", ig_enc: null, last_inbound_at: null }],
    contact_links: [],
  };
  return { tables, db: memDb(tables) };
}

describe("id do evento e novas tentativas", () => {
  it("base32 (RFC 4648) e id que sai do fato", () => {
    expect(base32(Buffer.from("foobar"))).toBe("mzxw6ytboi");
    expect(base32(Buffer.from("f"))).toBe("my");
    const a = eventId("contact.linked", "lnk1:linked:p1");
    expect(a).toBe(eventId("contact.linked", "lnk1:linked:p1"));
    expect(a).not.toBe(eventId("contact.linked", "lnk1:linked:p2"));
    expect(a).toMatch(/^evt_[a-z2-7]{52}$/);
  });

  it("1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h, 24 h: 9 tentativas no total", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    expect(nextAttemptAt(1, now)).toBe("2026-10-04T12:01:00.000Z");
    expect(nextAttemptAt(2, now)).toBe("2026-10-04T12:05:00.000Z");
    expect(nextAttemptAt(8, now)).toBe("2026-10-05T12:00:00.000Z");
    expect(nextAttemptAt(9, now)).toBeNull();
    expect(MAX_ATTEMPTS).toBe(9);
  });

  it("escopo do webhook", () => {
    expect(webhookCovers({ scope_type: "all", scope_bot_ids: [], scope_client_id: null }, BOT)).toBe(true);
    expect(webhookCovers({ scope_type: "bots", scope_bot_ids: ["outro"], scope_client_id: null }, BOT)).toBe(false);
    expect(webhookCovers({ scope_type: "client", scope_bot_ids: [], scope_client_id: BOT.client_id }, BOT)).toBe(true);
  });
});

describe("entrega", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-de-teste-dos-segredos-123");
    posted.calls.length = 0;
    posted.status = 200;
  });
  const fire = (db: SupabaseClient, key = "lnk1:linked:p1") => emitEvent(db, { type: "contact.linked", key, bot: BOT, createdAt: "2026-10-04T12:00:00Z", conversation: null, contact: { id: "ctc_1" }, data: { link: { id: "lnk_1" } } });

  it("envelope assinado no padrão Standard Webhooks; 2xx entrega; o mesmo fato não sai duas vezes", async () => {
    const { db, tables } = setup();
    await fire(db);
    expect(posted.calls).toHaveLength(1);
    const { body, headers } = posted.calls[0];
    const evt = new Webhook(SECRET).verify(body, headers) as { id: string; type: string };
    expect(evt).toMatchObject({ type: "contact.linked", bot: { id: `bot_${BOT.id}`, name: "Fintra" }, client: { id: `cli_${BOT.client_id}` }, data: { link: { id: "lnk_1" } } });
    expect(headers["webhook-id"]).toBe(evt.id);
    expect(tables.webhook_deliveries[0]).toMatchObject({ status: "delivered", attempts: 1, last_status: 200 });
    await fire(db);
    expect(posted.calls).toHaveLength(1);
  });

  it("falha: nova tentativa em 1 min com o mesmo id; webhook marcado como falhando", async () => {
    const { db, tables } = setup();
    posted.status = 500;
    await fire(db);
    const d = tables.webhook_deliveries[0];
    expect(d).toMatchObject({ status: "pending", attempts: 1, last_status: 500 });
    expect(Date.parse(String(d.next_attempt_at)) - Date.now()).toBeGreaterThan(50_000);
    expect(tables.webhooks[0].failing_since).toBeTruthy();
    // venceu: a nova tentativa leva o mesmo webhook-id e, entregue, limpa a falha
    d.next_attempt_at = new Date(Date.now() - 1000).toISOString();
    posted.status = 204;
    expect(await retryDueDeliveries(db)).toBe(1);
    expect(posted.calls[1].headers["webhook-id"]).toBe(posted.calls[0].headers["webhook-id"]);
    expect(tables.webhook_deliveries[0]).toMatchObject({ status: "delivered", attempts: 2 });
    expect(tables.webhooks[0].failing_since).toBeNull();
  });

  it("410 Gone ou 3 dias só de falhas desativam o webhook", async () => {
    const gone = setup();
    posted.status = 410;
    await fire(gone.db);
    expect(gone.tables.webhooks[0]).toMatchObject({ active: false, disabled_reason: "respondeu 410 Gone" });
    expect(gone.tables.webhook_deliveries[0].status).toBe("failed");
    const old = setup({ failing_since: new Date(Date.now() - 4 * 86_400_000).toISOString() });
    posted.status = 500;
    await fire(old.db);
    expect(old.tables.webhooks[0]).toMatchObject({ active: false, disabled_reason: "3 dias seguidos só de falhas" });
  });

  it("webhook de outro escopo, sem o evento ou desativado não recebe", async () => {
    for (const hook of [{ scope_type: "bots", scope_bot_ids: ["outro"] }, { events: ["contact.unlinked"] }, { active: false }]) {
      const { db } = setup(hook);
      await fire(db);
    }
    expect(posted.calls).toHaveLength(0);
  });

  it("contact.linked: o vínculo com o telefone mascarado e o contato do canal", async () => {
    const { db, tables } = setup();
    tables.contact_links.push({ id: "11111111-0000-4000-8000-000000000001", bot_id: BOT.id, contact_id: "ctc1", channel: "whatsapp", external_id_enc: "user_42", display: { name: "Ruan" }, pairing_id: "p1", linked_at: "2026-10-04T12:00:00Z", unlinked_at: null });
    await emitLinkEvent(db, "11111111-0000-4000-8000-000000000001", "linked", { conversationId: "conv1" });
    const evt = JSON.parse(posted.calls[0].body);
    expect(evt).toMatchObject({
      type: "contact.linked",
      conversation: { id: "conv_conv1", channel: "whatsapp" },
      contact: { id: "ctc_ctc1", level: "usuario", verified_by: "pairing", phone: "5521999991234", whatsapp_user_id: "BR.abc", external_id: "user_42" },
      data: { link: { id: "lnk_11111111-0000-4000-8000-000000000001", channel: "whatsapp", external_id: "user_42", phone_masked: "*********1234" } },
    });
  });
});

describe("queda do vínculo", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-de-teste-dos-segredos-123");
    posted.calls.length = 0;
    posted.status = 200;
  });
  const link = (o: Row) => ({ id: randomUUID(), bot_id: BOT.id, contact_id: "ctc1", channel: "whatsapp", external_id_hash: "h", external_id_enc: "user_42", context_hash: null, context_enc: null, display: null, linked_at: "2026-01-01T00:00:00Z", unlinked_at: null, identity_key_hash: null, ...o });

  it("identidade do WhatsApp mudou: o vínculo cai (identity_changed) e o contato é avisado uma vez", async () => {
    const { db, tables } = setup();
    tables.contact_links.push(link({ identity_key_hash: "hashA" }));
    const notify = vi.fn(async () => undefined);
    expect(await checkIdentityKey(db, "ctc1", "hashA", notify)).toBe(false);
    expect(await checkIdentityKey(db, "ctc1", "hashB", notify)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(tables.contact_links[0]).toMatchObject({ unlink_reason: "identity_changed" });
    expect(JSON.parse(posted.calls[0].body)).toMatchObject({ type: "contact.unlinked", data: { reason: "identity_changed" } });
  });

  it("vínculo sem hash guarda o primeiro que chegar", async () => {
    const { db, tables } = setup();
    tables.contact_links.push(link({}));
    await checkIdentityKey(db, "ctc1", "hashA", async () => undefined);
    expect(tables.contact_links[0]).toMatchObject({ identity_key_hash: "hashA", unlinked_at: null });
  });

  it("sem o sinal da Meta: cai depois de 180 dias sem mensagem (inactivity)", async () => {
    const { db, tables } = setup();
    const now = Date.parse("2026-10-04T12:00:00Z");
    tables.contact_links.push(link({}));
    tables.contacts[0].last_inbound_at = "2026-09-30T00:00:00Z";
    expect(await unlinkInactive(db, now)).toBe(0);
    tables.contacts[0].last_inbound_at = "2026-03-01T00:00:00Z";
    expect(await unlinkInactive(db, now)).toBe(1);
    expect(tables.contact_links[0]).toMatchObject({ unlink_reason: "inactivity" });
    // com o hash da Meta guardado, não cai por tempo
    tables.contact_links.push(link({ identity_key_hash: "hashA" }));
    expect(await unlinkInactive(db, now)).toBe(0);
  });
});
