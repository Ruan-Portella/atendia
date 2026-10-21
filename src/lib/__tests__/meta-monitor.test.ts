import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb } from "../memory-db";

const alerts = vi.hoisted(() => [] as Array<{ subject: string; lines: string[] }>);
vi.mock("../notify", async (orig) => ({
  ...(await orig<typeof import("../notify")>()),
  notifyPlatform: async (subject: string, lines: string[]) => {
    alerts.push({ subject, lines });
    return true;
  },
}));

import { ERROR_ALERT, KNOWN_WA_FIELDS, checkSubscriptions, errorAlerts, reportUnknownMeta, type SubscriptionDeps } from "../meta-monitor";

/** hit_rate_limit em memória (o aviso vai uma vez por chave). */
function withLimiter(db: SupabaseClient): SupabaseClient {
  const hits = new Map<string, number>();
  return new Proxy(db, {
    get(t, k) {
      if (k === "rpc")
        return async (_fn: string, a: { p_key: string; p_max: number }) => {
          const n = (hits.get(a.p_key) ?? 0) + 1;
          hits.set(a.p_key, n);
          return { data: n <= a.p_max, error: null };
        };
      return Reflect.get(t, k);
    },
  });
}

describe("evento da Meta que o código não conhece", () => {
  it("avisa uma vez por dia por tipo; o histórico sincronizado e os avisos de campanha são conhecidos", async () => {
    alerts.length = 0;
    expect(KNOWN_WA_FIELDS.has("history")).toBe(true);
    expect(KNOWN_WA_FIELDS.has("template_category_update")).toBe(true);
    const db = withLimiter(memoryDb({}));
    expect(await reportUnknownMeta(db, "whatsapp", ["mensagem order", "mensagem order", "campo calls"])).toBe(2);
    expect(await reportUnknownMeta(db, "whatsapp", ["mensagem order"])).toBe(0);
    expect(alerts.map((a) => a.subject)).toEqual(["Evento da Meta não reconhecido: whatsapp mensagem order", "Evento da Meta não reconhecido: whatsapp campo calls"]);
  });
});

describe("inscrição do app na conta", () => {
  it("sem o app na lista: inscreve de novo e avisa; erro ao consultar não vira aviso", async () => {
    alerts.length = 0;
    const db = memoryDb({
      whatsapp_channels: [
        { bot_id: "b1", phone_number_id: "p1", waba_id: "w1", access_token_enc: null, disconnected_at: null },
        { bot_id: "b2", phone_number_id: "p2", waba_id: "w2", access_token_enc: null, disconnected_at: null },
        { bot_id: "b3", phone_number_id: "p3", waba_id: "w3", access_token_enc: null, disconnected_at: null },
      ],
      instagram_channels: [
        { bot_id: "b4", ig_user_id: "ig1", access_token_enc: "x", disconnected_at: null },
        { bot_id: "b5", ig_user_id: "ig2", access_token_enc: "x", disconnected_at: null },
      ],
    });
    const resubscribed: string[] = [];
    const deps: SubscriptionDeps = {
      waApps: async (ch) => {
        if (ch.waba_id === "w3") throw new Error("token recusado");
        return ch.waba_id === "w1" ? ["app-boavoz"] : ["outro-app"];
      },
      waResubscribe: async (ch) => void resubscribed.push(ch.waba_id),
      igFields: async (ch) => (ch.ig_user_id === "ig1" ? ["messages", "comments"] : []),
      igResubscribe: async (ch) => void resubscribed.push(ch.ig_user_id),
    };
    const r = await checkSubscriptions(db, { appId: "app-boavoz", deps });
    expect(r.checked).toBe(4);
    expect(resubscribed).toEqual(["w2", "ig2"]);
    expect(r.fixed).toEqual(["WhatsApp p2 (chatbot b2)", "Instagram ig2 (chatbot b5)"]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].subject).toBe("Inscrição do app na Meta: 2 refeita(s), 0 com erro");
  });
});

describe("erro alto de IA ou da Meta", () => {
  it("só passa do limite com o mínimo de casos", () => {
    expect(errorAlerts({ total: 100, retried: 4 }, { sent: 100, failed: 5 })).toEqual([]);
    expect(errorAlerts({ total: 20, retried: ERROR_ALERT.minRetried - 1 }, { sent: 0, failed: 0 })).toEqual([]);
    const out = errorAlerts({ total: 100, retried: 12 }, { sent: 150, failed: 30 });
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("12 de 100");
    expect(out[1]).toContain("30 de 150");
  });
});
