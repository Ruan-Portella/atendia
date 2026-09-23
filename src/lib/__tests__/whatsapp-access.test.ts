import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCESS_LOST_EVENTS, isAccessError, markDisconnected } from "../whatsapp-access";
import { WhatsAppError } from "../whatsapp";

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
