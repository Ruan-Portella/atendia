import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";
import { commentKeyword, directKeywordReply, keywordConflict, matchesComment, matchesDirect, parseKeywordInput, promisesDirect } from "../instagram-keywords";

/*
 * Palavras-chave do Instagram (E1, parte 3b): o formulário (palavras normalizadas, item restrito,
 * os campos dos comentários só com eles ligados), quando a palavra vale no direct e no comentário,
 * a palavra repetida (em outra palavra-chave ou num roteiro) e a resposta pronta.
 */

const BOT = "aaaaaaaa-0000-4000-8000-0000000000b1";
let tables: Record<string, MemRow[]>;
let db: SupabaseClient;

beforeEach(() => {
  tables = {
    instagram_keywords: [
      { id: "k1", bot_id: BOT, words: ["preco", "valor"], dm_reply: "A tabela de preços: https://loja.com/precos", comment_reply: "Te mandei a tabela no direct!", comment_public: null, media_ids: null, active: true, created_at: "2026-10-20T10:00:00Z" },
      { id: "k2", bot_id: BOT, words: ["eu quero"], dm_reply: null, comment_reply: "Oi! Qual tamanho você quer?", comment_public: "Te chamei no direct 😊", media_ids: ["18100"], active: true, created_at: "2026-10-20T10:01:00Z" },
      { id: "k3", bot_id: BOT, words: ["cupom"], dm_reply: "CUPOM10", comment_reply: null, comment_public: null, media_ids: null, active: false, created_at: "2026-10-20T10:02:00Z" },
    ],
    routines: [{ id: "r1", bot_id: BOT, name: "Orçamento", keywords: ["orcamento"] }],
  };
  db = memoryDb(tables);
});

describe("o formulário", () => {
  it("palavras sem acento e minúsculas, sem repetir; a resposta pronta do direct", () => {
    expect(parseKeywordInput({ words: "PREÇO, Eu Quero!, preço", dm_reply: " Oi! " }, { comments: false })).toEqual({ words: ["preco", "eu quero"], dm_reply: "Oi!", comment_reply: null, comment_public: null, media_ids: null });
  });

  it("limites, resposta obrigatória e item restrito", () => {
    expect(parseKeywordInput({ words: "", dm_reply: "x" }, { comments: false })).toMatchObject({ error: expect.stringContaining("pelo menos uma palavra") });
    expect(parseKeywordInput({ words: "a, b, c, d, e, f", dm_reply: "x" }, { comments: false })).toEqual({ error: "Até 5 palavras por linha." });
    expect(parseKeywordInput({ words: "preco" }, { comments: false })).toEqual({ error: "Escreva a resposta pronta do direct." });
    expect(parseKeywordInput({ words: "gelada", dm_reply: "Temos cerveja gelada por R$ 8" }, { comments: false })).toMatchObject({ error: expect.stringContaining("não pode ser oferecido pelo Instagram (cerveja)") });
  });

  it("com os comentários desligados, os campos deles ficam como estavam", () => {
    const keep = { comment_reply: "Te chamei no direct", comment_public: null, media_ids: ["18100"] };
    expect(parseKeywordInput({ words: "eu quero", dm_reply: "", comment_reply: "outra coisa" }, { comments: false, keep })).toEqual({ words: ["eu quero"], dm_reply: null, ...keep });
  });

  it("com os comentários ligados: a resposta privada, a pública e os posts escolhidos", () => {
    expect(parseKeywordInput({ words: "eu quero", comment_reply: "Oi!", comment_public: "Te chamei!", posts: "escolhidos", media_ids: ["18100", "x", "18100"] }, { comments: true })).toEqual({ words: ["eu quero"], dm_reply: null, comment_reply: "Oi!", comment_public: "Te chamei!", media_ids: ["18100"] });
    expect(parseKeywordInput({ words: "eu quero", comment_reply: "Oi!", posts: "escolhidos", media_ids: [] }, { comments: true })).toMatchObject({ error: expect.stringContaining("Escolha pelo menos um post") });
    expect(parseKeywordInput({ words: "eu quero", comment_reply: "Oi!", posts: "todos", media_ids: ["18100"] }, { comments: true })).toMatchObject({ media_ids: null });
  });

  it("a resposta pública que diz que chamou no direct só salva com a mensagem para quem comentou (teste de 20/10)", () => {
    // a mensagem foi parar na resposta do direct: o comentário receberia só o "te chamei"
    expect(parseKeywordInput({ words: "eu quero", dm_reply: "Oi! Qual tamanho você quer?", comment_public: "Te chamei no direct 😊", posts: "todos" }, { comments: true })).toMatchObject({ error: expect.stringContaining("a mensagem no direct de quem comentou está vazia") });
    expect(parseKeywordInput({ words: "eu quero", comment_reply: "Oi! Qual tamanho você quer?", comment_public: "Te chamei no direct 😊", posts: "todos" }, { comments: true })).toMatchObject({ dm_reply: null, comment_reply: "Oi! Qual tamanho você quer?", comment_public: "Te chamei no direct 😊" });
    // convidar para o direct, sem dizer que chamou, vale sem a mensagem
    expect(parseKeywordInput({ words: "eu quero", comment_public: "Chama no direct que a gente te ajuda!", posts: "todos" }, { comments: true })).toMatchObject({ comment_public: "Chama no direct que a gente te ajuda!" });
  });

  it("o que conta como dizer que chamou a pessoa no direct", () => {
    for (const t of ["Te chamei no direct 😊", "Te chamei!", "Enviei no seu DM", "Olha o direct 😉", "Te mandei uma mensagem", "Respondemos no inbox", "Te chamo no privado"]) expect(promisesDirect(t), t).toBe(true);
    for (const t of ["Chama no direct que te ajudo", "Obrigada! 😍", "Me chama no pv", "Responde no direct", "Lindo, né?"]) expect(promisesDirect(t), t).toBe(false);
  });
});

