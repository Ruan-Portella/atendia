import { after } from "next/server";
import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatModel, classifierModelId, modelCallOptions } from "./ai";
import { recordAiUsage, usageFrom } from "./ai-usage";
import { pendingWithoutSuggestion, saveSuggestion, type LearningSuggestion } from "./unanswered";

/*
 * Aprendizado (D', parte 6, 20/10/2026; spec, linha 9 dos próximos passos): quando a equipe
 * responde na conversa o que a IA não sabia, o BoaVoz propõe a entrada da base como rascunho para
 * aprovar. Toda mensagem da equipe (painel, portal, celular, app do Instagram e API) numa conversa
 * com pergunta sem resposta pendente passa por uma chamada curta de IA, que diz qual pergunta a
 * resposta responde e escreve a entrada da base sem dado da pessoa. A sugestão fica na pergunta
 * (unanswered.ts) e o painel mostra pronta para aprovar: aprovar é o "Responder" de sempre (vira
 * FAQ). Resposta que só vale para aquela pessoa (o pedido dela, o horário marcado dela) não vira
 * sugestão, e nada entra na base sem alguém aprovar.
 */

/** Pergunta registrada há mais de 7 dias não recebe sugestão (a conversa já é outra). */
export const LEARNING_WINDOW_DAYS = 7;
/** Resposta curta demais ("ok", "já vejo") não ensina nada. */
const MIN_REPLY = 12;

const SYSTEM = "Você ajuda a manter a base de conhecimento de um chatbot de atendimento. Responda só com JSON válido.";

/** O pedido para a IA: as perguntas pendentes, numeradas, e a resposta da equipe. Pura. */
export function learningPrompt(questions: Array<{ n: number; question: string }>, reply: string): string {
  return [
    "O assistente não soube responder estas perguntas de um contato:",
    ...questions.map((q) => `${q.n}. ${q.question.slice(0, 500)}`),
    "",
    "Depois, alguém da equipe da empresa escreveu ao contato:",
    `"""${reply.slice(0, 2000)}"""`,
    "",
    "Para cada pergunta que a mensagem da equipe responde com uma informação que vale para qualquer cliente (preço, horário, regra, serviço, forma de pagamento, área de entrega), escreva a entrada da base: a pergunta como um cliente qualquer faria e a resposta só com a informação da empresa, em português, sem nome, telefone, e-mail, documento, endereço, número de pedido ou qualquer dado daquela pessoa, sem saudação e sem assinatura.",
    "Não sugira nada quando a resposta só vale para aquela pessoa (o pedido, a conta, o horário marcado ou o caso dela), quando a equipe só disse que vai verificar, ou quando ela não responde a pergunta.",
    'Formato: {"entradas": [{"n": 1, "pergunta": "...", "resposta": "..."}]}; sem nenhuma: {"entradas": []}',
  ].join("\n");
}

/** O que a IA devolveu, validado: número da pergunta → sugestão. Pura. */
export function parseLearning(raw: string, count: number): Map<number, LearningSuggestion> {
  const out = new Map<number, LearningSuggestion>();
  let j: unknown;
  try {
    j = JSON.parse(raw.replace(/^\s*```(?:json)?|```\s*$/g, "").trim());
  } catch {
    return out;
  }
  const list = (j as { entradas?: unknown })?.entradas;
  if (!Array.isArray(list)) return out;
  for (const e of list) {
    const { n, pergunta, resposta } = (e ?? {}) as Record<string, unknown>;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > count || out.has(n)) continue;
    const question = typeof pergunta === "string" ? pergunta.replace(/\s+/g, " ").trim() : "";
    const answer = typeof resposta === "string" ? resposta.trim() : "";
    if (question.length < 3 || question.length > 500 || answer.length < 2 || answer.length > 3000) continue;
    out.set(n, { question, answer });
  }
  return out;
}

/**
 * A resposta da equipe vira sugestão para as perguntas sem resposta da conversa. Devolve quantas
 * ganharam sugestão. Erro da IA: nenhuma (a pergunta continua na lista, como sempre).
 */
export async function learnFromTeamReply(db: SupabaseClient, o: { conversationId: string; text: string; author: string | null }, now = Date.now()): Promise<number> {
  const reply = o.text.trim();
  if (reply.length < MIN_REPLY) return 0;
  const pending = await pendingWithoutSuggestion(db, o.conversationId, new Date(now - LEARNING_WINDOW_DAYS * 86_400_000).toISOString());
  if (!pending.length) return 0;
  const botId = pending[0].botId;
  const { data: bot } = await db.from("bots").select("agency_id, is_demo").eq("id", botId).maybeSingle();
  if (!bot || bot.is_demo) return 0;
  const questions = pending.map((p, i) => ({ ...p, n: i + 1 }));
  const modelId = classifierModelId();
  let raw: string;
  try {
    const r = await generateText({ model: chatModel(modelId), system: SYSTEM, prompt: learningPrompt(questions, reply), ...modelCallOptions(modelId, { temperature: 0 }), maxRetries: 1 });
    void recordAiUsage(db, { agencyId: bot.agency_id as string, botId, conversationId: o.conversationId, kind: "aprendizado", ...usageFrom(r.response?.modelId ?? modelId, r.totalUsage) });
    raw = r.text;
  } catch (e) {
    console.error("aprendizado: a IA não respondeu", (e as Error).message);
    return 0;
  }
  let saved = 0;
  for (const [n, suggestion] of parseLearning(raw, questions.length)) {
    const q = questions[n - 1];
    if (await saveSuggestion(db, { id: q.id, botId: q.botId, suggestion, author: o.author })) saved += 1;
  }
  return saved;
}

/** Depois da resposta ao usuário (after do Next); fora de uma requisição, roda solto. Nunca derruba quem chamou. */
export function learnLater(db: SupabaseClient, o: { conversationId: string; text: string; author: string | null }): void {
  const run = () => learnFromTeamReply(db, o).catch((e) => console.error("aprendizado:", (e as Error).message));
  try {
    after(run);
  } catch {
    void run();
  }
}
