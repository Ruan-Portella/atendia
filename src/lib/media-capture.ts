import type { SupabaseClient } from "@supabase/supabase-js";
import { findMessage } from "./messages";
import { MAX_ATTACHMENT_BYTES, hasAttachments, storeAttachment } from "./attachments";
import { downloadMedia } from "./whatsapp";
import { safeFetch } from "./safe-fetch";
import type { ChannelRow, QueuedMessage } from "./whatsapp-inbound";
import type { IgMessagingEvent } from "./instagram-inbound";

/*
 * Guarda a mídia recebida (leva S), depois que a rajada foi tratada: acha a mensagem gravada pela
 * chave do evento e guarda o arquivo cifrado (attachments.ts). Sem mensagem gravada (ordem da
 * Meta, desligamento) ou já desfeita, nada é guardado; reprocesso não duplica. Falha em um arquivo
 * não afeta os outros nem a conversa.
 */

const WA_MEDIA = ["image", "video", "audio", "document", "sticker"] as const;
const IG_MEDIA = new Set(["image", "video", "audio", "file"]);

/** A mensagem gravada deste evento, se ainda não tem arquivo e não foi desfeita. */
async function targetMessage(db: SupabaseClient, key: string): Promise<{ id: number; conversation_id: string } | null> {
  const m = await findMessage(db, { inboundKey: key }, ["id", "conversation_id", "deleted_at"] as const);
  if (!m || m.deleted_at) return null;
  if (await hasAttachments(db, m.id)) return null;
  return { id: m.id, conversation_id: m.conversation_id };
}

export async function captureWhatsAppMedia(db: SupabaseClient, channel: ChannelRow, burst: QueuedMessage[]): Promise<number> {
  let n = 0;
  for (const q of burst) {
    const kind = WA_MEDIA.find((k) => q.msg.type === k);
    const media = kind ? q.msg[kind] : undefined;
    if (!kind || !media?.id) continue;
    try {
      const target = await targetMessage(db, q.key);
      if (!target) continue;
      const { data, mimeType } = await downloadMedia(channel, media.id);
      const id = await storeAttachment(db, { botId: channel.bot_id, conversationId: target.conversation_id, messageId: target.id, channel: "whatsapp", data, mime: media.mime_type ?? mimeType, filename: kind === "document" ? (q.msg.document?.filename ?? null) : null, hint: kind });
      if (id) n++;
    } catch (e) {
      console.error("whatsapp: mídia não guardada", q.msg.type, (e as Error).message);
    }
  }
  return n;
}

/** Baixa do CDN do Instagram, até o limite. */
async function fetchIgMedia(url: string): Promise<{ data: Uint8Array; mime: string } | null> {
  const { res } = await safeFetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_ATTACHMENT_BYTES) return null;
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_ATTACHMENT_BYTES) return null;
  return { data, mime: res.headers.get("content-type") ?? "application/octet-stream" };
}

export async function captureInstagramMedia(db: SupabaseClient, botId: string, burst: Array<{ key: string; ev: IgMessagingEvent }>): Promise<number> {
  let n = 0;
  for (const q of burst) {
    const items = (q.ev.message?.attachments ?? []).filter((a) => IG_MEDIA.has(a.type ?? "") && a.payload?.url);
    if (!items.length) continue;
    try {
      const target = await targetMessage(db, q.key);
      if (!target) continue;
      for (const a of items) {
        const file = await fetchIgMedia(a.payload!.url!);
        if (!file) continue;
        const id = await storeAttachment(db, { botId, conversationId: target.conversation_id, messageId: target.id, channel: "instagram", data: file.data, mime: file.mime, filename: a.payload?.title ?? null });
        if (id) n++;
      }
    } catch (e) {
      console.error("instagram: mídia não guardada", (e as Error).message);
    }
  }
  return n;
}
