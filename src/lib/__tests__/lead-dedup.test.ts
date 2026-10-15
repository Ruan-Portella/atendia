import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Um lead por contato em cada chatbot (15/10): o mesmo contato atualiza o lead que já existe, com
 * o pedido novo no histórico, em vez de criar outro.
 */

const events: Array<{ kind: string; text: string | null }> = [];
vi.mock("../message-events", () => ({
  queueLeadEvent: async (_db: unknown, _lead: unknown, o: { kind: string; request?: { text: string | null } | null }) => {
    events.push({ kind: o.kind, text: o.request?.text ?? null });
  },
}));

const { MAX_LEAD_REQUESTS, mergeLead, parseLeadRequests, saveLead, leadsOfConversation, listLeads } = await import("../leads");
const { setCipherIdentityForTests, setScopeResolver } = await import("../field-cipher");

type Row = Record<string, unknown>;

/** Banco em memória com o que saveLead usa (or só nas formas "a.eq.x" e "a.cs.{x}"). */
function memoryDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = (tables[table] ??= []);
      let op: "select" | "insert" | "update" = "select";
      let payload: Row | null = null;
      const filters: Array<(r: Row) => boolean> = [];
      let orderBy: string | null = null;
      let lim = Infinity;
      let single = false;
      const b = {
        select: () => b,
        insert: (p: Row) => ((op = "insert"), (payload = p), b),
        update: (p: Row) => ((op = "update"), (payload = p), b),
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
        in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
        gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), b),
        lt: (k: string, v: string) => (filters.push((r) => String(r[k]) < v), b),
        ilike: (k: string, v: string) => (filters.push((r) => String(r[k] ?? "").toLowerCase() === v.toLowerCase()), b),
        or: (expr: string) => {
          const parts = expr.split(",").map((p) => {
            const [k, opName, ...rest] = p.split(".");
            const v = rest.join(".");
            return opName === "cs" ? (r: Row) => ((r[k] as string[] | undefined) ?? []).includes(v.slice(1, -1)) : (r: Row) => r[k] === v;
          });
          filters.push((r) => parts.some((f) => f(r)));
          return b;
        },
        order: (k: string) => ((orderBy = k), b),
        limit: (n: number) => ((lim = n), b),
        single: () => ((single = true), b),
        maybeSingle: () => ((single = true), b),
        then(ok: (v: unknown) => unknown) {
          let data: unknown;
          if (op === "insert") {
            const row = { id: randomUUID(), created_at: new Date().toISOString(), ...payload };
            rows.push(row);
            data = single ? row : [row];
          } else {
            let hit = rows.filter((r) => filters.every((f) => f(r)));
            if (orderBy) hit = [...hit].sort((x, y) => String(y[orderBy!]).localeCompare(String(x[orderBy!])));
            hit = hit.slice(0, lim);
            if (op === "update") hit.forEach((r) => Object.assign(r, payload));
            data = single ? (hit[0] ?? null) : hit;
          }
          return Promise.resolve({ data, error: null }).then(ok);
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const base = { botId: "bot", name: "Ruan", phone: "5511999990000", phoneHash: "h1", channel: "whatsapp" };

describe("um lead por contato", () => {
  beforeEach(() => {
    events.length = 0;
    setCipherIdentityForTests(true);
    setScopeResolver({ bot: async () => ({ clientId: null }), conversation: async () => ({ clientId: null }) });
  });

  it("na mesma conversa, o pedido novo entra no histórico do mesmo lead (sem outro lead nem outro aviso)", async () => {
    const tables: Record<string, Row[]> = {};
    const db = memoryDb(tables);
    const a = await saveLead(db, { ...base, conversationId: "c1", notes: "pizza calabresa" });
    const b = await saveLead(db, { ...base, conversationId: "c1", notes: "pizza de frango com catupiry" });
    expect(a).toMatchObject({ created: true, newRequest: true, newConversation: true });
    expect(b).toMatchObject({ id: a!.id, created: false, newRequest: true, newConversation: false });
    expect(tables.leads).toHaveLength(1);
    const [lead] = await listLeads(db, { botIds: ["bot"], limit: 10 });
    expect(lead.notes).toBe("pizza de frango com catupiry");
    expect(lead.requests.map((r) => r.text)).toEqual(["pizza calabresa", "pizza de frango com catupiry"]);
    expect(events).toEqual([{ kind: "created", text: null }, { kind: "updated", text: "pizza de frango com catupiry" }]);
  });

  it("o mesmo pedido de novo na mesma conversa não muda nada", async () => {
    const db = memoryDb({});
    await saveLead(db, { ...base, conversationId: "c1", notes: "pizza calabresa" });
    expect(await saveLead(db, { ...base, conversationId: "c1", notes: "pizza calabresa" })).toMatchObject({ created: false, newRequest: false, newConversation: false });
    expect(await saveLead(db, { ...base, conversationId: "c1", notes: null })).toMatchObject({ newRequest: false });
    expect(events.map((e) => e.kind)).toEqual(["created"]);
  });

  it("conversa nova do mesmo telefone: atualiza o lead, guarda as duas conversas e avisa de novo", async () => {
    const tables: Record<string, Row[]> = {};
    const db = memoryDb(tables);
    await saveLead(db, { ...base, conversationId: "c1", notes: "pizza calabresa" });
    const again = await saveLead(db, { ...base, conversationId: "c2", notes: "encomenda pra sexta" });
    expect(again).toMatchObject({ created: false, newRequest: true, newConversation: true });
    expect(tables.leads).toHaveLength(1);
    expect(tables.leads[0]).toMatchObject({ conversation_id: "c2", conversation_ids: ["c1", "c2"] });
    // a tela das duas conversas mostra o lead
    expect(await leadsOfConversation(db, "c1")).toHaveLength(1);
    expect(await leadsOfConversation(db, "c2")).toHaveLength(1);
  });

  it("acha pela ficha do contato (Instagram, sem telefone) e pelo e-mail sem diferenciar maiúsculas", async () => {
    const tables: Record<string, Row[]> = { conversations: [{ id: "ig1", contact_id: "ct1" }, { id: "ig2", contact_id: "ct1" }] };
    const db = memoryDb(tables);
    await saveLead(db, { botId: "bot", conversationId: "ig1", name: "Lia", phoneHash: null, instagram: "@lia", channel: "instagram", notes: "corte" });
    expect(await saveLead(db, { botId: "bot", conversationId: "ig2", name: "Lia", phoneHash: null, channel: "instagram", notes: "escova" })).toMatchObject({ created: false });
    await saveLead(db, { botId: "bot", conversationId: null, name: "Bia", phoneHash: null, email: "bia@x.com", channel: "widget", notes: "orçamento" });
    expect(await saveLead(db, { botId: "bot", conversationId: "w1", name: "Bia Souza", phoneHash: null, email: "BIA@x.com", channel: "widget", notes: "festa" })).toMatchObject({ created: false, newConversation: true });
    expect(tables.leads).toHaveLength(2);
    expect(tables.leads[1]).toMatchObject({ name: "Bia Souza", email: "BIA@x.com" });
  });

  it("outro contato, ou o mesmo contato em outro chatbot, vira outro lead", async () => {
    const tables: Record<string, Row[]> = {};
    const db = memoryDb(tables);
    await saveLead(db, { ...base, conversationId: "c1", notes: "x" });
    await saveLead(db, { ...base, phoneHash: "h2", phone: "5511888880000", conversationId: "c3", notes: "y" });
    await saveLead(db, { ...base, botId: "outro", conversationId: "c4", notes: "z" });
    expect(tables.leads).toHaveLength(3);
  });
});

describe("mergeLead (pura)", () => {
  const prev = { name: "Ruan", phone: "5511", email: null, instagram: null, conversationIds: ["c1"], requests: [{ at: "2026-10-01", channel: "whatsapp", conversation_id: "c1", text: "a" }] };
  const now = "2026-10-15T12:00:00Z";

  it("o dado mais recente vale e vazio não apaga", () => {
    const m = mergeLead(prev, { name: "Ruan Portella", phone: "", email: "r@x.com", conversationId: "c1", notes: null }, now);
    expect(m).toMatchObject({ name: "Ruan Portella", phone: "5511", email: "r@x.com", newRequest: false, changed: true });
  });

  it("guarda no máximo os últimos pedidos", () => {
    const many = Array.from({ length: MAX_LEAD_REQUESTS }, (_, i) => ({ at: `2026-10-${i}`, channel: "whatsapp", conversation_id: "c1", text: `p${i}` }));
    const m = mergeLead({ ...prev, requests: many }, { name: "Ruan", conversationId: "c2", notes: "novo" }, now);
    expect(m.requests).toHaveLength(MAX_LEAD_REQUESTS);
    expect(m.requests.at(-1)).toEqual({ at: now, channel: null, conversation_id: "c2", text: "novo" });
    expect(m.requests[0].text).toBe("p1");
  });

  it("lead de antes do histórico: o pedido da criação", () => {
    const first = { at: "2026-10-01", channel: "widget", conversation_id: null, text: "pizza" };
    expect(parseLeadRequests(null, first)).toEqual([first]);
    expect(parseLeadRequests("(conteúdo apagado)", first)).toEqual([first]);
  });
});
