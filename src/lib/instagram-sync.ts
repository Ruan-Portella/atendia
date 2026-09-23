import type { SupabaseClient } from "@supabase/supabase-js";
import { conversationMessages, igTime, isInstagramAccessError, listConversations, messageDetails, type IgMessageDetails } from "./instagram";
import { IG_TOKEN_REJECTED, markInstagramDisconnected } from "./instagram-channel";
import { handleInstagramEcho, handleInstagramMessage, type IgChannelRow, type IgMessagingEvent } from "./instagram-inbound";

/**
 * Busca de DMs pela API de conversas: a reserva quando o webhook não entrega (ex.: app ainda não
 * publicado na Meta) ou perde alguma mensagem. Cada DM nova passa pelo mesmo caminho do webhook,
 * e o controle de "já tratada" é o mesmo: a mesma mensagem nunca é respondida duas vezes.
 */

/** Na primeira busca, só o que chegou há pouco (não responde o histórico antigo da conta). */
const FIRST_SYNC_MINUTES = 10;
/** Folga para relógios diferentes e mensagens que chegam durante a busca. */
const OVERLAP_MS = 60_000;
const MAX_CONVERSATIONS = 15;

export interface SyncChannel extends IgChannelRow {
  last_synced_at: string | null;
  username?: string | null;
}

/**
 * Mensagem da API de conversas no formato do webhook (DM do contato ou eco da conta). A conta é
 * reconhecida pelo id e, por garantia, também pelo @: se a API usar outro id para ela, as nossas
 * próprias respostas nunca passam por DM de cliente (o assistente responderia a si mesmo).
 */
export function toMessagingEvent(m: IgMessageDetails, igUserId: string, username?: string | null): IgMessagingEvent | null {
  const from = m.from?.id;
  const to = m.to?.data?.[0]?.id;
  if (!from || !to) return null;
  const fromBusiness = from === igUserId || (Boolean(username) && m.from?.username?.toLowerCase() === username!.toLowerCase());
  return {
    sender: { id: from },
    recipient: { id: to },
    timestamp: igTime(m.created_time),
    message: { mid: m.id, text: m.message ?? undefined, is_echo: fromBusiness || undefined },
  };
}

export async function syncInstagram(db: SupabaseClient, ch: SyncChannel): Promise<{ processed: number }> {
  const startedAt = new Date();
  const since = (ch.last_synced_at ? new Date(ch.last_synced_at).getTime() : startedAt.getTime() - FIRST_SYNC_MINUTES * 60_000) - OVERLAP_MS;
  let processed = 0;
  try {
    const conversations = (await listConversations(ch)).filter((c) => igTime(c.updated_time) >= since).slice(0, MAX_CONVERSATIONS);
    for (const c of conversations) {
      const recent = (await conversationMessages(ch, c.id)).filter((m) => igTime(m.created_time) >= since);
      if (!recent.length) continue;
      // o que já foi tratado (pelo webhook ou por uma busca anterior) nem busca os detalhes
      const { data: seen } = await db.from("whatsapp_inbound").select("message_id").in("message_id", recent.map((m) => m.id));
      const done = new Set((seen ?? []).map((r) => r.message_id as string));
      // mais antigas primeiro, para a conversa sair na ordem certa
      for (const m of recent.filter((x) => !done.has(x.id)).sort((a, b) => igTime(a.created_time) - igTime(b.created_time))) {
        const ev = toMessagingEvent(await messageDetails(ch, m.id), ch.ig_user_id, ch.username);
        if (!ev) continue;
        if (ev.message?.is_echo) await handleInstagramEcho(db, ch, ev);
        else await handleInstagramMessage(db, ch, ev);
        processed++;
      }
    }
  } catch (e) {
    if (isInstagramAccessError(e)) {
      await markInstagramDisconnected(db, { column: "bot_id", value: ch.bot_id }, IG_TOKEN_REJECTED);
      return { processed };
    }
    throw e;
  }
  await db.from("instagram_channels").update({ last_synced_at: startedAt.toISOString() }).eq("bot_id", ch.bot_id);
  if (processed) console.log("instagram: busca de DMs", { bot: ch.bot_id, processed });
  return { processed };
}
