import { describe, expect, it } from "vitest";
import { emailLinkLoginAt, isEmailLinkSession, isMemberSessionExpired } from "../member";

describe("isEmailLinkSession (só link mágico dá acesso à área do cliente)", () => {
  it("aceita sessão aberta por link mágico / código por e-mail", () => {
    expect(isEmailLinkSession([{ method: "otp", timestamp: 1 }])).toBe(true);
    expect(isEmailLinkSession(["magiclink"])).toBe(true);
    expect(isEmailLinkSession([{ method: "password", timestamp: 1 }, { method: "otp", timestamp: 2 }])).toBe(true);
    // primeiro acesso de um e-mail convidado (conta nova)
    expect(isEmailLinkSession([{ method: "email/signup", timestamp: 1 }])).toBe(true);
  });
  it("recusa senha, Google e sessão sem amr", () => {
    expect(isEmailLinkSession([{ method: "password", timestamp: 1 }])).toBe(false);
    expect(isEmailLinkSession(["oauth"])).toBe(false);
    expect(isEmailLinkSession(undefined)).toBe(false);
    expect(isEmailLinkSession([])).toBe(false);
  });
});

describe("acesso vale 7 dias a partir do link", () => {
  const now = Date.UTC(2026, 8, 22, 12);
  const daysAgo = (d: number) => Math.floor((now - d * 86_400_000) / 1000);

  it("usa a hora do link, não de outros métodos", () => {
    expect(emailLinkLoginAt([{ method: "password", timestamp: 999 }, { method: "otp", timestamp: 500 }])).toBe(500);
    expect(emailLinkLoginAt(["otp"])).toBeNull();
  });
  it("6 dias: continua logado", () => {
    expect(isMemberSessionExpired([{ method: "otp", timestamp: daysAgo(6) }], now)).toBe(false);
  });
  it("8 dias: expira", () => {
    expect(isMemberSessionExpired([{ method: "magiclink", timestamp: daysAgo(8) }], now)).toBe(true);
  });
  it("link novo reinicia o prazo (vale o mais recente)", () => {
    expect(isMemberSessionExpired([{ method: "otp", timestamp: daysAgo(30) }, { method: "otp", timestamp: daysAgo(1) }], now)).toBe(false);
  });
  it("token sem data não tranca ninguém para fora", () => {
    expect(isMemberSessionExpired(["otp"], now)).toBe(false);
  });
});
