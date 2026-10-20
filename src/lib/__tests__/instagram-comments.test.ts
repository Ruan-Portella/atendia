import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";

/*
 * Comentários dos posts (E1, parte 4a): o comentário registrado (uma vez só), a palavra-chave que
 * manda a resposta privada no direct e a pública, uma resposta privada por pessoa e post a cada 24
 * horas, o comentário da própria conta, o chatbot pausado e a falta da permissão. A Meta, a ficha
 * do contato e a gravação da mensagem são simuladas.
 */

const meta = vi.hoisted(() => ({ privateReplies: [] as Array<{ comment: string; text: string }>, publicReplies: [] as Array<{ comment: string; text: string }>, failPrivate: null as unknown, enabled: true }));
vi.mock("../instagram", async (orig) => {
  const real = await orig<typeof import("../instagram")>();
  return {
    ...real,
    commentsEnabled: () => meta.enabled,
    sendCommentPrivateReply: vi.fn(async (_ch: unknown, comment: string, text: string) => {
      if (meta.failPrivate) throw meta.failPrivate;
      meta.privateReplies.push({ comment, text });
      return { recipientId: "igsid-ana", messageId: `mid-${comment}` };
    }),
    replyToComment: vi.fn(async (_ch: unknown, comment: string, text: string) => {
      meta.publicReplies.push({ comment, text });
      return `resposta-${comment}`;
    }),
  };
});
const saved = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("../messages", () => ({ saveMessage: vi.fn(async (_db: unknown, m: Record<string, unknown>) => (saved.push(m), 1)) }));
vi.mock("../contacts", async (orig) => ({ ...(await orig<typeof import("../contacts")>()), instagramContact: vi.fn(async () => ({ id: "contato-ana" })) }));
// a IA nos comentários (parte 4b): a classificação, a resposta, a pausa e a cota
const ia = vi.hoisted(() => ({ kind: "pergunta" as string | null, reply: { publica: "Tem sim, do P ao GG 😊", privada: null as string | null } as { publica: string | null; privada: string | null } | null, blocked: null as string | null, quotaBlocked: false, classified: 0, quotaCalls: 0 }));
vi.mock("../comment-ai", async (orig) => ({
  ...(await orig<typeof import("../comment-ai")>()),
  classifyComment: vi.fn(async () => (ia.classified++, ia.kind)),
  writeCommentReply: vi.fn(async () => ia.reply),
}));
vi.mock("../chat", async (orig) => ({ ...(await orig<typeof import("../chat")>()), aiBlockedReason: vi.fn(async () => ia.blocked) }));
vi.mock("../atendimentos", () => ({ openAtendimento: vi.fn(async () => (ia.quotaCalls++, { blocked: ia.quotaBlocked ? "quota_exceeded" : null, isNew: true, id: "at1", overage: false })) }));

import { InstagramError } from "../instagram";
import { commentAction, handleInstagramComment, listComments } from "../instagram-comments";
import { setCipherIdentityForTests, setScopeResolver } from "../field-cipher";

const AGENCY = "aaaaaaaa-0000-4000-8000-000000000001";
const BOT = "aaaaaaaa-0000-4000-8000-0000000000b1";
const ch = { bot_id: BOT, ig_user_id: "1784", access_token_enc: "selado" };

let tables: Record<string, MemRow[]>;
let db: SupabaseClient;

beforeEach(() => {
  vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16");
  setCipherIdentityForTests(true);
  setScopeResolver({ bot: async () => ({ clientId: null }), conversation: async () => ({ clientId: null }) });
  Object.assign(meta, { privateReplies: [], publicReplies: [], failPrivate: null, enabled: true });
  saved.length = 0;
  tables = {
    bots: [{ id: BOT, agency_id: AGENCY, status: "live", paused_at: null }],
    instagram_keywords: [{ id: "k1", bot_id: BOT, words: ["eu quero"], dm_reply: null, comment_reply: "Oi! Qual tamanho você quer?", comment_public: "Te chamei no direct 😊", media_ids: ["18100"], active: true, created_at: "2026-10-20T10:00:00Z" }],
    instagram_comments: [],
    conversations: [],
  };
  db = memoryDb(tables);
});

const comment = (id: string, text: string, from = "ig-ana", media = "18100") => ({ id, text, from: { id: from, username: "ana.silva" }, media: { id: media } });

