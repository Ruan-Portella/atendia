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

/**
 * Idade do contato neste bot. "nao" dado no chat com mais de 60 dias volta a ser "não confirmada";
 * o "nao" informado pela empresa (menor de idade) fica até ela mudar.
 */
export async function getAge(db: SupabaseClient, w: Who, now = Date.now()): Promise<AgeStatus> {
  const { data } = await db.from("contact_ages").select("status, decided_at, source").eq("bot_id", w.botId).eq("contact_hash", contactHash(w.channel, w.contact)).maybeSingle();
  if (!data) return null;
  if (data.status === "nao" && data.source !== "empresa" && now - new Date(data.decided_at as string).getTime() > AGE_NO_REASK_DAYS * 86_400_000) return null;
  return data.status as AgeStatus;
}

/** Origem da idade no formato da API e das ações: chat (botão de 18+) ou company (a empresa informou). */
export async function ageSource(db: SupabaseClient, w: Who): Promise<"chat" | "company" | null> {
  const { data } = await db.from("contact_ages").select("source").eq("bot_id", w.botId).eq("contact_hash", contactHash(w.channel, w.contact)).maybeSingle();
  return data ? (data.source === "empresa" ? "company" : "chat") : null;
}

/** "Não" dado no chat que ainda vale (60 dias): vence qualquer origem. Função pura. */
export const chatNoStands = (r: { status: string; source: string; decided_at: string }, now = Date.now()) =>
  r.status === "nao" && r.source !== "empresa" && now - Date.parse(r.decided_at) <= AGE_NO_REASK_DAYS * 86_400_000;

/**
 * Idade informada pela empresa (PUT /v1/contacts/{contact}/age), com o texto de origem: vale para
 * o chat (o contato não vê o botão de 18+) e para campanhas. Um "Não" dado no chat sempre vence;
 * a empresa informar menor vale como "Não". Grava em todas as identidades do contato (telefone e
 * BSUID no WhatsApp). Devolve o que vale agora.
 */
export async function setCompanyAge(db: SupabaseClient, botId: string, who: Array<Omit<Who, "botId">>, verified: boolean, o: { origin: string; apiKeyId: string | null }, now = Date.now()): Promise<{ confirmed: boolean; source: "company" | "chat" }> {
  const hashes = [...new Set(who.map((w) => contactHash(w.channel, w.contact)))];
  if (!hashes.length) throw new Error("idade: contato sem identidade no canal");
  const { data, error: readError } = await db.from("contact_ages").select("status, source, decided_at").eq("bot_id", botId).in("contact_hash", hashes);
  if (readError) throw new Error(`idade: ${readError.message}`);
  if ((data ?? []).some((r) => chatNoStands(r as { status: string; source: string; decided_at: string }, now))) return { confirmed: false, source: "chat" };
  const decided = new Date(now).toISOString();
  const rows = hashes.map((h) => ({ bot_id: botId, contact_hash: h, status: verified ? "sim" : "nao", source: "empresa", origin: o.origin, api_key_id: o.apiKeyId, decided_at: decided }));
  const { error } = await db.from("contact_ages").upsert(rows, { onConflict: "bot_id,contact_hash" });
  if (error) throw new Error(`idade: ${error.message}`);
  return { confirmed: verified, source: "company" };
}

/**
 * Idades da planilha (leva B3): a empresa informa sim ou não por contato, com a origem. Como na
 * API, o "Não" dado no chat continua valendo. Em lotes.
 */
