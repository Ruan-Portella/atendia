import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Custo de IA medido por resposta (tabela ai_usage). Só para a operação: nunca aparece para a
 * agência e nunca muda o que o bot faz. Gravar falhou? Fica no log e a resposta segue.
 */

/** Preço de referência em US$ por 1 milhão de tokens (tabela pública dos provedores). */
const PRICES: Record<string, { input: number; output?: number; cachedInput?: number }> = {
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 },
  // gpt-5 em diante raciocinam: os tokens de raciocínio vêm na saída (tabela de 01/10/2026)
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "text-embedding-3-small": { input: 0.02 },
  "text-embedding-3-large": { input: 0.13 },
  "claude-haiku-4-5": { input: 1, cachedInput: 0.1, output: 5 },
};
/** Transcrição: US$ por minuto de áudio. */
const AUDIO_PER_MINUTE: Record<string, number> = { "gpt-4o-mini-transcribe": 0.003, "gpt-4o-transcribe": 0.006, "whisper-1": 0.006 };

/** Preço do modelo; aceita o id com data (ex.: gpt-4o-mini-2024-07-18). */
function priceOf<T>(table: Record<string, T>, model: string | null | undefined): T | null {
  if (!model) return null;
  const key = Object.keys(table)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-2`) || model.startsWith(`${k}@`));
  return key ? table[key] : null;
}

export interface UsageTokens {
  model?: string | null;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  embeddingModel?: string | null;
  embeddingTokens?: number;
  audioModel?: string | null;
  /** null: duração desconhecida (formato que não sabemos ler): custo "sem preço", nunca zero. */
  audioSeconds?: number | null;
}

/** Custo em US$; null se alguma parte usada não tem preço conhecido. */
export function costUsd(u: UsageTokens): number | null {
  let total = 0;
  const input = u.inputTokens ?? 0;
  if (input || u.outputTokens) {
    const p = priceOf(PRICES, u.model);
    if (!p) return null;
    const cached = Math.min(u.cachedInputTokens ?? 0, input);
    total += ((input - cached) * p.input + cached * (p.cachedInput ?? p.input) + (u.outputTokens ?? 0) * (p.output ?? 0)) / 1e6;
  }
  if (u.embeddingTokens) {
    const p = priceOf(PRICES, u.embeddingModel);
    if (!p) return null;
    total += (u.embeddingTokens * p.input) / 1e6;
  }
  if (u.audioModel && u.audioSeconds === null) return null;
  if (u.audioSeconds) {
    const perMin = priceOf(AUDIO_PER_MINUTE, u.audioModel);
    if (perMin === null) return null;
    total += (u.audioSeconds / 60) * perMin;
  }
  return Math.round(total * 1e6) / 1e6;
}

/** Uso de uma chamada (todos os passos) no formato da tabela. */
export function usageFrom(model: string | undefined, u: { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number } } | undefined): UsageTokens {
  return { model, inputTokens: u?.inputTokens ?? 0, cachedInputTokens: u?.inputTokenDetails?.cacheReadTokens ?? 0, outputTokens: u?.outputTokens ?? 0 };
}

/** avaliacao: o conjunto de casos do backoffice (custo da plataforma, fora da margem da agência). */
export type AiUsageKind = "resposta" | "leitura" | "transcricao" | "classificacao" | "avaliacao";

/** Linha da tabela para uma chamada. */
function usageRow(base: { agencyId: string; botId?: string | null; conversationId?: string | null; kind: AiUsageKind; channel?: string | null }, u: UsageTokens) {
  return {
    agency_id: base.agencyId,
    bot_id: base.botId ?? null,
    conversation_id: base.conversationId ?? null,
    kind: base.kind,
    channel: base.channel ?? null,
    model: u.model ?? u.embeddingModel ?? u.audioModel ?? null,
    input_tokens: u.inputTokens ?? 0,
    cached_input_tokens: u.cachedInputTokens ?? 0,
    output_tokens: u.outputTokens ?? 0,
    embedding_tokens: u.embeddingTokens ?? 0,
    audio_seconds: u.audioSeconds ?? null,
    cost_usd: costUsd(u),
  };
}

/** Várias chamadas de uma vez (avaliação: uma linha por chamada, num insert só). */
export async function recordAiUsageMany(db: SupabaseClient, base: { agencyId: string; botId?: string | null; kind: AiUsageKind; channel?: string | null }, rows: UsageTokens[]): Promise<void> {
  if (!rows.length) return;
  try {
    const { error } = await db.from("ai_usage").insert(rows.map((u) => usageRow(base, u)));
    if (error) console.error("ai_usage: não gravou", error.message);
  } catch (e) {
    console.error("ai_usage: não gravou", e);
  }
}

export async function recordAiUsage(
  db: SupabaseClient,
  row: { agencyId?: string; botId?: string | null; conversationId?: string | null; kind: AiUsageKind; channel?: string | null } & UsageTokens,
): Promise<void> {
  try {
    let agencyId = row.agencyId;
    if (!agencyId && row.botId) agencyId = (await db.from("bots").select("agency_id").eq("id", row.botId).maybeSingle()).data?.agency_id;
    if (!agencyId) return;
    const { error } = await db.from("ai_usage").insert(usageRow({ ...row, agencyId }, row));
    if (error) console.error("ai_usage: não gravou", error.message);
  } catch (e) {
    console.error("ai_usage: não gravou", e);
  }
}