describe("a palavra-chave no comentário", () => {
  it("manda a resposta privada no direct e a pública, e registra tudo", async () => {
    expect(await handleInstagramComment(db, ch, comment("c1", "Eu quero o azul!"))).toBe("privada_publica");
    expect(meta.privateReplies).toEqual([{ comment: "c1", text: "Oi! Qual tamanho você quer?" }]);
    expect(meta.publicReplies).toEqual([{ comment: "c1", text: "Te chamei no direct 😊" }]);
    const row = tables.instagram_comments[0];
    expect(row).toMatchObject({ comment_id: "c1", media_id: "18100", username: "ana.silva", action: "privada_publica", reason: "palavra-chave “eu quero”", public_reply_id: "resposta-c1", contact_id: "contato-ana", error: null });
    expect(row.replied_at).toBeTruthy();
    // a resposta privada abre a conversa do direct da pessoa, com o comentário de onde veio
    expect(saved).toEqual([expect.objectContaining({ role: "assistant", content: "Oi! Qual tamanho você quer?", channel_msg_id: "mid-c1", channel_ref: { kind: "comment", id: "c1", title: "Eu quero o azul!", media_id: "18100" } })]);
    expect(tables.conversations).toEqual([expect.objectContaining({ bot_id: BOT, channel: "instagram", ig_id: "igsid-ana", contact_id: "contato-ana" })]);
    // a lista do painel abre o texto e as respostas
    const [item] = await listComments(db, BOT);
    expect(item).toMatchObject({ username: "ana.silva", text: "Eu quero o azul!", privateReply: "Oi! Qual tamanho você quer?", publicReply: "Te chamei no direct 😊", action: "privada_publica" });
  });

  it("a mesma pessoa no mesmo post em 24 horas: uma resposta privada só", async () => {
    await handleInstagramComment(db, ch, comment("c1", "eu quero"));
    expect(await handleInstagramComment(db, ch, comment("c2", "EU QUERO!!"))).toBe("publica");
    expect(meta.privateReplies).toHaveLength(1);
    expect(String(tables.instagram_comments[1].reason)).toContain("já recebeu a resposta privada deste post");
    // outra pessoa recebe a dela
    expect(await handleInstagramComment(db, ch, comment("c3", "eu quero", "ig-bia"))).toBe("privada_publica");
  });

  it("fora dos posts escolhidos, ou sem palavra-chave: só registra", async () => {
    expect(await handleInstagramComment(db, ch, comment("c1", "eu quero", "ig-ana", "18999"))).toBe("nenhuma");
    expect(await handleInstagramComment(db, ch, comment("c2", "que lindo!"))).toBe("nenhuma");
    expect(meta.privateReplies).toEqual([]);
    expect(tables.instagram_comments.map((c) => c.action)).toEqual(["nenhuma", "nenhuma"]);
  });
});

describe("o que não é respondido", () => {
  it("comentário da própria conta, reentrega e comentários desligados", async () => {
    expect(await handleInstagramComment(db, ch, comment("c1", "eu quero", "1784"))).toBeNull();
    await handleInstagramComment(db, ch, comment("c2", "eu quero"));
    expect(await handleInstagramComment(db, ch, comment("c2", "eu quero"))).toBeNull();
    expect(meta.privateReplies).toHaveLength(1);
    meta.enabled = false;
    expect(await handleInstagramComment(db, ch, comment("c3", "eu quero", "ig-bia"))).toBeNull();
    expect(tables.instagram_comments).toHaveLength(1);
  });

  it("chatbot pausado: registra sem responder; fora do ar: nem registra", async () => {
    tables.bots[0].paused_at = "2026-10-20T09:00:00Z";
    expect(await handleInstagramComment(db, ch, comment("c1", "eu quero"))).toBe("ignorado");
    tables.bots[0].status = "draft";
    expect(await handleInstagramComment(db, ch, comment("c2", "eu quero"))).toBeNull();
    expect(meta.privateReplies).toEqual([]);
  });

  it("sem a permissão dos comentários: o erro fica no comentário, com o que fazer", async () => {
    meta.failPrivate = new InstagramError("(#10) Application does not have permission for this action", 10);
    expect(await handleInstagramComment(db, ch, comment("c1", "eu quero"))).toBe("publica");
    expect(String(tables.instagram_comments[0].error)).toContain("conecte o Instagram de novo");
  });
});

