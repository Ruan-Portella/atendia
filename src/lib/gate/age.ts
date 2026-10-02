import type { SupabaseClient } from "@supabase/supabase-js";
import { contactHash, type SuppressionChannel } from "../suppression";

/*
 * Confirmação de 18+ (barreira de idade da Meta para mensagens; não é verificação legal de
 * idade, que cabe ao checkout do negócio). Vale para as próximas conversas daquele bot.
 */

export type AgeStatus = "sim" | "nao" | null;

/** Depois do "Não", o bot só pergunta de novo passados 60 dias (e só se o contato pedir). */
export const AGE_NO_REASK_DAYS = 60;
/** Pergunta ignorada: no máximo uma vez a cada 24 h por iniciativa do bot. */
export const AGE_IGNORED_HOURS = 24;

/** Ids dos botões (WhatsApp) e das respostas rápidas (Instagram). */
export const AGE_YES = "age_yes";
export const AGE_NO = "age_no";
/** Botão "Ver opções 18+" (resposta refeita sem os itens 18+): leva à pergunta de idade. */
export const AGE_SHOW = "age_show";

interface Who {
  botId: string;
  channel: SuppressionChannel;
  contact: string;
}

/** Idade do contato neste bot. "nao" com mais de 60 dias volta a ser "não confirmada". */
export async function getAge(db: SupabaseClient, w: Who, now = Date.now()): Promise<AgeStatus> {
  const { data } = await db.from("contact_ages").select("status, decided_at").eq("bot_id", w.botId).eq("contact_hash", contactHash(w.channel, w.contact)).maybeSingle();
  if (!data) return null;
  if (data.status === "nao" && now - new Date(data.decided_at as string).getTime() > AGE_NO_REASK_DAYS * 86_400_000) return null;
  return data.status as AgeStatus;
}

export async function setAge(db: SupabaseClient, w: Who, status: "sim" | "nao", source: "chat" | "empresa" | "equipe" = "chat") {
  const hash = contactHash(w.channel, w.contact);
  // o "Não" sempre vence: um "Sim" não sobrescreve um "Não" recente
  if (status === "sim") {
    const current = await getAge(db, w);
    if (current === "nao") return;
  }
  const { error } = await db.from("contact_ages").upsert({ bot_id: w.botId, contact_hash: hash, status, source, decided_at: new Date().toISOString() }, { onConflict: "bot_id,contact_hash" });
  if (error) throw new Error(`idade: ${error.message}`);
}

/** O que está gravado (para o painel), sem a regra dos 60 dias. */
export async function ageRecord(db: SupabaseClient, w: Who): Promise<{ status: "sim" | "nao"; decidedAt: string; source: string } | null> {
  const { data } = await db.from("contact_ages").select("status, decided_at, source").eq("bot_id", w.botId).eq("contact_hash", contactHash(w.channel, w.contact)).maybeSingle();
  return data ? { status: data.status as "sim" | "nao", decidedAt: data.decided_at as string, source: data.source as string } : null;
}

/** Qualquer pessoa da equipe pode zerar pela conversa (o contato volta a ser perguntado). */
export async function resetAge(db: SupabaseClient, w: Who) {
  await db.from("contact_ages").delete().eq("bot_id", w.botId).eq("contact_hash", contactHash(w.channel, w.contact));
}

/** Estado para o prompt (parte dinâmica, depois do bloco em cache). */
export function ageNote(status: AgeStatus): string {
  if (status === "sim") return "A pessoa confirmou ter 18 anos ou mais: pode falar de bebida alcoólica e remédio isento de prescrição que estejam no CONTEXTO (preço, opções), sem fechar a venda aqui.";
  if (status === "nao") return "A pessoa disse que NÃO tem 18 anos: não fale de bebida alcoólica nem de remédio, nem cite, nem dê preço, nem registre pergunta ou diga que vai confirmar com a equipe sobre eles; ofereça o resto do cardápio ou dos serviços.";
  return "A idade da pessoa não foi confirmada: se ela pedir ou se você for mostrar bebida alcoólica ou remédio, não cite os itens nem preços: chame pedir_confirmacao_18 e não escreva mais nada.";
}
