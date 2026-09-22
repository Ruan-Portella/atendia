import type { SupabaseClient } from "@supabase/supabase-js";

/** Frase que o prompt pede quando a resposta não está na base (ver buildSystemPrompt). */
export const NO_INFO_PHRASE = "Não tenho essa informação";

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * A resposta do assistente admite que não sabe? Rede de segurança para quando o modelo
 * esquece de chamar a ferramenta registrar_pergunta_sem_resposta.
 */
export function looksUnanswered(reply: string): boolean {
  const t = strip(reply);
  return [
    /nao tenho (essa|esta|essas|estas|a|as) informac/,
    /nao tenho informac(ao|oes) (sobre|a respeito)/,
    /nao (encontrei|possuo|disponho de|tenho acesso a) (essa|esta|essas|estas|a|as|informac)/,
    /nao sei (informar|responder|dizer)/,
    /nao consigo (informar|responder|te dizer)/,
    /(essa|esta) informac(ao|oes) nao (esta|estao|consta|constam)/,
  ].some((r) => r.test(t));
}

/**
 * Registra a pergunta para a agência responder no painel, sem duplicar uma pendente igual.
 * Marca a conversa como "precisou de ajuda".
 */
export async function recordUnanswered(db: SupabaseClient, botId: string, conversationId: string, question: string): Promise<void> {
  const q = question.replace(/\s+/g, " ").trim().slice(0, 500);
  if (q.length < 3) return;
  const { data: pending } = await db.from("unanswered").select("id, question").eq("bot_id", botId).eq("resolved", false).order("created_at", { ascending: false }).limit(50);
  const already = (pending ?? []).some((p) => strip(String(p.question)).replace(/[?!.\s]+$/, "") === strip(q).replace(/[?!.\s]+$/, ""));
  if (!already) await db.from("unanswered").insert({ bot_id: botId, question: q });
  await db.from("conversations").update({ needs_human: true }).eq("id", conversationId);
}
