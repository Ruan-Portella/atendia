import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ERASE_NO, ERASE_YES, ERASURE_TEXTS, handleErasureRequest, isErasureRequest, typedAnswer } from "../data-subject";

vi.mock("../notify", () => ({ notifyAgencyOwner: vi.fn(async () => true) }));
vi.mock("../audit", () => ({ audit: vi.fn(async () => undefined) }));

describe("pedido de exclusão no chat", () => {
  it("reconhece o pedido", () => {
    for (const t of [
      "apaga meus dados",
      "Quero que vocês apaguem meus dados, por favor",
      "por favor excluam minhas informações",
      "deletar meu cadastro",
      "quero meus dados apagados",
      "Quero a exclusão dos meus dados (LGPD)",
      "LGPD: exclusão",
      "remove meu número",
      "esqueçam meus dados",
      "direito ao esquecimento",
      "limpa meu histórico",
    ])
      expect(isErasureRequest(t), t).toBe(true);
  });

  it("não confunde com outras coisas", () => {
    for (const t of [
      "não apague meus dados",
      "esqueci meus dados de acesso",
      "como excluo minha conta no app?",
      "quero apagar o pedido",
      "apaga a mensagem anterior",
      "meus dados estão corretos?",
      "quero atualizar meus dados",
      "qual o status do meu pedido?",
      "",
      null,
    ])
      expect(isErasureRequest(t), String(t)).toBe(false);
  });

  it("resposta digitada à pergunta", () => {
    expect(typedAnswer("Sim")).toBe("sim");
    expect(typedAnswer("sim, pode apagar")).toBe("sim");
    expect(typedAnswer("NÃO")).toBe("nao");
    expect(typedAnswer("melhor não")).toBe("nao");
    expect(typedAnswer("quanto custa a pizza?")).toBeNull();
  });
});

/** Banco em memória: conversas (pergunta em aberto) e pedidos. */
function fakeDb() {
  const tables: Record<string, Array<Record<string, unknown>>> = { conversations: [{ id: "c1", erasure_asked_at: null }], data_subject_requests: [] };
  const db = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      let op: "select" | "insert" | "update" = "select";
      let payload: Record<string, unknown> | null = null;
      let single = false;
      const b = {
        select: () => b,
        insert: (p: Record<string, unknown>) => ((op = "insert"), (payload = p), b),
        update: (p: Record<string, unknown>) => ((op = "update"), (payload = p), b),
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
        limit: () => b,
        single: () => ((single = true), b),
        maybeSingle: () => ((single = true), b),
        then(ok: (v: unknown) => unknown) {
          if (op === "insert") {
            const row = { id: `r${rows.length + 1}`, status: "aguardando", ...payload };
            rows.push(row);
            return Promise.resolve({ data: row, error: null }).then(ok);
          }
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (op === "update") hit.forEach((r) => Object.assign(r, payload));
          return Promise.resolve({ data: single ? (hit[0] ?? null) : hit, error: null }).then(ok);
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, tables };
}

describe("conversa de confirmação", () => {
  const bot = { id: "b1", agency_id: "a1", client_id: "cl1", client_name: "Clínica Sorriso", name: "Assistente" };

  function io(db: SupabaseClient, channel: "whatsapp" | "widget" = "whatsapp") {
    const replies: Array<{ text: string; buttons?: Array<{ id: string; title: string }> }> = [];
    const stored: number[] = [];
    return {
      replies,
      stored,
      io: { db, bot, channel, contactId: channel === "widget" ? null : "ct1", currentConversation: "c1", conversation: async () => "c1", store: async (i: number) => void stored.push(i), reply: async (_c: string | null, text: string, buttons?: Array<{ id: string; title: string }>) => void replies.push({ text, buttons }) },
    };
  }

  it("pergunta com botões e registra no Sim", async () => {
    const { db, tables } = fakeDb();
    const a = io(db);
    expect([...(await handleErasureRequest(a.io, [{ text: "apaga meus dados", buttonId: null }]))]).toEqual([0]);
    expect(a.replies[0].text).toBe(ERASURE_TEXTS.ask("Clínica Sorriso", false));
    expect(a.replies[0].buttons?.map((b) => b.id)).toEqual([ERASE_YES, ERASE_NO]);
    expect(tables.conversations[0].erasure_asked_at).toBeTruthy();
    await handleErasureRequest(a.io, [{ text: null, buttonId: ERASE_YES }]);
    expect(tables.data_subject_requests).toHaveLength(1);
    expect(tables.data_subject_requests[0]).toMatchObject({ bot_id: "b1", contact_id: "ct1", channel: "whatsapp", origin: "chat", agency_id: "a1", client_id: "cl1" });
    expect(a.replies[1].text).toMatch(/^Pedido registrado\. A Clínica Sorriso vai apagar seus dados deste atendimento até .+, e você recebe a confirmação por aqui\.$/);
    expect(tables.conversations[0].erasure_asked_at).toBeNull();
    // pedir de novo: já está registrado, não duplica
    await handleErasureRequest(a.io, [{ text: "apaga meus dados", buttonId: null }]);
    expect(a.replies[2].text).toMatch(/^Seu pedido de exclusão já está registrado/);
    expect(tables.data_subject_requests).toHaveLength(1);
  });

  it("no site: SIM digitado confirma; NÃO cancela; outra mensagem segue para a IA", async () => {
    const { db, tables } = fakeDb();
    const a = io(db, "widget");
    await handleErasureRequest(a.io, [{ text: "quero que apaguem meus dados", buttonId: null }]);
    expect(a.replies[0].text).toMatch(/Responda SIM para confirmar ou NÃO para cancelar\.$/);
    expect(a.replies[0].buttons).toBeUndefined();
    expect((await handleErasureRequest(a.io, [{ text: "quanto custa a limpeza?", buttonId: null }])).size).toBe(0);
    await handleErasureRequest(a.io, [{ text: "não", buttonId: null }]);
    expect(a.replies[1].text).toBe(ERASURE_TEXTS.cancelled);
    expect(tables.data_subject_requests).toHaveLength(0);
    await handleErasureRequest(a.io, [{ text: "apaga meus dados", buttonId: null }]);
    await handleErasureRequest(a.io, [{ text: "sim", buttonId: null }]);
    expect(tables.data_subject_requests[0]).toMatchObject({ contact_id: null, conversation_id: "c1", channel: "widget" });
    expect(a.replies.at(-1)!.text).toMatch(/até .+\.$/);
    expect(a.replies.at(-1)!.text).not.toMatch(/confirmação por aqui/);
  });

  it("sim digitado sem pergunta em aberto não faz nada", async () => {
    const { db, tables } = fakeDb();
    const a = io(db);
    expect((await handleErasureRequest(a.io, [{ text: "sim", buttonId: null }])).size).toBe(0);
    expect(tables.data_subject_requests).toHaveLength(0);
  });
});
