import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type ActionResult } from "./action-result";
import { OUTSIDE_WINDOW_CODE, WhatsAppError, sendText } from "./whatsapp";
import { TOKEN_REJECTED, isAccessError, isPaymentError, markDisconnected, markPaymentIssue } from "./whatsapp-access";
import { isInstagramAccessError, isOutsideWindow } from "./instagram";
import { IG_TOKEN_REJECTED, markInstagramDisconnected } from "./instagram-channel";
import { send as sendInstagram } from "./instagram-inbound";
import { sendBlockedReason } from "./conversation-mode";
import { deliver } from "./send";
import { saveMessage, touchConversation } from "./messages";

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
  const sent = await deliverOutside(admin, conversationId, content, author);
  if (sent !== "widget" && sent !== "gravada") return sent;
  const now = new Date().toISOString();
  // no WhatsApp e no Instagram a camada de envio já gravou (com o hash do id da Meta); no site, grava aqui
  if (sent === "widget") {
    try {
      await saveMessage(admin, { conversation_id: conversationId, role: "agent", content, author });
    } catch {
      return fail("A mensagem não foi enviada. Tente de novo.");
    }
  }
  // responder já assume a conversa (o assistente não fala por cima)
  const { data: conv } = await admin.from("conversations").select("takeover_at").eq("id", conversationId).single();
  await touchConversation(admin, conversationId, { extra: { takeover_at: conv?.takeover_at ?? now, handled_at: null } });
  return ok("Enviada. O visitante vê em alguns segundos.");
}

/**
 * Conversa do WhatsApp ou do Instagram: a resposta da equipe sai pelo canal ligado ao chatbot,
 * pela camada única de envio (regra de estado na hora, e só gravada se o cliente recebeu).
 * Site: só confere a regra (canal suspenso) e quem chamou grava.
 */
async function deliverOutside(admin: SupabaseClient, conversationId: string, content: string, author: string): Promise<"widget" | "gravada" | ActionResult> {
  const { data: conv } = await admin.from("conversations").select("bot_id, channel, wa_id, ig_id").eq("id", conversationId).maybeSingle();
  const metaChannel = conv?.channel === "whatsapp" || conv?.channel === "instagram" ? (conv.channel as "whatsapp" | "instagram") : null;
  if (conv && !metaChannel) {
    // regra de estado no site: canal suspenso pela BoaVoz
    const blocked = await sendBlockedReason(admin, conv.bot_id, "widget");
    if (blocked) return fail(`${blocked} A mensagem não foi enviada.`);
  }
  if (conv?.channel === "instagram" && conv.ig_id) return deliverToInstagram(admin, conv.bot_id, conversationId, conv.ig_id, content, author);
  if (conv?.channel !== "whatsapp" || !conv.wa_id) return "widget";
  const { data: channel } = await admin.from("whatsapp_channels").select("phone_number_id, access_token_enc, disconnected_at").eq("bot_id", conv.bot_id).maybeSingle();
  if (!channel || channel.disconnected_at) return fail("O WhatsApp deste chatbot foi desconectado. A mensagem não foi enviada: conecte de novo na aba WhatsApp.");
  try {
    const r = await deliver(admin, {
      botId: conv.bot_id,
      channel: "whatsapp",
      conversationId,
      kind: "equipe",
      recordFailures: false,
      record: { insert: { role: "agent", content, author } },
      transport: async () => (await sendText(channel, conv.wa_id!, content)).messages?.[0]?.id ?? null,
    });
    if (r.status === "blocked") return fail(`${(await sendBlockedReason(admin, conv.bot_id, "whatsapp")) ?? `Envio barrado: ${r.reason}.`} A mensagem não foi enviada.`);
    return "gravada";
  } catch (e) {
    if (isAccessError(e)) {
      await markDisconnected(admin, { column: "bot_id", value: conv.bot_id }, TOKEN_REJECTED);
      return fail("O cliente removeu o acesso do Boavoz ao WhatsApp. A mensagem não foi enviada: conecte de novo na aba WhatsApp.");
    }
    if (isPaymentError(e)) {
      await markPaymentIssue(admin, { column: "bot_id", value: conv.bot_id });
      return fail("A Meta recusou a mensagem por falta de forma de pagamento. O cliente precisa cadastrar o cartão no Gerenciador do WhatsApp.");
    }
    if (e instanceof WhatsAppError && e.code === OUTSIDE_WINDOW_CODE) {
      return fail("Passaram mais de 24 horas desde a última mensagem do cliente. O WhatsApp só deixa responder dentro desse prazo.");
    }
    console.error("whatsapp: resposta do atendente falhou", e);
    return fail("O WhatsApp não aceitou a mensagem. Tente de novo em instantes.");
  }
}

async function deliverToInstagram(admin: SupabaseClient, botId: string, conversationId: string, igsid: string, content: string, author: string): Promise<"gravada" | ActionResult> {
  const { data: ch } = await admin.from("instagram_channels").select("bot_id, ig_user_id, access_token_enc, disconnected_at").eq("bot_id", botId).maybeSingle();
  if (!ch || ch.disconnected_at) return fail("O Instagram deste chatbot foi desconectado. A mensagem não foi enviada: conecte de novo na aba Instagram.");
  try {
    const r = await deliver(admin, {
      botId,
      channel: "instagram",
      conversationId,
      kind: "equipe",
      recordFailures: false,
      record: { insert: { role: "agent", content, author } },
      transport: () => sendInstagram(admin, ch, igsid, content),
    });
    if (r.status === "blocked") return fail(`${(await sendBlockedReason(admin, botId, "instagram")) ?? `Envio barrado: ${r.reason}.`} A mensagem não foi enviada.`);
    return "gravada";
  } catch (e) {
    if (isInstagramAccessError(e)) {
      await markInstagramDisconnected(admin, { column: "bot_id", value: botId }, IG_TOKEN_REJECTED);
      return fail("O cliente removeu o acesso ao Instagram. A mensagem não foi enviada: conecte de novo na aba Instagram.");
    }
    if (isOutsideWindow(e)) return fail("Passaram mais de 24 horas desde a última mensagem do cliente. O Instagram só deixa responder dentro desse prazo.");
    console.error("instagram: resposta do atendente falhou", e);
    return fail("O Instagram não aceitou a mensagem. Tente de novo em instantes.");
  }
}

/** Devolve a conversa ao assistente (ele volta a responder, sabendo o que foi escrito). */
export async function release(admin: SupabaseClient, conversationId: string): Promise<ActionResult> {
  const { error } = await admin.from("conversations").update({ takeover_at: null, handled_at: new Date().toISOString() }).eq("id", conversationId);
  if (error) return fail("Não foi possível encerrar. Tente de novo.");
  return ok("Atendimento encerrado. O assistente volta a responder esta conversa.");
}