describe("quando a palavra vale", () => {
  it("no direct, só a mensagem que é a palavra (com pontuação, acento ou maiúscula)", () => {
    expect(matchesDirect(["preco"], "PREÇO!!")).toBe(true);
    expect(matchesDirect(["eu quero"], "eu quero 😍")).toBe(true);
    expect(matchesDirect(["preco"], "qual o preço do vestido?")).toBe(false);
    expect(matchesDirect(["preco"], "")).toBe(false);
  });

  it("no comentário, em qualquer lugar do texto, como palavra inteira", () => {
    expect(matchesComment(["eu quero"], "Eu quero o azul!!")).toBe(true);
    expect(matchesComment(["eu quero"], "quero")).toBe(false);
    expect(matchesComment(["preco"], "que precoso")).toBe(false);
  });
});

describe("no banco", () => {
  it("palavra repetida em outra palavra-chave ou num roteiro", async () => {
    expect(await keywordConflict(db, BOT, ["valor"], null)).toBe("A palavra “valor” já está em outra palavra-chave.");
    expect(await keywordConflict(db, BOT, ["valor"], "k1")).toBeNull();
    expect(await keywordConflict(db, BOT, ["orcamento"], null)).toContain("já começa o roteiro “Orçamento”");
  });

  it("a resposta pronta do direct: só da palavra ligada e com resposta de direct", async () => {
    expect(await directKeywordReply(db, BOT, "Valor?")).toBe("A tabela de preços: https://loja.com/precos");
    expect(await directKeywordReply(db, BOT, "eu quero")).toBeNull();
    expect(await directKeywordReply(db, BOT, "cupom")).toBeNull();
  });

  it("no comentário: a palavra do post escolhido ou de todos os posts", async () => {
    expect((await commentKeyword(db, BOT, "eu quero!", "18100"))?.id).toBe("k2");
    expect(await commentKeyword(db, BOT, "eu quero!", "18999")).toBeNull();
    expect((await commentKeyword(db, BOT, "qual o preço?", "18999"))?.id).toBe("k1");
  });
});
