import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLATFORM_SCOPE, UNREADABLE, openField, sealField, setCipherIdentityForTests, setScopeResolver } from "../field-cipher";
import { masterKey, setClientKeyStore, type ClientKeyStore } from "../keys";
import { seal, unseal } from "../secret-box";
import { reencryptMessages } from "../messages";

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
