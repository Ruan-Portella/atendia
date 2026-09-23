import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashToken, linkState, resolveConnectLink } from "../whatsapp-connect-link";

const now = Date.UTC(2026, 8, 23, 12, 0, 0);
const iso = (days: number) => new Date(now + days * 86_400_000).toISOString();

describe("linkState", () => {
  it("aberto até vencer; vencido depois dos 7 dias", () => {
    expect(linkState({ expires_at: iso(3), used_at: null }, now)).toBe("open");
    expect(linkState({ expires_at: iso(-1), used_at: null }, now)).toBe("expired");
  });
  it("usado mostra a página de pronto por um tempo, depois vence", () => {
    expect(linkState({ expires_at: iso(3), used_at: iso(-1) }, now)).toBe("used");
    expect(linkState({ expires_at: iso(3), used_at: iso(-10) }, now)).toBe("expired");
  });
});

describe("hashToken e resolveConnectLink", () => {
  it("guarda só o hash (sempre o mesmo para o mesmo token, nunca o token)", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toContain("abc");
    expect(hashToken("abc")).toHaveLength(64);
  });
  it("token com formato inválido nem consulta o banco", async () => {
    const db = { from: vi.fn() } as unknown as SupabaseClient;
    expect(await resolveConnectLink(db, "curto")).toBeNull();
    expect(await resolveConnectLink(db, "a/../../etc/passwd-com-tamanho-grande")).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });
});
