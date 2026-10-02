import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit, sanitize } from "../audit";
import { accessDay, logAccess, logWidgetAccess, validIp } from "../access-log";
import { securityTxt } from "../security-contact";

describe("auditoria", () => {
  it("segredos ficam só pelo nome, URLs sem a query, texto longo cortado", () => {
    const out = sanitize({ access_token_enc: "abc", webhook_secret: "s", api_key: null, url: "https://x.com/a?token=1#h", nome: "Bar", nested: { senha: "1", ok: 2 } }) as Record<string, unknown>;
    expect(out.access_token_enc).toBe("[segredo]");
    expect(out.webhook_secret).toBe("[segredo]");
    expect(out.api_key).toBeNull();
    expect(out.url).toBe("https://x.com/a");
    expect(out.nome).toBe("Bar");
    expect(out.nested).toEqual({ senha: "[segredo]", ok: 2 });
    expect(String(sanitize("x".repeat(600))).length).toBe(501);
  });

  it("grava o hash do IP (nunca o IP) e não derruba a ação se o banco falhar", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    await audit({ from: () => ({ insert }) } as unknown as SupabaseClient, { agencyId: "a1", actorType: "user", actorId: "u1", action: "bot.pausar", ip: "200.1.2.3", after: { token: "x" } });
    const row = insert.mock.calls[0][0];
    expect(row.ip_hash).toBeTruthy();
    expect(row.ip_hash).not.toContain("200.1.2.3");
    expect(row.after).toEqual({ token: "[segredo]" });
    const broken = { from: () => ({ insert: () => Promise.reject(new Error("fora do ar")) }) } as unknown as SupabaseClient;
    await expect(audit(broken, { agencyId: null, actorType: "system", actorId: null, action: "x" })).resolves.toBeUndefined();
  });
});

describe("registro de acesso (Marco Civil)", () => {
  it("só IP de verdade vai para a coluna inet", () => {
    expect(validIp("200.1.2.3")).toBe("200.1.2.3");
    expect(validIp("2804:14c:1::1")).toBe("2804:14c:1::1");
    expect(validIp("999.1.2.3")).toBeNull();
    expect(validIp("unknown")).toBeNull();
    expect(validIp(null)).toBeNull();
  });

  it("o dia é o de Brasília (23h de Brasília ainda é o mesmo dia)", () => {
    expect(accessDay(new Date("2026-10-03T01:30:00Z"))).toBe("2026-10-02");
    expect(accessDay(new Date("2026-10-03T03:30:00Z"))).toBe("2026-10-03");
  });

  it("sessão: uma linha por pessoa, IP e dia (upsert que ignora a repetida); entrada e saída: insert", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const db = { from: () => ({ upsert, insert }) } as unknown as SupabaseClient;
    await logAccess(db, { actorType: "support", actorId: "u1", event: "session", ip: "200.1.2.3", userAgent: "ua", agencyId: null });
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: "actor_type,actor_id,ip,day", ignoreDuplicates: true });
    expect(upsert.mock.calls[0][0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await logAccess(db, { actorType: "support", actorId: "u1", event: "logout", ip: "200.1.2.3", userAgent: "ua", agencyId: null });
    expect(insert.mock.calls[0][0]).toMatchObject({ event: "logout", day: null, ip: "200.1.2.3" });
  });

  it("chat do site: grava quando a conversa começa e quando o IP muda, nunca a cada mensagem", async () => {
    let last: string | null = "200.1.2.3";
    const insert = vi.fn().mockResolvedValue({ error: null });
    const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, maybeSingle: async () => ({ data: last ? { ip: last } : null }), insert };
    const db = { from: () => chain } as unknown as SupabaseClient;
    await logWidgetAccess(db, { botId: "b", conversationId: "c", ip: "200.1.2.3", isNew: false });
    expect(insert).not.toHaveBeenCalled();
    await logWidgetAccess(db, { botId: "b", conversationId: "c", ip: "200.9.9.9", isNew: false });
    expect(insert).toHaveBeenCalledTimes(1);
    last = null;
    await logWidgetAccess(db, { botId: "b", conversationId: "d", ip: "200.1.2.3", isNew: true });
    expect(insert).toHaveBeenCalledTimes(2);
    await logWidgetAccess(db, { botId: "b", conversationId: "d", ip: "lixo", isNew: true });
    expect(insert).toHaveBeenCalledTimes(2);
  });
});

describe("canal de vulnerabilidades", () => {
  it("security.txt tem contato, política e validade de 1 ano", () => {
    const txt = securityTxt(new Date("2026-10-02T00:00:00Z"));
    expect(txt).toMatch(/^Contact: mailto:\S+@\S+/m);
    expect(txt).toMatch(/^Policy: .*\/seguranca$/m);
    expect(txt).toContain("Expires: 2027-10-02T00:00:00.000Z");
  });
});
