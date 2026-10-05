import type { SupabaseClient } from "@supabase/supabase-js";
import { openBytes, openNullable, scopeOfBot, sealBytes, sealNullable } from "./field-cipher";

/*
 * Arquivos recebidos (leva S): toda mídia que o contato manda, até 16 MB, guardada no Storage
 * (bucket privado "attachments"), cifrada com a chave do cliente, no caminho
 * c/{cliente}/b/{chatbot}/{id}. Entregue só pela rota /api/files/{id}. O objeto sai do Storage
 * antes da linha (purgeAttachments); a varredura diária (sweepAttachments) remove o que ficou sem
 * conversa e o que venceu (modo dados sensíveis: até 30 dias). Só este arquivo usa a tabela (um
 * teste confere).
 */

export const ATTACHMENTS_BUCKET = "attachments";
export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
/** Teto dos arquivos no modo dados sensíveis (as conversas vão até 90 dias). */
export const SENSITIVE_FILE_DAYS = 30;

export type DocType = "image" | "audio" | "video" | "document" | "sticker";

export interface AttachmentInfo {
  id: string;
  mime: string;
  size: number;
  doc_type: DocType;
  filename: string | null;
}

/** Tipo pelo mime (figurinha vem como imagem webp, mas o canal diz). Pura. */
export function docTypeOf(mime: string, hint?: string | null): DocType {
  if (hint === "sticker") return "sticker";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/** Mime sem parâmetros (ex.: "audio/ogg; codecs=opus" → "audio/ogg"). Pura. */
export const baseMime = (mime: string | null | undefined) => (mime ?? "application/octet-stream").split(";")[0].trim().toLowerCase() || "application/octet-stream";

/** Guarda um arquivo recebido; devolve o id (null se grande demais ou se não deu para gravar). */
export async function storeAttachment(
  db: SupabaseClient,
  a: { botId: string; conversationId: string; messageId: number; channel: "whatsapp" | "instagram" | "widget"; data: Uint8Array; mime: string; filename?: string | null; hint?: string | null },
): Promise<string | null> {
  if (!a.data.byteLength || a.data.byteLength > MAX_ATTACHMENT_BYTES) return null;
  const { data: bot } = await db.from("bots").select("agency_id, client_id, sensitive_mode, sensitive_retention_days").eq("id", a.botId).maybeSingle();
  if (!bot) return null;
  const scope = await scopeOfBot(a.botId);
  const id = crypto.randomUUID();
  const path = `c/${(bot.client_id as string | null) ?? "plataforma"}/b/${a.botId}/${id}`;
  const mime = baseMime(a.mime);
  const body = await sealBytes("attachments.object", a.data, scope);
  const { error: upErr } = await db.storage.from(ATTACHMENTS_BUCKET).upload(path, body, { contentType: "application/octet-stream", upsert: false });
  if (upErr) {
    console.error("arquivo não guardado", upErr.message);
    return null;
  }
  // modo dados sensíveis: o arquivo vence antes da conversa (até 30 dias)
  const days = bot.sensitive_mode ? Math.min(SENSITIVE_FILE_DAYS, Number(bot.sensitive_retention_days) || SENSITIVE_FILE_DAYS) : null;
  const { error } = await db.from("attachments").insert({
    id,
    agency_id: bot.agency_id,
    client_id: bot.client_id ?? null,
    bot_id: a.botId,
    conversation_id: a.conversationId,
    message_id: a.messageId,
    channel: a.channel,
    mime,
    size: a.data.byteLength,
    doc_type: docTypeOf(mime, a.hint),
    filename_enc: await sealNullable("attachments.filename_enc", a.filename?.slice(0, 200) || null, scope),
    storage_path: path,
    expires_at: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
  });
  if (error) {
    // sem a linha, o objeto não fica para trás
    await db.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    console.error("arquivo não registrado", error.message);
    return null;
  }
  return id;
}

/** Esta mensagem já tem arquivo guardado? (reprocesso do evento não duplica) */
export async function hasAttachments(db: SupabaseClient, messageId: number): Promise<boolean> {
  const { count } = await db.from("attachments").select("id", { count: "exact", head: true }).eq("message_id", messageId);
  return (count ?? 0) > 0;
}

/** Arquivos destas mensagens, para a tela da conversa. */
export async function attachmentsOfMessages(db: SupabaseClient, messageIds: number[]): Promise<Map<number, AttachmentInfo[]>> {
  const out = new Map<number, AttachmentInfo[]>();
  if (!messageIds.length) return out;
  const { data } = await db.from("attachments").select("id, message_id, mime, size, doc_type, filename_enc").in("message_id", messageIds).order("created_at");
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const list = out.get(r.message_id as number) ?? [];
    list.push({ id: r.id as string, mime: r.mime as string, size: r.size as number, doc_type: r.doc_type as DocType, filename: await openNullable("attachments.filename_enc", r.filename_enc) });
    out.set(r.message_id as number, list);
  }
  return out;
}