export async function setCompanyAgesBulk(db: SupabaseClient, botId: string, items: Array<{ contact: string; adult: boolean; origin: string }>, now = Date.now()): Promise<{ set: number; skipped: number }> {
  const byHash = new Map(items.map((i) => [contactHash("whatsapp", i.contact), i]));
  const hashes = [...byHash.keys()];
  const keepChat = new Set<string>();
  for (let i = 0; i < hashes.length; i += 300) {
    const { data, error } = await db.from("contact_ages").select("contact_hash, status, source, decided_at").eq("bot_id", botId).in("contact_hash", hashes.slice(i, i + 300));
    if (error) throw new Error(`idade: ${error.message}`);
    for (const r of data ?? []) if (chatNoStands(r as { status: string; source: string; decided_at: string }, now)) keepChat.add(r.contact_hash as string);
  }
  const decided = new Date(now).toISOString();
  const rows = hashes.filter((h) => !keepChat.has(h)).map((h) => ({ bot_id: botId, contact_hash: h, status: byHash.get(h)!.adult ? "sim" : "nao", source: "empresa", origin: byHash.get(h)!.origin, api_key_id: null, decided_at: decided }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("contact_ages").upsert(rows.slice(i, i + 500), { onConflict: "bot_id,contact_hash" });
    if (error) throw new Error(`idade: ${error.message}`);
  }
  return { set: rows.length, skipped: keepChat.size };
}

export async function setAge(db: SupabaseClient, w: Who, status: "sim" | "nao", source: "chat" | "empresa" | "equipe" = "chat") {
  const hash = contactHash(w.channel, w.contact);
  // o "Não" sempre vence: um "Sim" não sobrescreve um "Não" recente
  if (status === "sim") {
    const current = await getAge(db, w);
    if (current === "nao") return;
  }
  // a origem da empresa (texto e chave) sai quando a idade passa a vir de outro lugar
  const { error } = await db.from("contact_ages").upsert({ bot_id: w.botId, contact_hash: hash, status, source, origin: null, api_key_id: null, decided_at: new Date().toISOString() }, { onConflict: "bot_id,contact_hash" });
  if (error) throw new Error(`idade: ${error.message}`);
}

/** O que está gravado (para o painel), sem a regra dos 60 dias. */
export async function ageRecord(db: SupabaseClient, w: Who): Promise<{ status: "sim" | "nao"; decidedAt: string; source: string; origin: string | null } | null> {
  const { data } = await db.from("contact_ages").select("status, decided_at, source, origin").eq("bot_id", w.botId).eq("contact_hash", contactHash(w.channel, w.contact)).maybeSingle();
  return data ? { status: data.status as "sim" | "nao", decidedAt: data.decided_at as string, source: data.source as string, origin: (data.origin as string | null) ?? null } : null;
}

/** Qualquer pessoa da equipe pode zerar pela conversa (o contato volta a ser perguntado). */
/** Retenção: apaga a resposta de 18+ das identidades de um contato apagado (telefone, BSUID, id do Instagram). */
export async function deleteAgesOf(db: SupabaseClient, botId: string, who: Array<{ channel: SuppressionChannel; contact: string }>): Promise<void> {
  const hashes = [...new Set(who.map((w) => contactHash(w.channel, w.contact)))];
  if (hashes.length) await db.from("contact_ages").delete().eq("bot_id", botId).in("contact_hash", hashes);
}

export async function resetAge(db: SupabaseClient, w: Who) {
  await db.from("contact_ages").delete().eq("bot_id", w.botId).eq("contact_hash", contactHash(w.channel, w.contact));
}

/** Estado para o prompt (parte dinâmica, depois do bloco em cache). */
export function ageNote(status: AgeStatus): string {
  if (status === "sim") return "A pessoa confirmou ter 18 anos ou mais: pode falar de bebida alcoólica e remédio isento de prescrição que estejam no CONTEXTO (preço, opções), sem fechar a venda aqui.";
  if (status === "nao") return "A pessoa disse que NÃO tem 18 anos: não fale de bebida alcoólica nem de remédio, nem cite, nem dê preço, nem registre pergunta ou diga que vai confirmar com a equipe sobre eles; ofereça o resto do cardápio ou dos serviços.";
  return "A idade da pessoa não foi confirmada: se ela pedir ou se você for mostrar bebida alcoólica ou remédio, não cite os itens nem preços: chame pedir_confirmacao_18 e não escreva mais nada.";
}
