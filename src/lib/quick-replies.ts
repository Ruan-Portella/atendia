import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Respostas prontas (Caixa de entrada, parte 4): textos do negócio que a equipe põe na resposta com
 * um clique, valendo para todos os chatbots do cliente. {nome} vira o primeiro nome do contato
 * (some, se não tem) e {atendente}, o nome de quem responde. A pessoa ainda revisa antes de enviar.
 */

export const QUICK_REPLY_MAX = 50;
export const QUICK_REPLY_TITLE_MAX = 60;
export const QUICK_REPLY_BODY_MAX = 2000;

export interface QuickReply {
  id: string;
  title: string;
  body: string;
}

/** O que está errado no título ou no texto, ou null. Pura. */
export function quickReplyProblem(title: string, body: string): string | null {
  if (!title.trim()) return "Dê um título (é o que aparece na lista da conversa).";
  if (title.trim().length > QUICK_REPLY_TITLE_MAX) return `Título muito longo (até ${QUICK_REPLY_TITLE_MAX} caracteres).`;
  if (!body.trim()) return "Escreva o texto da resposta.";
  if (body.trim().length > QUICK_REPLY_BODY_MAX) return `Texto muito longo (até ${QUICK_REPLY_BODY_MAX.toLocaleString("pt-BR")} caracteres).`;
  return null;
}

/** O texto com {nome} e {atendente} trocados; sem nome, "{nome}" sai com a vírgula ou o espaço antes. Pura. */
export function renderQuickReply(body: string, o: { contact?: string | null; attendant: string }): string {
  const first = o.contact?.trim().split(/\s+/)[0] ?? "";
  // sem nome: "Olá, {nome}!" vira "Olá!" e "{nome}, tudo bem?" vira "Tudo bem?"
  const named = first
    ? body.replaceAll("{nome}", first)
    : body
        .replace(/^[ \t]*\{nome\},?[ \t]*(\S)/gm, (_m, c: string) => c.toUpperCase())
        .replace(/,?[ \t]*\{nome\}/g, "");
  return named.replaceAll("{atendente}", o.attendant);
}

export async function listQuickReplies(db: SupabaseClient, clientId: string | null | undefined): Promise<QuickReply[]> {
  if (!clientId) return [];
  const { data } = await db.from("quick_replies").select("id, title, body").eq("client_id", clientId).order("position").order("title").limit(QUICK_REPLY_MAX);
  return (data ?? []) as QuickReply[];
}

/** Cria ou edita (sem repetir título no cliente). */
export async function saveQuickReply(db: SupabaseClient, o: { clientId: string; id: string | null; title: string; body: string }): Promise<{ id: string } | { error: string }> {
  const problem = quickReplyProblem(o.title, o.body);
  if (problem) return { error: problem };
  const title = o.title.trim();
  const { data: same } = await db.from("quick_replies").select("id, title").eq("client_id", o.clientId).limit(QUICK_REPLY_MAX + 1);
  const rows = (same ?? []) as Array<{ id: string; title: string }>;
  if (rows.some((r) => r.id !== o.id && r.title.trim().toLowerCase() === title.toLowerCase())) return { error: "Já existe uma resposta pronta com esse título." };
  const row = { title, body: o.body.trim(), updated_at: new Date().toISOString() };
  if (o.id) {
    const { data, error } = await db.from("quick_replies").update(row).eq("id", o.id).eq("client_id", o.clientId).select("id");
    if (error || !data?.length) return { error: "Não foi possível salvar. Tente de novo." };
    return { id: o.id };
  }
  if (rows.length >= QUICK_REPLY_MAX) return { error: `Dá para ter até ${QUICK_REPLY_MAX} respostas prontas por cliente.` };
  const { data, error } = await db.from("quick_replies").insert({ ...row, client_id: o.clientId, position: rows.length }).select("id");
  if (error || !data?.length) return { error: "Não foi possível criar. Tente de novo." };
  return { id: data[0].id as string };
}

export async function deleteQuickReply(db: SupabaseClient, o: { clientId: string; id: string }): Promise<boolean> {
  const { error } = await db.from("quick_replies").delete().eq("id", o.id).eq("client_id", o.clientId);
  return !error;
}
