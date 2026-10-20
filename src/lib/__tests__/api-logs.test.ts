import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";

/*
 * Registros da API e envios que falharam (D', parte 7): o registro de cada chamada com chave
 * válida (sem corpo, sem query e sem o contato no caminho), a tradução dos erros dos canais e a
 * lista dos envios que falharam pela camada de mensagens.
 */

const env = vi.hoisted(() => ({ db: null as unknown as SupabaseClient }));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => env.db }));

import { newApiKey } from "../api-keys";
import { loggedPath, withApiKey } from "../api-v1";
import { failureReason } from "../send-errors";
import { failedMessages } from "../messages";

const A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("registro das chamadas à API", () => {
  it("o caminho sem /api e sem o endereço do contato", () => {
    expect(loggedPath("https://boavoz.com/api/v1/contacts/phone:5521999990000/age")).toBe("/v1/contacts/{contact}/age");
    expect(loggedPath("https://boavoz.com/api/v1/contacts/ext%3Auser_42/tags?x=1")).toBe("/v1/contacts/{contact}/tags");
    expect(loggedPath("https://boavoz.com/api/v1/bots/bot_123/sources/src_9")).toBe("/v1/bots/bot_123/sources/src_9");
  });

  it("toda resposta de uma chave válida fica registrada, com o código do erro; chave inválida não", async () => {
    const k = newApiKey();
    const tables: Record<string, MemRow[]> = {
      api_keys: [{ id: "k1", agency_id: A, name: "k1", prefix: k.prefix, key_hash: k.hash, scope_type: "all", scope_bot_ids: [], scope_client_id: null, permissions: ["messages"], last_used_at: null, revoked_at: null }],
      agency_packs: [{ agency_id: A, pack: "integracoes", ends_at: null }],
      bots: [],
      api_requests: [],
    };
    env.db = memoryDb(tables);
    const ok = withApiKey("messages", async () => Response.json({ ok: true }));
    const denied = withApiKey("contacts", async () => Response.json({ ok: true }));
    const call = (key: string, path: string) => new Request(`http://localhost/api/v1/${path}`, { headers: { host: "localhost", authorization: `Bearer ${key}` } });
    expect((await ok(call(k.key, "messages/msg_1"), { params: Promise.resolve({}) })).status).toBe(200);
    expect((await denied(call(k.key, "contacts/phone:5521999990000"), { params: Promise.resolve({}) })).status).toBe(403);
    expect((await ok(call("bv_live_naoexiste0000000000000000000000000", "messages"), { params: Promise.resolve({}) })).status).toBe(401);
    expect(tables.api_requests.map((r) => [r.method, r.path, r.status, r.error_code, r.api_key_id])).toEqual([
      ["GET", "/v1/messages/msg_1", 200, null, "k1"],
      ["GET", "/v1/contacts/{contact}", 403, "forbidden_scope", "k1"],
    ]);
    expect(typeof tables.api_requests[0].duration_ms).toBe("number");
  });
});

describe("envios que falharam", () => {
  it("o motivo em português, por canal", () => {
    expect(failureReason("131047", "whatsapp")).toContain("24 horas");
    expect(failureReason("131042", "whatsapp")).toContain("forma de pagamento");
    expect(failureReason("551", "instagram")).toContain("não está disponível");
    expect(failureReason("10/2018278", "instagram")).toContain("fora da janela");
    expect(failureReason("999999", "whatsapp")).toBe("o canal recusou e o contato não recebeu");
    expect(failureReason(null)).toBe("o canal recusou e o contato não recebeu");
  });

  it("a lista vem da função do banco, com o conteúdo aberto pela camada de mensagens", async () => {
    const calls: unknown[] = [];
    const db = {
      rpc: async (fn: string, args: unknown) => {
        calls.push([fn, args]);
        return { data: [{ id: 7, conversation_id: "c1", bot_id: "b1", created_at: "2026-10-19T12:00:00Z", role: "agent", content: "Seu pedido saiu!", author_display_name: "Carla", author: "carla@x", failed_at: "2026-10-19T12:00:01Z", error_code: "131047", blocked_reason: null }], error: null };
      },
    } as unknown as SupabaseClient;
    const rows = await failedMessages(db, { botIds: ["b1"], channel: "whatsapp", since: "2026-09-20T00:00:00Z" });
    expect(calls[0]).toEqual(["failed_messages", { p_bot_ids: ["b1"], p_channel: "whatsapp", p_since: "2026-09-20T00:00:00Z", p_limit: 50 }]);
    expect(rows).toEqual([{ id: 7, conversationId: "c1", botId: "b1", createdAt: "2026-10-19T12:00:00Z", role: "agent", content: "Seu pedido saiu!", author: "Carla", failedAt: "2026-10-19T12:00:01Z", errorCode: "131047", blockedReason: null }]);
    expect(await failedMessages(db, { botIds: [], channel: "whatsapp", since: "x" })).toEqual([]);
  });
});
