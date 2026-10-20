import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * IA nos comentários (E1, parte 4b): onde a IA responde, a limpeza das respostas (sem link, @ nem
 * hashtag em público), a conferência do portão (frase com item restrito derruba a resposta) e as
 * duas chamadas (a classificação e a resposta com a base). O modelo e a busca são simulados.
 */

const fake = vi.hoisted(() => ({ outputs: [] as unknown[], prompts: [] as string[], fail: false }));
vi.mock("ai", async (orig) => ({
  ...(await orig<typeof import("ai")>()),
  generateText: vi.fn(async (o: { prompt?: string }) => {
    if (fake.fail) throw new Error("tempo esgotado");
    fake.prompts.push(o.prompt ?? "");
    return { output: fake.outputs.shift(), totalUsage: { inputTokens: 200, outputTokens: 30 }, response: { modelId: "gpt-6-luna" } };
  }),
}));
vi.mock("../chat", async (orig) => ({
  ...(await orig<typeof import("../chat")>()),
  retrieveContext: vi.fn(async () => ({ context: "[1] Vestidos\nVestido midi floral: tamanhos P ao GG, R$ 129,90.", used: [], hits: [{ content: "Vestido midi floral: tamanhos P ao GG, R$ 129,90.", metadata: { title: "Vestidos" }, similarity: 0.8 }], embeddingUsage: null })),
}));

import { classifyComment, cleanPrivateReply, cleanPublicReply, commentAiOn, gateSafe, writeCommentReply } from "../comment-ai";
import type { BotRow } from "../chat";

const bot = { id: "b1", agency_id: "a1", name: "Lia", client_name: "Loja da Ana", client_site: null, public_key: "k", is_demo: false, status: "live", persona: { tone: "leve" }, appearance: {}, lead_capture: {} } as unknown as BotRow;
const db = {} as SupabaseClient;

beforeEach(() => {
  fake.outputs = [];
  fake.prompts = [];
  fake.fail = false;
});

describe("onde a IA responde", () => {
  it("desligada, em todos os posts ou só nos escolhidos", () => {
    expect(commentAiOn({ ig_comments_ai: "off" }, "18100")).toBe(false);
    expect(commentAiOn({ ig_comments_ai: "todos" }, null)).toBe(true);
    expect(commentAiOn({ ig_comments_ai: "escolhidos", ig_comments_ai_media_ids: ["18100"] }, "18100")).toBe(true);
    expect(commentAiOn({ ig_comments_ai: "escolhidos", ig_comments_ai_media_ids: ["18100"] }, "18999")).toBe(false);
  });
});

describe("as respostas", () => {
  it("em público: sem link, @, hashtag nem marcação, numa linha", () => {
    expect(cleanPublicReply("Temos sim @ana, veja no site https://loja.com/v #promo **corre**\n\naproveite")).toBe("Temos sim, veja no site corre aproveite");
    expect(cleanPublicReply("x".repeat(400)).length).toBeLessThanOrEqual(300);
    expect(cleanPublicReply(undefined)).toBe("");
  });

  it("no direct: texto simples", () => {
    expect(cleanPrivateReply("Oi! O **vestido** azul tem do P ao GG.")).toBe("Oi! O vestido azul tem do P ao GG.");
  });

  it("frase com item proibido ou 18+ derruba a resposta inteira", () => {
    expect(gateSafe("Temos cerveja gelada por R$ 8! Corre.")).toBeNull();
    expect(gateSafe("Obrigada! 💛")).toBe("Obrigada! 💛");
    expect(gateSafe("")).toBeNull();
  });
});

describe("as chamadas", () => {
  it("a classificação, com a legenda do post; falha vira null", async () => {
    fake.outputs = [{ tipo: "pergunta" }];
    expect(await classifyComment("tem no M?", { companyName: "Loja da Ana", caption: "Vestido midi floral" })).toBe("pergunta");
    expect(fake.prompts[0]).toContain("Legenda do post: Vestido midi floral");
    fake.fail = true;
    expect(await classifyComment("tem no M?", { companyName: "Loja da Ana" })).toBeNull();
  });

  it("a resposta com a base e o post: só a pública na pergunta", async () => {
    fake.outputs = [{ publica: "Tem sim! O vestido vai do P ao GG 😊 https://loja.com", privada: "não devia sair" }];
    const r = await writeCommentReply(db, bot, { kind: "pergunta", comment: "tem no M?", post: { caption: "Vestido midi floral", postedAt: "2026-10-12T15:00:00.000Z", photos: ["Vestido azul."], permalink: null } });
    expect(r).toEqual({ publica: "Tem sim! O vestido vai do P ao GG 😊", privada: null });
    const prompt = fake.prompts[0];
    expect(prompt).toContain("POST DO COMENTÁRIO (de 12/10/2026)");
    expect(prompt).toContain("Vestido midi floral: tamanhos P ao GG");
    // o post traz a regra do preço de post
    expect(prompt).toContain("REGRA DOS POSTS");
  });

  it("pede conversa: a privada no direct e a pública curta; a que não passa no portão não sai", async () => {
    fake.outputs = [{ publica: "Te chamei no direct! 😊", privada: "Oi! Vi seu comentário no vestido. Qual tamanho você usa?" }];
    expect(await writeCommentReply(db, bot, { kind: "pede_conversa", comment: "quero comprar", post: null })).toEqual({ publica: "Te chamei no direct! 😊", privada: "Oi! Vi seu comentário no vestido. Qual tamanho você usa?" });
    fake.outputs = [{ publica: "Te chamei no direct!", privada: "Temos cerveja gelada também, por R$ 8." }];
    expect(await writeCommentReply(db, bot, { kind: "pede_conversa", comment: "quero comprar", post: null })).toEqual({ publica: "Te chamei no direct!", privada: null });
  });
});
