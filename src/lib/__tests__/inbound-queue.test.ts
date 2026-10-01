import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { acceptInbound, processGroup, sha256, type InboundEvent } from "../inbound-queue";
import { seal } from "../secret-box";
import { isStale } from "../whatsapp-inbound";

vi.mock("../notify", () => ({ notifyPlatform: vi.fn(async () => true) }));

/** Banco de mentira: só as RPCs da fila, com as respostas em sequência. */
function fakeDb(claims: unknown[][], opts: { acceptReturns?: boolean; failedOnError?: number } = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "inbound_accept") return { data: opts.acceptReturns ?? true, error: null };
      if (fn === "inbound_claim") return { data: claims.shift() ?? [], error: null };
      if (fn === "inbound_finish") return { data: args.p_error ? (opts.failedOnError ?? 0) : 0, error: null };
      return { data: null, error: null };
    }),
  } as unknown as SupabaseClient;
  return { db, calls };
}

const row = (key: string, created: string, payload: unknown) => ({ key_hash: key, source: "whatsapp", kind: "msg", bot_id: "b1", contact_hash: "c1", created_at: created, attempts: 1, payload_enc: seal(JSON.stringify(payload)) });

describe("fila de entrada da Meta", () => {
  beforeEach(() => vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-de-teste-com-mais-de-16"));
  afterEach(() => vi.unstubAllEnvs());

  it("grava com a chave em hash e o conteúdo cifrado (o id do WhatsApp tem o telefone)", async () => {
    const { db, calls } = fakeDb([]);
    const g = await acceptInbound(db, { key: "wa:msg:wamid.5521999999999", source: "whatsapp", kind: "msg", botId: "b1", contact: "5521999999999", payload: { texto: "oi" } });
    const args = calls[0].args;
    expect(args.p_key_hash).toBe(sha256("wa:msg:wamid.5521999999999"));
    expect(JSON.stringify(args)).not.toContain("5521999999999");
    expect(JSON.stringify(args)).not.toContain("oi\"");
    expect(g).toEqual({ source: "whatsapp", bot_id: "b1", contact_hash: sha256("whatsapp:5521999999999") });
  });

  it("evento repetido (reenvio da Meta) não volta a ser processado", async () => {
    const { db } = fakeDb([], { acceptReturns: false });
    expect(await acceptInbound(db, { key: "wa:msg:x", source: "whatsapp", kind: "msg", botId: "b1", contact: "1", payload: {} })).toBeNull();
  });

  it("a rajada do contato vai junta, em ordem, e conclui; mensagem nova no meio ganha outra volta", async () => {
    const { db, calls } = fakeDb([
      [row("k2", "2026-09-30T10:00:02Z", { t: "quanto custa?" }), row("k1", "2026-09-30T10:00:01Z", { t: "oi" })],
      [row("k3", "2026-09-30T10:00:05Z", { t: "e a barba?" })],
    ]);
    const seen: string[][] = [];
    await processGroup(db, { source: "whatsapp", bot_id: "b1", contact_hash: "c1" }, async (_db, events: InboundEvent[]) => {
      seen.push(events.map((e) => (e.payload as { t: string }).t));
    });
    expect(seen).toEqual([["oi", "quanto custa?"], ["e a barba?"]]);
    expect(calls.filter((c) => c.fn === "inbound_finish").map((c) => c.args.p_keys)).toEqual([["k1", "k2"], ["k3"]]);
  });

  it("erro devolve para a fila; na 5ª falha avisa a operação", async () => {
    const { notifyPlatform } = await import("../notify");
    const { db, calls } = fakeDb([[row("k1", "2026-09-30T10:00:01Z", {})]], { failedOnError: 1 });
    await processGroup(db, { source: "whatsapp", bot_id: "b1", contact_hash: "c1" }, async () => {
      throw new Error("IA fora do ar");
    });
    const finish = calls.find((c) => c.fn === "inbound_finish")!;
    expect(finish.args).toEqual({ p_keys: ["k1"], p_error: "IA fora do ar" });
    expect(notifyPlatform).toHaveBeenCalled();
  });

  it("outro processo com o contato: não faz nada", async () => {
    const handler = vi.fn();
    const { db } = fakeDb([[]]);
    await processGroup(db, { source: "whatsapp", bot_id: "b1", contact_hash: "c1" }, handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it("evento com mais de 24 h não chama a IA", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    expect(isStale("2026-09-29T11:00:00Z", now)).toBe(true);
    expect(isStale("2026-09-30T11:00:00Z", now)).toBe(false);
  });
});
