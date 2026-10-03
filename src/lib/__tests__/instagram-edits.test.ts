import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DELETED_LABEL, handleInstagramDelete, handleInstagramEdit, igMessageKey, sharedRef, sharedText } from "../instagram-edits";
import { sha256 } from "../inbound-queue";
import { igMediaLabel } from "../instagram-inbound";
import { mediaPermalink } from "../instagram";

describe("post e reel compartilhados", () => {
  it("reconhece post e reel (formatos novos e antigos) com id, link e legenda", () => {
    expect(sharedRef({ message: { mid: "m1", attachments: [{ type: "ig_post", payload: { id: "p1", url: "https://x/p1", title: "Pizza de calabresa R$ 45" } }] } })).toEqual({ kind: "post", id: "p1", url: "https://x/p1", title: "Pizza de calabresa R$ 45" });
    expect(sharedRef({ message: { mid: "m1", attachments: [{ type: "ig_reel", payload: { reel_video_id: "v1", url: "https://x/v1", title: "" } }] } })).toEqual({ kind: "reel", id: "v1", url: "https://x/v1", title: null });
    expect(sharedRef({ message: { mid: "m1", attachments: [{ type: "share", payload: { url: "https://x" } }] } })?.kind).toBe("post");
    expect(sharedRef({ message: { mid: "m1", attachments: [{ type: "image", payload: { url: "https://x" } }] } })).toBeNull();
    // story encaminhado: só a imagem, sem legenda
    expect(sharedRef({ message: { mid: "m1", attachments: [{ type: "ig_story", payload: { url: "https://x/s" } }] } })).toMatchObject({ kind: "story", url: "https://x/s", title: null });
    expect(sharedText({ kind: "story", id: null, url: null, title: null })).toBe("📎 Story compartilhado do Instagram (o assistente não vê a imagem)");
  });

  it("o assistente lê a legenda (cortada); sem legenda, diz que não tem", () => {
    expect(sharedText({ kind: "post", id: null, url: null, title: "Promo de terça" })).toBe('📎 Post compartilhado do Instagram: "Promo de terça"');
    expect(sharedText({ kind: "reel", id: null, url: null, title: null })).toBe("📎 Reel compartilhado do Instagram (sem legenda)");
    expect(sharedText({ kind: "post", id: null, url: null, title: "x".repeat(800) }).length).toBeLessThan(560);
  });

  it("a chave da mensagem é a mesma que a fila grava", () => {
    expect(igMessageKey("m1")).toBe(sha256("ig:msg:m1"));
  });
});

/** Banco falso: messages + deletion_log, com os filtros usados. */
function fakeDb(messages: Array<Record<string, unknown>>) {
  const log: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      if (table === "deletion_log") return { insert: async (rows: Array<Record<string, unknown>>) => (log.push(...rows), { error: null }) };
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      let patch: Record<string, unknown> | null = null;
      const rows = () => messages.filter((r) => filters.every((f) => f(r)));
      const chain = {
        select: () => chain,
        update: (v: Record<string, unknown>) => ((patch = v), chain),
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), chain),
        is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), chain),
        in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(String(r[k]))), chain),
        order: () => chain,
        limit: () => chain,
        then: (resolve: (x: { data: unknown[]; error: null }) => unknown) => {
          const hit = rows();
          if (patch) for (const r of hit) Object.assign(r, patch);
          return resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, log };
}

describe("mensagem editada e desfeita", () => {
  it("edição: atualiza o conteúdo e marca como editada", async () => {
    const msgs = [{ id: 7, inbound_key: igMessageKey("m1"), content: "quero 2 pizzas", deleted_at: null }];
    const { db } = fakeDb(msgs);
    expect(await handleInstagramEdit(db, { message_edit: { mid: "m1", text: "quero 3 pizzas", num_edit: 1 } })).toBe(true);
    expect(msgs[0].content).toBe("quero 3 pizzas");
    expect((msgs[0] as Record<string, unknown>).edited_at).toBeTruthy();
  });

  it("desfeita: vira lápide (sem conteúdo) e entra no registro de exclusões", async () => {
    const msgs = [{ id: 7, inbound_key: igMessageKey("m1"), content: "meu cpf é 123", deleted_at: null }];
    const { db, log } = fakeDb(msgs);
    expect(await handleInstagramDelete(db, { message: { mid: "m1", is_deleted: true } })).toBe("apagada");
    expect(msgs[0].content).toBe(DELETED_LABEL);
    expect(msgs[0].deleted_at).toBeTruthy();
    expect(log).toEqual([expect.objectContaining({ table_name: "message_content", row_id: "7" })]);
  });

  it("desfeita antes de chegar: fica a marca para ela já chegar apagada", async () => {
    const { db, log } = fakeDb([]);
    expect(await handleInstagramDelete(db, { message: { mid: "m9", is_deleted: true } })).toBe("marcada");
    expect(log).toEqual([expect.objectContaining({ table_name: "inbound_key", row_id: igMessageKey("m9") })]);
  });

  it("evento sem texto ou sem id: não mexe em nada", async () => {
    const { db } = fakeDb([]);
    expect(await handleInstagramEdit(db, { message_edit: { mid: "m1" } })).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("anexos do Instagram", () => {
  it("tipo que não conhecemos aparece com o nome (para sabermos o que a Meta mandou)", () => {
    expect(igMediaLabel({ message: { attachments: [{ type: "image" }] } })).toBe("📷 (foto)");
    expect(igMediaLabel({ message: { attachments: [{ type: "ig_post" }] } })).toBe("(publicação compartilhada)");
    expect(igMediaLabel({ message: { attachments: [{ type: "ig_story" }] } })).toBe("(story compartilhado)");
    expect(igMediaLabel({ message: { attachments: [{ type: "ig_xyz" }] } })).toBe("(anexo do Instagram: ig_xyz)");
    expect(igMediaLabel({ message: {} })).toBe("(mensagem sem texto)");
  });

  it("link do post: só para id numérico (sem chamar a Meta à toa)", async () => {
    expect(await mediaPermalink({ ig_user_id: "1", access_token_enc: null }, "abc")).toBeNull();
  });
});