describe("a IA nos comentários (parte 4b)", () => {
  beforeEach(() => {
    Object.assign(ia, { kind: "pergunta", reply: { publica: "Tem sim, do P ao GG 😊", privada: null }, blocked: null, quotaBlocked: false, classified: 0, quotaCalls: 0 });
    Object.assign(tables.bots[0], { size: "P", quota_override: null, client_name: "Loja da Ana", ig_comments_ai: "todos", ig_comments_ai_media_ids: null });
  });

  it("pergunta: a resposta pública, contando como resposta do atendimento", async () => {
    expect(await handleInstagramComment(db, ch, comment("c1", "tem no M?"))).toBe("publica");
    expect(meta.publicReplies).toEqual([{ comment: "c1", text: "Tem sim, do P ao GG 😊" }]);
    expect(meta.privateReplies).toEqual([]);
    expect(tables.instagram_comments[0]).toMatchObject({ action: "publica", reason: "IA: pergunta" });
    expect(ia.quotaCalls).toBe(1);
  });

  it("pede conversa: a resposta privada no direct e a pública", async () => {
    Object.assign(ia, { kind: "pede_conversa", reply: { publica: "Te chamei no direct! 😊", privada: "Oi! Qual tamanho você usa?" } });
    expect(await handleInstagramComment(db, ch, comment("c1", "quero comprar"))).toBe("privada_publica");
    expect(meta.privateReplies).toEqual([{ comment: "c1", text: "Oi! Qual tamanho você usa?" }]);
  });

  it("ofensa e spam: sem resposta e sem gastar a cota", async () => {
    ia.kind = "ofensa";
    expect(await handleInstagramComment(db, ch, comment("c1", "loja horrível"))).toBe("nenhuma");
    expect(tables.instagram_comments[0].reason).toBe("IA: ofensa (sem resposta)");
    expect(ia.quotaCalls).toBe(0);
    expect(meta.publicReplies).toEqual([]);
  });

  it("a palavra-chave vem antes da IA; post fora dos escolhidos fica sem resposta", async () => {
    expect(await handleInstagramComment(db, ch, comment("c1", "eu quero"))).toBe("privada_publica");
    expect(ia.classified).toBe(0);
    Object.assign(tables.bots[0], { ig_comments_ai: "escolhidos", ig_comments_ai_media_ids: ["18200"] });
    expect(await handleInstagramComment(db, ch, comment("c2", "tem no M?", "ig-bia", "18999"))).toBe("nenhuma");
    expect(ia.classified).toBe(0);
  });

  it("nem chama a IA: item restrito no comentário, IA pausada, chatbot sem IA ou sem cota", async () => {
    expect(await handleInstagramComment(db, ch, comment("c1", "vocês têm cerveja?"))).toBe("ignorado");
    expect(String(tables.instagram_comments[0].reason)).toContain("item que não pode ser oferecido");
    ia.blocked = "past_due";
    expect(await handleInstagramComment(db, ch, comment("c2", "tem no M?", "ig-bia"))).toBe("ignorado");
    ia.blocked = null;
    tables.bots[0].size = "atendimento";
    expect(await handleInstagramComment(db, ch, comment("c3", "tem no M?", "ig-caio"))).toBe("ignorado");
    expect(ia.classified).toBe(0);
    tables.bots[0].size = "P";
    ia.quotaBlocked = true;
    expect(await handleInstagramComment(db, ch, comment("c4", "tem no M?", "ig-dani"))).toBe("ignorado");
    expect(String(tables.instagram_comments[3].reason)).toContain("sem atendimentos neste mês");
    expect(meta.publicReplies).toEqual([]);
  });

  it("a resposta que não passou no portão não sai", async () => {
    ia.reply = { publica: null, privada: null };
    expect(await handleInstagramComment(db, ch, comment("c1", "tem no M?"))).toBe("erro");
    expect(String(tables.instagram_comments[0].reason)).toContain("conferência do portão");
  });
});

describe("a ação registrada", () => {
  it("pelo que saiu", () => {
    expect(commentAction({ privateSent: true, publicSent: false, failed: false })).toBe("privada");
    expect(commentAction({ privateSent: false, publicSent: false, failed: true })).toBe("erro");
    expect(commentAction({ privateSent: false, publicSent: false, failed: false })).toBe("nenhuma");
  });
});
