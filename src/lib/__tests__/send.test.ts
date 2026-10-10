import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decideMode, type ModeFacts } from "../conversation-mode";
import { sendDecision } from "../send";

const normal: ModeFacts = {
  channel: "whatsapp",
  channelDisconnected: false,
  metaOrder: false,
  whatsappDisabled: false,
  metaPaymentIssue: false,
  boavozSuspended: false,
  humanInConversation: false,
  apiPaused: false,
  botPaused: false,
  botPauseNotify: false,
  humanOnly: null,
  coexistence: false,
};
const decide = (f: Partial<ModeFacts>, kind: Parameters<typeof sendDecision>[2]) => {
  const facts = { ...normal, ...f };
  return sendDecision(decideMode(facts), facts, kind);
};

describe("regra de estado na hora do envio", () => {
  it("normal: tudo sai", () => {
    for (const kind of ["ia", "sistema", "equipe", "modelo", "aviso_suspenso"] as const) expect(decide({}, kind)).toBeNull();
  });

  it("alguém assumiu, respondeu pelo celular ou pausou durante a resposta: a IA não sai, a equipe e o texto fixo saem", () => {
    expect(decide({ humanInConversation: true }, "ia")).toBe("equipe na conversa");
    expect(decide({ botPaused: true }, "ia")).toBe("bot pausado pelo dono");
    expect(decide({ humanOnly: "paused" }, "ia")).toMatch(/modo só humano/);
    expect(decide({ humanInConversation: true }, "equipe")).toBeNull();
    expect(decide({ humanInConversation: true }, "sistema")).toBeNull();
  });

  it("canal suspenso pela BoaVoz: só o aviso de suspensão sai", () => {
    expect(decide({ boavozSuspended: true }, "aviso_suspenso")).toBeNull();
    for (const kind of ["ia", "sistema", "equipe", "modelo"] as const) expect(decide({ boavozSuspended: true }, kind)).toBe("canal suspenso pela BoaVoz");
  });

  it("ordem da Meta e desligamento geral: nada sai, nem o aviso", () => {
    expect(decide({ metaOrder: true }, "aviso_suspenso")).toBe("ordem da Meta");
    expect(decide({ whatsappDisabled: true }, "equipe")).toBe("WhatsApp desligado para todos (BoaVoz)");
  });

  it("recusa por pagamento há menos de 1 hora: a IA espera, a equipe pode tentar (é o teste do cartão)", () => {
    expect(decide({ metaPaymentIssue: true }, "ia")).toBe("número sem pagamento na Meta");
    expect(decide({ metaPaymentIssue: true }, "equipe")).toBeNull();
    expect(decide({ metaPaymentIssue: true }, "modelo")).toBeNull();
    // pagamento e suspensão juntos: a suspensão continua valendo
    expect(decide({ metaPaymentIssue: true, boavozSuspended: true }, "equipe")).toBe("número sem pagamento na Meta");
  });
});

describe("deliver (registro do envio)", () => {
  beforeEach(() => vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16"));
  afterEach(() => vi.unstubAllEnvs());

  /** Banco falso: devolve o estado do bot/conversa/canal e guarda o que foi gravado em messages. */
  function fakeDb(state: { takeover?: boolean } = {}) {
    const writes: Array<{ op: string; row: Record<string, unknown> }> = [];
    const db = {
      from(table: string) {
        const chain = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          in: () => chain,
          or: () => chain,
          order: () => chain,
          limit: () => chain,
          neq: () => chain,
          maybeSingle: async () => ({
            data:
              table === "bots"
                ? { id: "b1", agency_id: "a1", paused_at: null, pause_notify: false }
                : table === "conversations"
                  ? { id: "c1", takeover_at: state.takeover ? "2026-10-02T10:00:00Z" : null, handled_at: null }
                  : table === "whatsapp_channels"
                    ? { disconnected_at: null, payment_issue_at: null, waba_id: "w1", coexistence: false }
                    : table === "agencies"
                      ? { plan: "agencia", trial_ends_at: null, ai_paused_at: null }
                      : null,
          }),
          then: (r: (v: { data: unknown[] }) => unknown) => r({ data: [] }),
          insert: async (row: Record<string, unknown>) => (writes.push({ op: "insert", row }), { error: null }),
          update: (row: Record<string, unknown>) => ({ eq: async () => (writes.push({ op: "update", row }), { error: null }) }),
        };
        return chain;
      },
      rpc: async () => ({ data: 0 }),
    } as unknown as SupabaseClient;
    return { db, writes };
  }

  it("sai: grava o hash do id da Meta (nunca o id em texto)", async () => {
    const { deliver } = await import("../send");
    const { db, writes } = fakeDb();
    const transport = vi.fn().mockResolvedValue("wamid.HBgN5511999998888");
    const r = await deliver(db, { botId: "b1", channel: "whatsapp", conversationId: "c1", kind: "ia", record: { update: 7 }, transport });
    expect(r).toEqual({ status: "sent", id: "wamid.HBgN5511999998888" });
    expect(writes[0].row.channel_msg_id).toBe("enviada");
    expect(String(writes[0].row.channel_msg_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(writes)).not.toContain("5511999998888");
  });

  it("alguém assumiu enquanto a IA respondia: não chama o canal e grava o motivo", async () => {
    const { deliver } = await import("../send");
    const { db, writes } = fakeDb({ takeover: true });
    const transport = vi.fn();
    const r = await deliver(db, { botId: "b1", channel: "whatsapp", conversationId: "c1", kind: "ia", record: { update: 7 }, transport });
    expect(r).toEqual({ status: "blocked", reason: "equipe na conversa" });
    expect(transport).not.toHaveBeenCalled();
    expect(writes[0].row).toEqual({ blocked_reason: "equipe na conversa" });
  });

  it("o canal recusou: grava 'não entregue' com o código e repassa o erro; equipe não grava nada", async () => {
    const { deliver } = await import("../send");
    const err = Object.assign(new Error("fora da janela"), { code: 131047 });
    const { db, writes } = fakeDb();
    await expect(deliver(db, { botId: "b1", channel: "whatsapp", conversationId: "c1", kind: "sistema", record: { insert: { role: "assistant", content: "x", author: "sistema" } }, transport: () => Promise.reject(err) })).rejects.toBe(err);
    expect(writes[0].row).toMatchObject({ role: "assistant", error_code: "131047" });
    expect(writes[0].row.failed_at).toBeTruthy();
    const team = fakeDb();
    await expect(deliver(team.db, { botId: "b1", channel: "whatsapp", conversationId: "c1", kind: "equipe", recordFailures: false, record: { insert: { role: "agent", content: "x", author: "agência" } }, transport: () => Promise.reject(err) })).rejects.toBe(err);
    expect(team.writes).toEqual([]);
  });
});
