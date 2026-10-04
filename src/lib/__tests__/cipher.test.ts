import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLATFORM_SCOPE, UNREADABLE, openField, sealField, setCipherIdentityForTests, setScopeResolver } from "../field-cipher";
import { masterKey, setClientKeyStore, type ClientKeyStore } from "../keys";
import { seal, unseal } from "../secret-box";
import { reencryptMessages } from "../messages";
import { createLead, listLeads, reencryptLeads } from "../leads";
import { listUnanswered, recordUnanswered } from "../unanswered";
import { listRefusals, recordRefusal } from "../scope-refusals";

/** Chaves dos clientes em memória (no lugar da tabela client_keys). */
function memoryStore() {
  const rows: Array<{ id: string; client_id: string; key_enc: string; at: number }> = [];
  const store: ClientKeyStore = {
    async find(clientId) {
      const r = rows.filter((x) => x.client_id === clientId).sort((a, b) => a.at - b.at)[0];
      return r ? { id: r.id, key_enc: r.key_enc } : null;
    },
    async byId(keyId) {
      const r = rows.find((x) => x.id === keyId);
      return r ? { key_enc: r.key_enc } : null;
    },
    async create(clientId, keyEnc) {
      rows.push({ id: randomUUID(), client_id: clientId, key_enc: keyEnc, at: Date.now() + rows.length });
    },
  };
  return { store, rows };
}

const CLIENT_A = "a0000000-0000-4000-8000-00000000000a";
const CLIENT_B = "b0000000-0000-4000-8000-00000000000b";

describe("cifra por campo", () => {
  let mem: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-de-teste-dos-segredos-123");
    vi.stubEnv("FIELD_MASTER_KEYS", "");
    setCipherIdentityForTests(false);
    mem = memoryStore();
    setClientKeyStore(mem.store);
  });
  afterAll(() => {
    // os outros testes seguem com a cifra transparente (test-setup.ts)
    setCipherIdentityForTests(true);
    setClientKeyStore(null);
  });

  it("chave do cliente: ida e volta, cabeçalho com o id da chave, uma chave por cliente", async () => {
    const a = await sealField("messages.content", "quanto custa a pizza?", { clientId: CLIENT_A });
    expect(a).toMatch(/^v2\.c\.[0-9a-f-]{36}\./);
    expect(a).not.toContain("pizza");
    expect(await openField("messages.content", a)).toBe("quanto custa a pizza?");
    // o mesmo texto cifra diferente a cada vez (iv aleatório)
    expect(await sealField("messages.content", "quanto custa a pizza?", { clientId: CLIENT_A })).not.toBe(a);
    await sealField("messages.content", "oi", { clientId: CLIENT_B });
    expect(mem.rows.map((r) => r.client_id).sort()).toEqual([CLIENT_A, CLIENT_B]);
    // a chave do cliente fica guardada cifrada pela chave mestra
    expect(mem.rows[0].key_enc).toMatch(/^v1\./);
  });

  it("um valor não abre em outra coluna (dado adicional autenticado)", async () => {
    const phone = await sealField("contacts.phone_enc", "5521999999999", { clientId: CLIENT_A });
    expect(await openField("contacts.phone_enc", phone)).toBe("5521999999999");
    expect(await openField("contacts.ig_enc", phone)).toBe(UNREADABLE);
  });

  it("valor antigo, sem cifra, passa igual (a recifra cuida depois)", async () => {
    expect(await openField("messages.content", "mensagem de antes da cifra")).toBe("mensagem de antes da cifra");
  });

  it("cliente excluído: a chave sai e o que ela cifrou fica ilegível", async () => {
    const v = await sealField("messages.content", "dado do contato", { clientId: CLIENT_A });
    mem.rows.length = 0;
    setClientKeyStore(mem.store); // limpa o cache de chaves, como um processo novo
    expect(await openField("messages.content", v)).toBe(UNREADABLE);
  });

  it("chatbot sem cliente (demo): chave da plataforma, com a versão no cabeçalho", async () => {
    const v = await sealField("messages.content", "olá", PLATFORM_SCOPE);
    expect(v).toMatch(/^v2\.p1\./);
    expect(await openField("messages.content", v)).toBe("olá");
  });

  it("chave mestra nova (FIELD_MASTER_KEYS): o novo sai na versão nova e o antigo continua abrindo", async () => {
    const oldSecret = seal("token-do-whatsapp");
    expect(oldSecret).toMatch(/^v1\./);
    const oldField = await sealField("messages.content", "antes da troca", PLATFORM_SCOPE);
    vi.stubEnv("FIELD_MASTER_KEYS", `2:${randomBytes(32).toString("base64")}`);
    expect(masterKey().version).toBe(2);
    const newSecret = seal("token-novo");
    expect(newSecret).toMatch(/^m2\./);
    expect(unseal(newSecret)).toBe("token-novo");
    expect(unseal(oldSecret)).toBe("token-do-whatsapp");
    expect(await sealField("messages.content", "depois", PLATFORM_SCOPE)).toMatch(/^v2\.p2\./);
    expect(await openField("messages.content", oldField)).toBe("antes da troca");
  });
});

