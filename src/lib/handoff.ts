import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type ActionResult } from "./action-result";

/**
 * Atendimento humano: as mesmas operações para a agência (painel) e para o cliente final
 * (área do cliente). Quem chama já conferiu a permissão e passa a service role.
 * `author` fica gravado na mensagem para saber quem respondeu.
 */

export async function takeOver(admin: SupabaseClient, conversationId: string): Promise<ActionResult> {
  const { error } = await admin.from("conversations").update({ takeover_at: new Date().toISOString(), handled_at: null, needs_human: true }).eq("id", conversationId);
  if (error) return fail("Não foi possível assumir a conversa. Tente de novo.");
  return ok("Você assumiu a conversa. O assistente pausou até você devolver.");
}

export async function postAgentMessage(admin: SupabaseClient, conversationId: string, rawContent: string, author: string): Promise<ActionResult> {
  const content = rawContent.trim();
  if (!content) return fail("Escreva uma mensagem.");
  if (content.length > 2000) return fail("Mensagem muito longa (até 2.000 caracteres).");
  const now = new Date().toISOString();
  let { error } = await admin.from("messages").insert({ conversation_id: conversationId, role: "agent", content, author });
  // banco sem a migração 0009 (coluna author): envia sem o autor
  if (error) ({ error } = await admin.from("messages").insert({ conversation_id: conversationId, role: "agent", content }));
  if (error) return fail("A mensagem não foi enviada. Tente de novo.");
  const { count } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
  // responder já assume a conversa (o assistente não fala por cima)
  const { data: conv } = await admin.from("conversations").select("takeover_at").eq("id", conversationId).single();
  await admin.from("conversations").update({ takeover_at: conv?.takeover_at ?? now, handled_at: null, last_message_at: now, message_count: count ?? 0 }).eq("id", conversationId);
  return ok("Enviada. O visitante vê em alguns segundos.");
}

/** Devolve a conversa ao assistente (ele volta a responder, sabendo o que foi escrito). */
export async function release(admin: SupabaseClient, conversationId: string): Promise<ActionResult> {
  const { error } = await admin.from("conversations").update({ takeover_at: null, handled_at: new Date().toISOString() }).eq("id", conversationId);
  if (error) return fail("Não foi possível encerrar. Tente de novo.");
  return ok("Atendimento encerrado. O assistente volta a responder esta conversa.");
}
