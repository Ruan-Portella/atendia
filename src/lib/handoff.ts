import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type ActionResult } from "./action-result";
import { OUTSIDE_WINDOW_CODE, WhatsAppError, sendText } from "./whatsapp";
import { TOKEN_REJECTED, isAccessError, markDisconnected } from "./whatsapp-access";

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
  const sent = await deliverToWhatsApp(admin, conversationId, content);
  if (sent !== true) return sent;
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

/**
 * Conversa do WhatsApp: a resposta da equipe sai pelo número ligado ao chatbot (antes de gravar,
 * para não mostrar no painel algo que o cliente não recebeu). Outros canais: nada a fazer.
 */
async function deliverToWhatsApp(admin: SupabaseClient, conversationId: string, content: string): Promise<true | ActionResult> {
  const { data: conv } = await admin.from("conversations").select("bot_id, channel, wa_id").eq("id", conversationId).maybeSingle();
  if (conv?.channel !== "whatsapp" || !conv.wa_id) return true;
  const { data: channel } = await admin.from("whatsapp_channels").select("phone_number_id, access_token_enc, disconnected_at").eq("bot_id", conv.bot_id).maybeSingle();
  if (!channel || channel.disconnected_at) return fail("O WhatsApp deste chatbot foi desconectado. A mensagem não foi enviada: conecte de novo na aba WhatsApp.");
  try {
    await sendText(channel, conv.wa_id, content);
    return true;
  } catch (e) {
    if (isAccessError(e)) {
      await markDisconnected(admin, { column: "bot_id", value: conv.bot_id }, TOKEN_REJECTED);
      return fail("O cliente removeu o acesso do Boavoz ao WhatsApp. A mensagem não foi enviada: conecte de novo na aba WhatsApp.");
    }
    if (e instanceof WhatsAppError && e.code === OUTSIDE_WINDOW_CODE) {
      return fail("Passaram mais de 24 horas desde a última mensagem do cliente. O WhatsApp só deixa responder dentro desse prazo.");
    }
    console.error("whatsapp: resposta do atendente falhou", e);
    return fail("O WhatsApp não aceitou a mensagem. Tente de novo em instantes.");
  }
}

/** Devolve a conversa ao assistente (ele volta a responder, sabendo o que foi escrito). */
export async function release(admin: SupabaseClient, conversationId: string): Promise<ActionResult> {
  const { error } = await admin.from("conversations").update({ takeover_at: null, handled_at: new Date().toISOString() }).eq("id", conversationId);
  if (error) return fail("Não foi possível encerrar. Tente de novo.");
  return ok("Atendimento encerrado. O assistente volta a responder esta conversa.");
}