describe("recifra do histórico", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-de-teste-dos-segredos-123");
    setCipherIdentityForTests(false);
    setClientKeyStore(memoryStore().store);
    setScopeResolver({ bot: async () => ({ clientId: CLIENT_A }), conversation: async () => ({ clientId: CLIENT_A }) });
  });
  afterAll(() => {
    setCipherIdentityForTests(true);
    setClientKeyStore(null);
    setScopeResolver({ bot: async () => ({ clientId: null }), conversation: async () => ({ clientId: null }) });
  });

  it("cifra as mensagens antigas com a chave do cliente e não mexe nas já cifradas", async () => {
    const rows: Array<Record<string, unknown>> = [
      { id: 1, conversation_id: "c1", content: "texto antigo 1" },
      { id: 2, conversation_id: "c1", content: "texto antigo 2" },
    ];
    rows.push({ id: 3, conversation_id: "c1", content: await sealField("messages.content", "já cifrada", { clientId: CLIENT_A }) });
    const plain = (r: Record<string, unknown>) => !String(r.content).startsWith("v2.");
    const db = {
      from: () => {
        const ids: number[] = [];
        let patch: Record<string, unknown> | null = null;
        const b = {
          select: () => b,
          order: () => b,
          limit: () => b,
          not: () => b,
          eq: (_k: string, v: number) => (ids.push(v), b),
          update: (p: Record<string, unknown>) => ((patch = p), b),
          then: (ok: (v: unknown) => unknown) => {
            if (patch) {
              const hit = rows.filter((r) => ids.includes(r.id as number) && plain(r));
              hit.forEach((r) => Object.assign(r, patch));
              return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok);
            }
            return Promise.resolve({ data: rows.filter(plain), error: null }).then(ok);
          },
        };
        return b;
      },
    } as unknown as SupabaseClient;
    expect(await reencryptMessages(db)).toBe(2);
    expect(rows.every((r) => String(r.content).startsWith("v2.c."))).toBe(true);
    expect(await openField("messages.content", String(rows[0].content))).toBe("texto antigo 1");
    expect(await openField("messages.content", String(rows[2].content))).toBe("já cifrada");
    expect(await reencryptMessages(db)).toBe(0);
  });
});

