import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Custo de IA medido por resposta (tabela ai_usage). Só para a operação: nunca aparece para a
 * agência e nunca muda o que o bot faz. Gravar falhou? Fica no log e a resposta segue.
 */

/**
 * Preço de referência em US$ por 1 milhão de tokens (tabela pública dos provedores, conferida em
 * 14/10/2026). `cacheWrite`: do gpt-5.6 em diante, a parte da entrada gravada no cache custa
 * 1,25x a entrada comum (antes não havia cobrança por gravar).
 */
const PRICES: Record<string, { input: number; output?: number; cachedInput?: number; cacheWrite?: number }> = {
  // gpt-4o, gpt-4o-mini, gpt-4.1 e gpt-4.1-mini saem do ar em 14/01/2027 (substituto: gpt-6-luna)
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 },
  // gpt-5 em diante raciocinam: os tokens de raciocínio vêm na saída. gpt-5, gpt-5-mini e
  // gpt-5-nano saem do ar em 11/12/2026; gpt-5.4-nano e gpt-5.1 em 01/04/2027
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
  "text-embedding-3-small": { input: 0.02 },
  "text-embedding-3-large": { input: 0.13 },
  "claude-haiku-4-5": { input: 1, cachedInput: 0.1, output: 5 },
};
/**
 * Transcrição: US$ por minuto de áudio. whisper-1, gpt-4o-transcribe e gpt-4o-mini-transcribe
 * saem do ar em 26/02/2027 (substituto: gpt-transcribe). whisper-large-v3 e o turbo são da Groq
 * (US$ 0,111 e 0,04 por hora), que cobra no mínimo 10 segundos por áudio.
 */
const AUDIO_PER_MINUTE: Record<string, number> = {
  "gpt-4o-mini-transcribe": 0.003,
  "gpt-4o-transcribe": 0.006,
  "whisper-1": 0.006,
  "gpt-transcribe": 0.0045,
  "whisper-large-v3-turbo": 0.04 / 60,
  "whisper-large-v3": 0.111 / 60,
};
const AUDIO_MIN_SECONDS: Record<string, number> = { "whisper-large-v3-turbo": 10, "whisper-large-v3": 10 };

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
  /** Parte da entrada gravada no cache (gpt-5.6 em diante: 1,25x a entrada). */
  cacheWriteTokens?: number;
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
    const written = Math.min(u.cacheWriteTokens ?? 0, input - cached);
    total += ((input - cached - written) * p.input + cached * (p.cachedInput ?? p.input) + written * (p.cacheWrite ?? p.input) + (u.outputTokens ?? 0) * (p.output ?? 0)) / 1e6;
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
    const billed = Math.max(u.audioSeconds, priceOf(AUDIO_MIN_SECONDS, u.audioModel) ?? 0);
    total += (billed / 60) * perMin;
  }
  return Math.round(total * 1e6) / 1e6;
}

/** Uso de uma chamada (todos os passos) no formato da tabela. */
export function usageFrom(model: string | undefined, u: { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number } } | undefined): UsageTokens {
  return { model, inputTokens: u?.inputTokens ?? 0, cachedInputTokens: u?.inputTokenDetails?.cacheReadTokens ?? 0, cacheWriteTokens: u?.inputTokenDetails?.cacheWriteTokens ?? 0, outputTokens: u?.outputTokens ?? 0 };
}

/** avaliacao: o conjunto de casos do backoffice (custo da plataforma, fora da margem da agência). */
/** foto: leitura de uma foto do contato pelo modelo de visão (leva de leitura de fotos). */
export type AiUsageKind = "resposta" | "leitura" | "transcricao" | "classificacao" | "avaliacao" | "analise" | "foto";

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
