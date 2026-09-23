import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCESS_LOST_EVENTS, isAccessError, isPaymentError, markDisconnected, markPaymentIssue } from "../whatsapp-access";
import { WhatsAppError, hasPaymentMethod } from "../whatsapp";

describe("isAccessError", () => {
  it("token inválido e falta de permissão contam como acesso removido", () => {
    expect(isAccessError(new WhatsAppError("Error validating access token", 190))).toBe(true);
    expect(isAccessError(new WhatsAppError("Application does not have permission", 10))).toBe(true);
    expect(isAccessError(new WhatsAppError("Permissions error", 200))).toBe(true);
  });
  it("janela de 24 h, erro sem código e erro comum não", () => {
    expect(isAccessError(new WhatsAppError("Re-engagement message", 131047))).toBe(false);
    expect(isAccessError(new WhatsAppError("sem código"))).toBe(false);
    expect(isAccessError(new Error("rede"))).toBe(false);
  });
});

describe("ACCESS_LOST_EVENTS", () => {
  it("cobre a remoção do app e da conta, e ignora eventos comuns", () => {
    expect(ACCESS_LOST_EVENTS.PARTNER_APP_UNINSTALLED).toBeTruthy();
    expect(ACCESS_LOST_EVENTS.PARTNER_REMOVED).toBeTruthy();
    expect(ACCESS_LOST_EVENTS.PARTNER_ADDED).toBeUndefined();
    expect(ACCESS_LOST_EVENTS.ACCOUNT_RECONNECTED).toBeUndefined();
  });
});

describe("markDisconnected", () => {
  function fakeDb(rows: unknown[]) {
    const calls: Record<string, unknown[]> = {};
    const chain = {
      update: (v: unknown) => ((calls.update = [v]), chain),
      eq: (...a: unknown[]) => ((calls.eq = a), chain),
      is: (...a: unknown[]) => ((calls.is = a), chain),
      select: () => Promise.resolve({ data: rows }),
    };
    const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    return { db, calls };
  }

  it("marca só quem ainda estava conectado, apaga o token e conta os números", async () => {
    const { db, calls } = fakeDb([{ bot_id: "b1", display_phone: "+55 21 9999", phone_number_id: "p1", bots: null }]);
    const n = await markDisconnected(db, { column: "waba_id", value: "w1" }, "o cliente removeu o app");
    expect(n).toBe(1);
    expect(calls.eq).toEqual(["waba_id", "w1"]);
    expect(calls.is).toEqual(["disconnected_at", null]);
    expect(calls.update?.[0]).toMatchObject({ disconnect_reason: "o cliente removeu o app", access_token_enc: null });
  });

  it("nada para marcar (já desconectado ou número desconhecido)", async () => {
    const { db } = fakeDb([]);
    expect(await markDisconnected(db, { column: "bot_id", value: "b1" }, "x")).toBe(0);
  });
});

describe("pagamento da Meta", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("131042 é recusa por pagamento; acesso removido não é", () => {
    expect(isPaymentError(new WhatsAppError("Business eligibility payment issue", 131042))).toBe(true);
    expect(isPaymentError(new WhatsAppError("token", 190))).toBe(false);
    expect(isAccessError(new WhatsAppError("Business eligibility payment issue", 131042))).toBe(false);
  });

  it("marca a recusa uma vez só (só quem ainda não estava marcado)", async () => {
    const calls: Record<string, unknown[]> = {};
    const chain = {
      update: (v: unknown) => ((calls.update = [v]), chain),
      eq: (...a: unknown[]) => ((calls.eq = a), chain),
      is: (...a: unknown[]) => ((calls.is = a), chain),
      select: () => Promise.resolve({ data: [] }),
    };
    const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await markPaymentIssue(db, { column: "phone_number_id", value: "p1" });
    expect(calls.eq).toEqual(["phone_number_id", "p1"]);
    expect(calls.is).toEqual(["payment_issue_at", null]);
    expect(calls.update?.[0]).toHaveProperty("payment_issue_at");
  });

  it("lê o cartão da conta pelo primary_funding_id", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "tok");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ primary_funding_id: "123", id: "w1" }))).mockResolvedValueOnce(new Response(JSON.stringify({ id: "w1" })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await hasPaymentMethod({ phone_number_id: "p", waba_id: "w1" })).toBe(true);
    expect(await hasPaymentMethod({ phone_number_id: "p", waba_id: "w1" })).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toContain("w1?fields=primary_funding_id");
  });
});
