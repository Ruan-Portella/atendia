import { describe, expect, it } from "vitest";
import { isEmailLinkSession } from "../member";

describe("isEmailLinkSession (só link mágico dá acesso à área do cliente)", () => {
  it("aceita sessão aberta por link mágico / código por e-mail", () => {
    expect(isEmailLinkSession([{ method: "otp", timestamp: 1 }])).toBe(true);
    expect(isEmailLinkSession(["magiclink"])).toBe(true);
    expect(isEmailLinkSession([{ method: "password", timestamp: 1 }, { method: "otp", timestamp: 2 }])).toBe(true);
  });
  it("recusa senha, Google e sessão sem amr", () => {
    expect(isEmailLinkSession([{ method: "password", timestamp: 1 }])).toBe(false);
    expect(isEmailLinkSession(["oauth"])).toBe(false);
    expect(isEmailLinkSession(undefined)).toBe(false);
    expect(isEmailLinkSession([])).toBe(false);
  });
});
