import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type ActionResult } from "./action-result";
import { ingestSource, type SourceRow } from "./ingest";

/**
 * Base de conhecimento editável por texto: responder perguntas sem resposta e criar/editar
 * textos e FAQs. Usado pelo painel da agência e pela área do cliente (que só mexe nesses
 * dois tipos; sites e PDFs ficam com a agência). Quem chama já conferiu a permissão.
 */

export const PANEL_FAQ_TITLE = "Respostas do painel";
const COLS = "id, bot_id, kind, title, url, content";

/** A resposta entra no FAQ "Respostas do painel" do bot, é indexada e a pergunta sai da lista. */
export async function answerQuestion(admin: SupabaseClient, opts: { botId: string; unansweredId: string; question: string; answer: string; author: string }): Promise<ActionResult> {
  const question = opts.question.replace(/\s+/g, " ").trim();
  const answer = opts.answer.trim();
  if (question.length < 3) return fail("Escreva a pergunta.");
  if (answer.length < 2) return fail("Escreva a resposta que o assistente deve dar.");
  if (question.length > 500 || answer.length > 3000) return fail("Pergunta ou resposta longa demais.");

  const entry = `P: ${question}\nR: ${answer}`;
  const { data: existing } = await admin.from("sources").select(COLS).eq("bot_id", opts.botId).eq("kind", "faq").eq("title", PANEL_FAQ_TITLE).maybeSingle();
  let source = existing as SourceRow | null;
  if (source) {
    source = { ...source, content: `${source.content ?? ""}\n\n${entry}`.trim() };
    await admin.from("sources").update({ content: source.content, created_by: opts.author }).eq("id", source.id);
  } else {
    const { data: created, error } = await admin.from("sources").insert({ bot_id: opts.botId, kind: "faq", title: PANEL_FAQ_TITLE, content: entry, created_by: opts.author }).select(COLS).single();
    if (error || !created) return fail("Não foi possível salvar a resposta. Tente de novo.");
    source = created as SourceRow;
  }
  try {
    await ingestSource(admin, source);
  } catch (e) {
    return fail(`A resposta foi salva, mas não deu para treinar o assistente agora: ${(e as Error).message}`);
  }
  await admin.from("unanswered").update({ resolved: true, resolved_by: opts.author }).eq("id", opts.unansweredId).eq("bot_id", opts.botId);
  return ok("Pronto: o assistente já responde isso.");
}

export async function dismissQuestion(admin: SupabaseClient, botId: string, unansweredId: string, author: string): Promise<ActionResult> {
  const { error } = await admin.from("unanswered").update({ resolved: true, resolved_by: author }).eq("id", unansweredId).eq("bot_id", botId);
  if (error) return fail("Não foi possível ignorar a pergunta.");
  return ok("Pergunta ignorada.");
}

/** Cria (sem `sourceId`) ou edita um texto/FAQ e retreina o assistente com ele. */
export async function saveTextSource(admin: SupabaseClient, opts: { botId: string; sourceId?: string; kind: string; title: string; content: string; author: string }): Promise<ActionResult> {
  const kind = opts.kind === "faq" ? "faq" : "text";
  const title = opts.title.trim().slice(0, 120) || (kind === "faq" ? "Perguntas frequentes" : "Texto");
  const content = opts.content.trim();
  if (content.length < 20) return fail("Escreva pelo menos algumas linhas.");
  if (content.length > 50_000) return fail("Texto longo demais (até 50 mil caracteres). Divida em partes.");

  let source: SourceRow;
  if (opts.sourceId) {
    const { data: current } = await admin.from("sources").select(COLS).eq("id", opts.sourceId).eq("bot_id", opts.botId).in("kind", ["text", "faq"]).maybeSingle();
    if (!current) return fail("Conteúdo não encontrado.");
    await admin.from("sources").update({ title, content, created_by: opts.author }).eq("id", opts.sourceId);
    source = { ...(current as SourceRow), title, content };
  } else {
    const { data: created, error } = await admin.from("sources").insert({ bot_id: opts.botId, kind, title, content, created_by: opts.author }).select(COLS).single();
    if (error || !created) return fail("Não foi possível salvar. Tente de novo.");
    source = created as SourceRow;
  }
  try {
    const r = await ingestSource(admin, source);
    return ok(`Pronto: o assistente aprendeu (${r.chunks} trecho${r.chunks === 1 ? "" : "s"}).`);
  } catch (e) {
    return fail(`Salvo, mas não deu para treinar agora: ${(e as Error).message}`);
  }
}

export async function deleteTextSource(admin: SupabaseClient, botId: string, sourceId: string): Promise<ActionResult> {
  const { error, count } = await admin.from("sources").delete({ count: "exact" }).eq("id", sourceId).eq("bot_id", botId).in("kind", ["text", "faq"]);
  if (error) return fail("Não foi possível excluir.");
  if (!count) return fail("Conteúdo não encontrado.");
  return ok("Excluído. O assistente não usa mais esse conteúdo.");
}
