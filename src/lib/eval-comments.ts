import type { SupabaseClient } from "@supabase/supabase-js";
import { costUsd, type UsageTokens } from "./ai-usage";
import type { BotRow } from "./chat";
import { ANSWERED_KINDS, classifyComment, writeCommentReply } from "./comment-ai";
import type { EvalRun } from "./eval";
import { restrictedTerm } from "./instagram-direct";

/*
 * Avaliação da IA nos comentários (E1, parte 5): cada rodada faz o caminho do canal sem gravar nem
 * mandar nada: o item restrito que nem chega à IA, a classificação e, nos tipos que recebem
 * resposta, a resposta com a base e o post (já limpa e conferida pelo portão). O texto da rodada
 * junta a resposta pública e a do direct; as ferramentas dizem o tipo lido ("comentario:pergunta")
 * e o que saiu ("publico", "direct").
 */

export interface CommentCaseFields {
  comentario: string;
  /** Legenda do post do comentário (opcional). */
  legenda?: string;
  /** Data do post (ISO), para a regra do preço de post; padrão 12/10/2026. */
  data_post?: string;
}

const DEFAULT_POST_DATE = "2026-10-12T15:00:00.000Z";

export async function evaluateCommentCase(db: SupabaseClient, bot: BotRow, c: CommentCaseFields, o: { runs: number; onUsage?: (u: UsageTokens) => void }): Promise<{ runs: EvalRun[]; context: string }> {
  let context = "";
  const runs: EvalRun[] = [];
  for (let i = 0; i < o.runs; i++) {
    const usage: UsageTokens[] = [];
    const onUsage = (u: UsageTokens) => {
      usage.push(u);
      o.onUsage?.(u);
    };
    const totals = () => {
      const priced = usage.map(costUsd);
      return {
        inputTokens: usage.reduce((a, u) => a + (u.inputTokens ?? 0), 0),
        outputTokens: usage.reduce((a, u) => a + (u.outputTokens ?? 0), 0),
        costUsd: priced.some((x) => x === null) ? null : priced.reduce((a: number, x) => a + (x ?? 0), 0),
      };
    };
    if (restrictedTerm(c.comentario)) {
      runs.push({ verdict: "barrou", text: "", tools: ["comentario:restrito"], inputTokens: 0, outputTokens: 0, costUsd: 0 });
      continue;
    }
    const kind = await classifyComment(c.comentario, { companyName: bot.client_name, caption: c.legenda ?? null, onUsage });
    if (!kind) {
      runs.push({ verdict: "erro", text: "a classificação falhou", tools: [], ...totals() });
      continue;
    }
    if (!ANSWERED_KINDS.has(kind)) {
      runs.push({ verdict: "respondeu", text: "", tools: [`comentario:${kind}`], ...totals() });
      continue;
    }
    const reply = await writeCommentReply(db, bot, { kind, comment: c.comentario, post: c.legenda ? { caption: c.legenda, postedAt: c.data_post ?? DEFAULT_POST_DATE, photos: [], permalink: null } : null, onUsage });
    if (!reply) {
      runs.push({ verdict: "erro", text: "a resposta falhou", tools: [`comentario:${kind}`], ...totals() });
      continue;
    }
    context ||= reply.context;
    const text = [reply.publica ? `Em público: ${reply.publica}` : null, reply.privada ? `No direct: ${reply.privada}` : null].filter(Boolean).join("\n");
    runs.push({ verdict: "respondeu", text, tools: [`comentario:${kind}`, ...(reply.publica ? ["publico"] : []), ...(reply.privada ? ["direct"] : [])], ...totals() });
  }
  return { runs, context };
}