export interface AttachmentFile extends AttachmentInfo {
  agency_id: string;
  client_id: string | null;
  bot_id: string;
  conversation_id: string | null;
  data: Uint8Array | null;
}

/** A linha (para conferir quem pode ver). */
export async function attachmentRow(db: SupabaseClient, id: string): Promise<Omit<AttachmentFile, "data" | "filename"> & { storage_path: string; filename_enc: string | null } | null> {
  const { data } = await db.from("attachments").select("id, agency_id, client_id, bot_id, conversation_id, mime, size, doc_type, filename_enc, storage_path").eq("id", id).maybeSingle();
  return (data as (Omit<AttachmentFile, "data" | "filename"> & { storage_path: string; filename_enc: string | null }) | null) ?? null;
}

/** O arquivo aberto (data null: objeto ausente ou chave apagada). */
export async function readAttachment(db: SupabaseClient, row: NonNullable<Awaited<ReturnType<typeof attachmentRow>>>): Promise<AttachmentFile> {
  const { data: blob } = await db.storage.from(ATTACHMENTS_BUCKET).download(row.storage_path);
  const data = blob ? await openBytes("attachments.object", new Uint8Array(await blob.arrayBuffer())) : null;
  const { storage_path: _path, filename_enc, ...rest } = row;
  void _path;
  return { ...rest, filename: await openNullable("attachments.filename_enc", filename_enc), data };
}

/**
 * Apaga arquivos: primeiro o objeto no Storage, depois a linha. Por conversa (exclusão, limpeza,
 * pedido do titular), por mensagem (desfeita no Instagram) ou do chatbot criados antes de uma data
 * (modo dados sensíveis). Devolve quantos.
 */
export async function purgeAttachments(db: SupabaseClient, f: { conversationIds?: string[]; messageIds?: number[]; botId?: string; createdBefore?: string; ids?: string[] }): Promise<number> {
  let total = 0;
  for (;;) {
    let q = db.from("attachments").select("id, storage_path");
    if (f.conversationIds) q = q.in("conversation_id", f.conversationIds.length ? f.conversationIds : ["00000000-0000-0000-0000-000000000000"]);
    if (f.messageIds) q = q.in("message_id", f.messageIds.length ? f.messageIds : [-1]);
    if (f.ids) q = q.in("id", f.ids.length ? f.ids : ["00000000-0000-0000-0000-000000000000"]);
    if (f.botId) q = q.eq("bot_id", f.botId);
    if (f.createdBefore) q = q.lt("created_at", f.createdBefore);
    const { data, error } = await q.limit(100);
    if (error) throw new Error(`arquivos: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; storage_path: string }>;
    if (!rows.length) return total;
    const { error: rmErr } = await db.storage.from(ATTACHMENTS_BUCKET).remove(rows.map((r) => r.storage_path));
    if (rmErr) throw new Error(`arquivos no Storage: ${rmErr.message}`);
    await db.from("attachments").delete().in("id", rows.map((r) => r.id));
    total += rows.length;
    if (rows.length < 100) return total;
  }
}

/** Varredura diária: arquivos sem conversa (chatbot ou cliente excluído, conversa apagada por outro caminho) e vencidos. */
export async function sweepAttachments(db: SupabaseClient, hasTime: () => boolean = () => true): Promise<number> {
  let total = 0;
  while (hasTime()) {
    const { data } = await db.from("attachments").select("id").or(`conversation_id.is.null,expires_at.lt."${new Date().toISOString()}"`).limit(100);
    const ids = (data ?? []).map((r) => r.id as string);
    if (!ids.length) break;
    total += await purgeAttachments(db, { ids });
    if (ids.length < 100) break;
  }
  return total;
}
