import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientIp, firstExceeded, hashId, tooMany, type LimitRule } from "../rate-limit";

const rule = (key: string, max = 1): LimitRule => ({ key, max, windowSeconds: 60, message: `limite ${key}` });
const fakeDb = (rpc: (name: string, args: { p_key: string }) => Promise<{ data: unknown; error: unknown }>) => ({ rpc: vi.fn(rpc) }) as unknown as SupabaseClient;

describe("firstExceeded", () => {
  it("devolve null quando tudo está dentro do limite", async () => {
    const db = fakeDb(async () => ({ data: true, error: null }));
    expect(await firstExceeded(db, [rule("a"), rule("b")])).toBeNull();
  });

  it("devolve a regra que estourou", async () => {
    const db = fakeDb(async (_n, { p_key }) => ({ data: p_key !== "b", error: null }));
    expect((await firstExceeded(db, [rule("a"), rule("b")]))?.key).toBe("b");
  });

  it("deixa passar se o banco falhar (nunca derruba o chat)", async () => {
    const db = fakeDb(async () => ({ data: null, error: { message: "function not found" } }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await firstExceeded(db, [rule("a")])).toBeNull();
  });
});

describe("clientIp / hashId", () => {
  it("usa o primeiro IP do x-forwarded-for", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }))).toBe("1.2.3.4");
  });
  it("cai para x-real-ip e depois unknown", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "5.6.7.8" } }))).toBe("5.6.7.8");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
  it("não guarda o IP puro e é estável", () => {
    expect(hashId("1.2.3.4")).not.toContain("1.2.3.4");
    expect(hashId("1.2.3.4")).toBe(hashId("1.2.3.4"));
    expect(hashId("1.2.3.4")).not.toBe(hashId("1.2.3.5"));
  });
});

describe("tooMany", () => {
  it("responde 429 com Retry-After e a mensagem", async () => {
    const res = tooMany(rule("a"), { "X-Test": "1" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("X-Test")).toBe("1");
    expect(await res.json()).toMatchObject({ error: "rate_limited", message: "limite a" });
  });
});
