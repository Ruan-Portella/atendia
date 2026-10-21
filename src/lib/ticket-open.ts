import type { SupabaseClient } from "@supabase/supabase-js";
import { openConversation, requestHandoff, type BotRow } from "./chat";
import { saveMessage } from "./messages";
import { saveLead } from "./leads";
import { typedPhoneHash } from "./contacts";
import { TICKET_FILE_MAX_BYTES, assignProtocol, type TicketForm, type TicketInput } from "./tickets";
import { storeAttachment } from "./attachments";
import { queueTicketEvent } from "./message-events";

/**
 * Abre o chamado (Caixa de entrada, parte 7a): uma conversa nova do site com o protocolo, a
 * descrição como a primeira mensagem, quem abriu como lead e o pedido para a equipe (o assunto com
 * o nome de um setor vai para esse setor, pelo rodízio quando houver). Sem IA: não conta atendimento.
 */
export async function openTicket(db: SupabaseClient, bot: BotRow, form: TicketForm, d: TicketInput & { visitorId: string | null; whatsapp?: boolean; attachment?: { data: Uint8Array; mime: string; filename: string | null } | null }, now = new Date()): Promise<{ conversationId: string; protocol: string }> {
  const at = now.toISOString();
  const subject = form.subjects.length && d.subject ? d.subject : null;
  const conversationId = await openConversation(db, bot, { channel: "widget", visitorId: d.visitorId });
  const protocol = await assignProtocol(db, conversationId, { subject, at });
  const description = d.description.trim();
  const messageId = await saveMessage(db, { conversation_id: conversationId, role: "user", content: description }, { touch: "visitante" });
  // o anexo (leva das sobras, parte 4): fica com a descrição, no armazenamento privado; só a equipe vê
  let attachment: { id: string; mime: string; size: number; filename: string | null } | null = null;
  if (d.attachment && messageId) {
    const id = await storeAttachment(db, { botId: bot.id, conversationId, messageId, channel: "widget", data: d.attachment.data, mime: d.attachment.mime, filename: d.attachment.filename, maxBytes: TICKET_FILE_MAX_BYTES });
    if (id) attachment = { id: `med_${id}`, mime: d.attachment.mime, size: d.attachment.data.byteLength, filename: d.attachment.filename };
  }
  const phone = d.phone?.trim() || null;
  await saveLead(db, { botId: bot.id, conversationId, name: d.name.trim(), phone, phoneHash: typedPhoneHash(phone), email: d.email.trim().toLowerCase(), channel: "widget", notes: `Chamado ${protocol}${subject ? ` (${subject})` : ""}: ${description.slice(0, 300)}` });
  // aviso pelo WhatsApp (parte 7d): só com o telefone e o aceite marcado; a hora fica como prova
  if (d.whatsapp && phone && phone.replace(/\D/g, "").length >= 10) await db.from("conversations").update({ ticket_whatsapp_at: at }).eq("id", conversationId);
  await requestHandoff(db, bot, conversationId, `Chamado ${protocol}${subject ? `: ${subject}` : ""}`, { sector: subject });
  await queueTicketEvent(db, conversationId, { type: "ticket.created", ticket: { protocol, status: "aberto", subject }, at, requester: { name: d.name.trim(), email: d.email.trim().toLowerCase(), phone }, attachment });
  return { conversationId, protocol };
}
