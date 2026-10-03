import type { SupabaseClient } from "@supabase/supabase-js";
import { unsubscribeApp } from "./whatsapp";
import { unsubscribeInstagram } from "./instagram";
import { unseal } from "./secret-box";

/*
 * Desconectar o canal de um chatbot (painel da agência ou portal do cliente): o app sai dos
 * eventos da conta e o token é apagado junto com a ligação. Nada é apagado na Meta: o número e a
 * conta continuam do negócio. As conversas antigas ficam no painel. Service role.
 */

/** WhatsApp: tira a inscrição do app na conta (o número de teste fica como está) e apaga a ligação. */
export async function disconnectWhatsAppChannel(admin: SupabaseClient, botId: string): Promise<{ ok: boolean; wabaId: string | null; phone: string | null }> {
  const { data: channel } = await admin.from("whatsapp_channels").select("waba_id, access_token_enc, display_phone").eq("bot_id", botId).maybeSingle();
  if (channel?.waba_id && channel.access_token_enc) await unsubscribeApp(channel.waba_id, unseal(channel.access_token_enc));
  const { error } = await admin.from("whatsapp_channels").delete().eq("bot_id", botId);
  return { ok: !error, wabaId: (channel?.waba_id as string | null) ?? null, phone: (channel?.display_phone as string | null) ?? null };
}

/** Instagram: o app sai das mensagens da conta e a ligação (com o token) é apagada. */
export async function disconnectInstagramChannel(admin: SupabaseClient, botId: string): Promise<{ ok: boolean; username: string | null }> {
  const { data: ch } = await admin.from("instagram_channels").select("access_token_enc, username").eq("bot_id", botId).maybeSingle();
  if (ch?.access_token_enc) await unsubscribeInstagram(unseal(ch.access_token_enc));
  const { error } = await admin.from("instagram_channels").delete().eq("bot_id", botId);
  return { ok: !error, username: (ch?.username as string | null) ?? null };
}
