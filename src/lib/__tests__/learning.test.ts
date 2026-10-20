import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";

/*
 * Aprendizado (D', parte 6): a resposta da equipe na conversa vira sugestão para a pergunta sem
 * resposta daquela conversa; nada entra na base sem alguém aprovar. A IA é simulada.
 */

const ai = vi.hoisted(() => ({ text: "", calls: 0 }));
vi.mock("ai", async (orig) => ({
  ...(await orig<typeof import("ai")>()),
  generateText: vi.fn(async () => {
    ai.calls += 1;
    return { text: ai.text, totalUsage: { inputTokens: 300, outputTokens: 60 }, response: { modelId: "gpt-6-luna" } };
  }),
}));

import { learnFromTeamReply, learningPrompt, parseLearning } from "../learning";
import { listUnanswered } from "../unanswered";

const AGENCY = "aaaaaaaa-0000-4000-8000-000000000001";
const BOT = "aaaaaaaa-0000-4000-8000-0000000000b1";
const DEMO = "aaaaaaaa-0000-4000-8000-0000000000b2";
const CONV = "aaaaaaaa-0000-4000-8000-0000000000d1";
const now = Date.parse("2026-10-20T15:00:00Z");

let tables: Record<string, MemRow[]>;
let db: SupabaseClient;

beforeEach(() => {
  ai.calls = 0;
  ai.text = JSON.stringify({ entradas: [{ n: 1, pergunta: "Vocês entregam em Niterói?", resposta: "Sim, entregamos em Niterói. A taxa é R$ 15." }] });
  tables = {
    bots: [{ id: BOT, agency_id: AGENCY, is_demo: false }, { id: DEMO, agency_id: AGENCY, is_demo: true }],
    unanswered: [
      { id: "u1", bot_id: BOT, conversation_id: CONV, question: "entrega em niteroi?", resolved: false, created_at: "2026-10-20T14:00:00Z", suggestion_enc: null },
      { id: "u2", bot_id: BOT, conversation_id: CONV, question: "aceita vale refeição?", resolved: false, created_at: "2026-10-20T14:01:00Z", suggestion_enc: null },
      // de outra conversa, já respondida e velha demais: ficam de fora
      { id: "u3", bot_id: BOT, conversation_id: "outra", question: "abre domingo?", resolved: false, created_at: "2026-10-20T14:00:00Z", suggestion_enc: null },
      { id: "u4", bot_id: BOT, conversation_id: CONV, question: "tem estacionamento?", resolved: true, created_at: "2026-10-20T14:00:00Z", suggestion_enc: null },
      { id: "u5", bot_id: BOT, conversation_id: CONV, question: "faz bolo?", resolved: false, created_at: "2026-10-01T14:00:00Z", suggestion_enc: null },
    ],
    ai_usage: [],
  };
  db = memoryDb(tables);
});

describe("aprendizado", () => {
  it("a resposta da equipe vira a sugestão da pergunta que ela responde, com quem respondeu", async () => {
    const n = await learnFromTeamReply(db, { conversationId: CONV, text: "Oi, Ruan! Entregamos sim em Niterói, a taxa é R$ 15. Seu pedido 4521 sai às 19h.", author: "Carla" }, now);
    expect(n).toBe(1);
    expect(ai.calls).toBe(1);
    const u1 = tables.unanswered.find((u) => u.id === "u1")!;
    expect(JSON.parse(String(u1.suggestion_enc))).toEqual({ question: "Vocês entregam em Niterói?", answer: "Sim, entregamos em Niterói. A taxa é R$ 15." });
    expect(u1).toMatchObject({ suggested_by: "Carla", resolved: false });
    expect(tables.unanswered.find((u) => u.id === "u2")!.suggestion_enc).toBeNull();
    expect(tables.ai_usage).toHaveLength(1);
    expect(tables.ai_usage[0]).toMatchObject({ kind: "aprendizado", bot_id: BOT, conversation_id: CONV });
    // o painel mostra a sugestão junto da pergunta
    const listed = await listUnanswered(db, { botIds: [BOT], limit: 10 });
    expect(listed.find((q) => q.id === "u1")).toMatchObject({ suggestion: { question: "Vocês entregam em Niterói?" }, suggestedBy: "Carla" });
    expect(listed.find((q) => q.id === "u2")?.suggestion).toBeNull();
  });

  it("sem pergunta pendente na conversa, resposta curta ou chatbot de demo: nem chama a IA", async () => {
    expect(await learnFromTeamReply(db, { conversationId: "sem-pergunta", text: "Entregamos sim em Niterói, taxa de R$ 15.", author: "Carla" }, now)).toBe(0);
    expect(await learnFromTeamReply(db, { conversationId: CONV, text: "ok, já vejo", author: "Carla" }, now)).toBe(0);
    tables.unanswered.forEach((u) => (u.bot_id = DEMO));
    expect(await learnFromTeamReply(db, { conversationId: CONV, text: "Entregamos sim em Niterói, taxa de R$ 15.", author: "Carla" }, now)).toBe(0);
    expect(ai.calls).toBe(0);
  });

  it("a IA diz que não serve para a base (só vale para a pessoa): nada fica guardado", async () => {
    ai.text = '```json\n{"entradas": []}\n```';
    expect(await learnFromTeamReply(db, { conversationId: CONV, text: "Seu pedido 4521 já saiu para entrega, chega em 20 minutos.", author: "Carla" }, now)).toBe(0);
    expect(tables.unanswered.every((u) => u.suggestion_enc === null)).toBe(true);
  });

  it("a sugestão que já existe não é trocada por uma nova", async () => {
    await learnFromTeamReply(db, { conversationId: CONV, text: "Entregamos sim em Niterói, a taxa é R$ 15.", author: "Carla" }, now);
    ai.text = JSON.stringify({ entradas: [{ n: 1, pergunta: "Aceitam vale-refeição?", resposta: "Sim, aceitamos vale-refeição." }] });
    expect(await learnFromTeamReply(db, { conversationId: CONV, text: "Aceitamos vale-refeição na entrega, sim.", author: "Bruno" }, now)).toBe(1);
    // agora só a u2 estava pendente sem sugestão: a primeira continua a da Carla
    expect(tables.unanswered.find((u) => u.id === "u1")).toMatchObject({ suggested_by: "Carla" });
    expect(tables.unanswered.find((u) => u.id === "u2")).toMatchObject({ suggested_by: "Bruno" });
  });

  it("o pedido para a IA e a leitura da resposta", () => {
    const p = learningPrompt([{ n: 1, question: "entrega em niteroi?" }], "Entregamos sim, R$ 15.");
    expect(p).toContain("1. entrega em niteroi?");
    expect(p).toContain('"""Entregamos sim, R$ 15."""');
    expect(p).toContain("sem nome, telefone, e-mail, documento");
    const parsed = parseLearning(JSON.stringify({ entradas: [{ n: 1, pergunta: "Entregam em Niterói?", resposta: "Sim, R$ 15." }, { n: 1, pergunta: "repetida", resposta: "x" }, { n: 3, pergunta: "fora", resposta: "x" }, { n: 2, pergunta: "a", resposta: "x" }] }), 2);
    expect([...parsed.entries()]).toEqual([[1, { question: "Entregam em Niterói?", answer: "Sim, R$ 15." }]]);
    expect(parseLearning("não é json", 2).size).toBe(0);
  });
});
