import type { SupabaseClient } from "@supabase/supabase-js";
import { queueChannelEvent } from "./platform-events";
import { unsubscribeApp } from "./whatsapp";
import { unsubscribeInstagram } from "./instagram";
import { unseal } from "./secret-box";

/*
 * Desconectar o canal de um chatbot (painel da agência ou portal do cliente): o app sai dos
 * eventos da conta e o token é apagado junto com a ligação. Nada é apagado na Meta: o número e a
 * conta continuam do negócio. As conversas antigas ficam no painel. Service role.
 */

/** "Desconectar de vez" no channel.disconnected: quem desconectou. */
const disconnectedBy = (via: Via) => ({ code: "disconnected", message: via === "cliente" ? "desconectado pela área do cliente" : "desconectado pelo painel da agência" });
type Via = "painel" | "cliente";

/** WhatsApp: tira a inscrição do app na conta (o número de teste fica como está) e apaga a ligação. */
export async function disconnectWhatsAppChannel(admin: SupabaseClient, botId: string, via: Via = "painel"): Promise<{ ok: boolean; wabaId: string | null; phone: string | null }> {
  const { data: channel } = await admin.from("whatsapp_channels").select("waba_id, phone_number_id, access_token_enc, display_phone, disconnected_at").eq("bot_id", botId).maybeSingle();
  if (channel?.waba_id && channel.access_token_enc) await unsubscribeApp(channel.waba_id, unseal(channel.access_token_enc));
  const { error } = await admin.from("whatsapp_channels").delete().eq("bot_id", botId);
  // webhooks: channel.disconnected (o que já tinha caído saiu na hora em que caiu)
  if (!error && channel && !channel.disconnected_at) await queueChannelEvent(admin, botId, "disconnected", { type: "whatsapp", phoneNumberId: channel.phone_number_id as string, display: (channel.display_phone as string | null) ?? null }, { at: new Date().toISOString(), reason: disconnectedBy(via) });
  return { ok: !error, wabaId: (channel?.waba_id as string | null) ?? null, phone: (channel?.display_phone as string | null) ?? null };
}

/** Instagram: o app sai das mensagens da conta e a ligação (com o token) é apagada. */
export async function disconnectInstagramChannel(admin: SupabaseClient, botId: string, via: Via = "painel"): Promise<{ ok: boolean; username: string | null }> {
  const { data: ch } = await admin.from("instagram_channels").select("ig_user_id, access_token_enc, username, disconnected_at").eq("bot_id", botId).maybeSingle();
  if (ch?.access_token_enc) await unsubscribeInstagram(unseal(ch.access_token_enc));
  const { error } = await admin.from("instagram_channels").delete().eq("bot_id", botId);
  if (!error && ch && !ch.disconnected_at) await queueChannelEvent(admin, botId, "disconnected", { type: "instagram", igUserId: ch.ig_user_id as string, username: (ch.username as string | null) ?? null }, { at: new Date().toISOString(), reason: disconnectedBy(via) });
  return { ok: !error, username: (ch?.username as string | null) ?? null };
}