/** Banco em memória com o pouco que leads.ts e unanswered.ts usam. */
function memoryDb(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const rows = (tables[table] ??= []);
      let op: "select" | "insert" | "update" | "delete" = "select";
      let payload: Record<string, unknown> | null = null;
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      let lim = Infinity;
      let single = false;
      const b = {
        select: () => b,
        insert: (p: Record<string, unknown>) => ((op = "insert"), (payload = p), b),
        update: (p: Record<string, unknown>) => ((op = "update"), (payload = p), b),
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
        in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
        gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), b),
        // só a forma "a.not.is.null,b.not.is.null"
        or: (expr: string) => (filters.push((r) => expr.split(",").some((p) => r[p.split(".")[0]] != null)), b),
        order: () => b,
        limit: (n: number) => ((lim = n), b),
        single: () => ((single = true), b),
        then(ok: (v: unknown) => unknown) {
          let data: unknown;
          if (op === "insert") {
            // padrões das colunas, como no banco
            const row = { id: randomUUID(), created_at: new Date().toISOString(), ...(table === "unanswered" ? { resolved: false } : {}), ...payload };
            rows.push(row);
            data = single ? row : [row];
          } else {
            const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, lim);
            if (op === "update") hit.forEach((r) => Object.assign(r, payload));
            data = hit;
          }
          return Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : 1 }).then(ok);
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe("cifra dos leads, perguntas sem resposta e pedidos fora do assunto (parte 1b)", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-de-teste-dos-segredos-123");
    setCipherIdentityForTests(false);
    setClientKeyStore(memoryStore().store);
    setScopeResolver({ bot: async () => ({ clientId: CLIENT_A }), conversation: async () => ({ clientId: CLIENT_A }) });
  });
  afterAll(() => {
    setCipherIdentityForTests(true);
    setClientKeyStore(null);
    setScopeResolver({ bot: async () => ({ clientId: null }), conversation: async () => ({ clientId: null }) });
  });

  it("lead: telefone e interesse vão cifrados; nome e e-mail não; a lista abre", async () => {
    const tables: Record<string, Array<Record<string, unknown>>> = {};
    const db = memoryDb(tables);
    const id = await createLead(db, { botId: "bot", conversationId: "c1", name: "Ana", phone: "21 99999-1234", phoneHash: "h", email: "ana@x.com", notes: "quer orçamento de festa" });
    expect(id).toBeTruthy();
    const row = tables.leads[0];
    expect(row.phone_enc).toMatch(/^v2\.c\./);
    expect(String(row.phone_enc)).not.toContain("99999");
    expect(row.notes_enc).toMatch(/^v2\.c\./);
    expect(row.phone).toBeUndefined();
    expect(row).toMatchObject({ name: "Ana", email: "ana@x.com" });
    const [lead] = await listLeads(db, { botIds: ["bot"], limit: 10 });
    expect(lead).toMatchObject({ name: "Ana", phone: "21 99999-1234", email: "ana@x.com", notes: "quer orçamento de festa" });
  });

  it("lead de antes da cifra: a recifra move para as colunas cifradas e zera as antigas", async () => {
    const tables: Record<string, Array<Record<string, unknown>>> = {
      leads: [{ id: "l1", bot_id: "bot", conversation_id: null, name: "Bia", phone: "5521988887777", phone_enc: null, email: null, notes: "pizza", notes_enc: null, created_at: "2026-01-01" }],
    };
    const db = memoryDb(tables);
    expect((await listLeads(db, { botIds: ["bot"], limit: 10 }))[0].phone).toBe("5521988887777");
    expect(await reencryptLeads(db)).toBe(1);
    expect(tables.leads[0]).toMatchObject({ phone: null, notes: null });
    expect(tables.leads[0].phone_enc).toMatch(/^v2\.c\./);
    expect((await listLeads(db, { botIds: ["bot"], limit: 10 }))[0]).toMatchObject({ phone: "5521988887777", notes: "pizza" });
    expect(await reencryptLeads(db)).toBe(0);
  });

  it("pergunta sem resposta: cifrada, a repetida não duplica e a lista abre", async () => {
    const tables: Record<string, Array<Record<string, unknown>>> = { unanswered: [{ id: "u0", bot_id: "bot", question: "Aceita pix?", resolved: false, created_at: "2026-01-01" }] };
    const db = memoryDb(tables);
    await recordUnanswered(db, "bot", "c1", "Tem estacionamento?");
    await recordUnanswered(db, "bot", "c1", "tem ESTACIONAMENTO");
    // a antiga, sem cifra, também conta para não duplicar
    await recordUnanswered(db, "bot", "c1", "aceita pix");
    expect(tables.unanswered).toHaveLength(2);
    expect(tables.unanswered[1].question).toMatch(/^v2\.c\./);
    expect((await listUnanswered(db, { botIds: ["bot"], limit: 10 })).map((u) => u.question).sort()).toEqual(["Aceita pix?", "Tem estacionamento?"]);
  });

  it("pedido fora do assunto: cifrado e aberto na lista", async () => {
    const tables: Record<string, Array<Record<string, unknown>>> = {};
    const db = memoryDb(tables);
    await recordRefusal(db, { botId: "bot", conversationId: "c1", level: "flexivel", request: "quem ganha o jogo hoje?" });
    expect(tables.scope_refusals[0].request).toMatch(/^v2\.c\./);
    expect((await listRefusals(db, { since: "2000-01-01", limit: 10 }))[0].request).toBe("quem ganha o jogo hoje?");
  });
});
