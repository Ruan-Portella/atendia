import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { splitDm } from "../instagram";
import { recipientOf, waIdVariants } from "../whatsapp";
import { contactOf } from "../whatsapp-inbound";
import { noticeOnce } from "../rate-limit";
import { aiBlockedReason } from "../chat";

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

describe("resposta longa no Instagram", () => {
  it("texto curto vai inteiro, numa DM só", () => {
    expect(splitDm("Oi! Abrimos às 9h.")).toEqual(["Oi! Abrimos às 9h."]);
  });

  it("divide no fim de um parágrafo, cada parte dentro de 1.000 bytes, sem \"…\"", () => {
    const p1 = "Primeiro parágrafo com preços e horários. ".repeat(15).trim();
    const p2 = "Segundo parágrafo sobre agendamento e endereço. ".repeat(12).trim();
    const parts = splitDm(`${p1}\n\n${p2}`);
    expect(parts).toEqual([p1, p2]);
    for (const p of parts) expect(bytes(p)).toBeLessThanOrEqual(1000);
  });

  it("no máximo 3 mensagens; só a última pode levar \"…\"", () => {
    const parts = splitDm("Uma frase bem comprida sobre o serviço. ".repeat(200));
    expect(parts).toHaveLength(3);
    expect(parts[0].endsWith("…")).toBe(false);
    expect(parts[1].endsWith("…")).toBe(false);
    expect(parts[2].endsWith("…")).toBe(true);
    for (const p of parts) expect(bytes(p)).toBeLessThanOrEqual(1000);
  });

  it("não parte emoji ao meio", () => {
    const parts = splitDm("😀".repeat(600));
    for (const p of parts) expect(p.replace("…", "")).toMatch(/^(😀)+$/u);
  });
});

describe("contato sem telefone (BSUID)", () => {
  it("usa o telefone; sem ele, o BSUID; sem nenhum, null", () => {
    expect(contactOf({ from: "5521999998888", from_user_id: "BR.abc" })).toBe("5521999998888");
    expect(contactOf({ from_user_id: "BR.abc123" })).toBe("BR.abc123");
    expect(contactOf({})).toBeNull();
  });

  it("envia telefone em `to` e BSUID em `recipient`", () => {
    expect(recipientOf("5521999998888")).toEqual({ to: "5521999998888" });
    expect(recipientOf("BR.abc123")).toEqual({ recipient: "BR.abc123" });
  });

  it("BSUID não vira variação de telefone (com e sem o 9)", () => {
    expect(waIdVariants("BR.abc123")).toEqual(["BR.abc123"]);
    expect(waIdVariants("5521999998888")).toEqual(["5521999998888", "552199998888"]);
  });
});

describe("aviso de limite", () => {
  it("avisa uma vez por janela, não a cada mensagem", async () => {
    const hits = new Map<string, number>();
    const db = {
      rpc: vi.fn(async (_fn: string, a: { p_key: string; p_max: number }) => {
        const n = (hits.get(a.p_key) ?? 0) + 1;
        hits.set(a.p_key, n);
        return { data: n <= a.p_max, error: null };
      }),
    } as unknown as SupabaseClient;
    const rule = { key: "wa:b1:5521:m", max: 15, windowSeconds: 60, message: "Espere um minutinho." };
    expect(await noticeOnce(db, rule)).toBe(true);
    expect(await noticeOnce(db, rule)).toBe(false);
    expect(await noticeOnce(db, rule)).toBe(false);
  });
});

describe("modo só humano", () => {
  /** Banco de mentira com a agência. */
  function db(agency: { plan: string; trial_ends_at?: string | null }) {
    const q = (row: unknown) => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
      return chain;
    };
    return { from: (t: string) => (t === "agencies" ? q(agency) : q(null)) } as unknown as SupabaseClient;
  }

  it("plano cancelado e teste vencido param a IA também em conversa aberta", async () => {
    expect(await aiBlockedReason(db({ plan: "cancelado" }), "a1")).toBe("cancelled");
    expect(await aiBlockedReason(db({ plan: "trial", trial_ends_at: "2020-01-01T00:00:00Z" }), "a1")).toBe("trial_expired");
  });

  it("a cota não é conferida aqui: é do atendimento, antes de chamar a IA", async () => {
    expect(await aiBlockedReason(db({ plan: "agencia" }), "a1")).toBeNull();
  });
});
