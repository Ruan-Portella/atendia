import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "./inbound-queue";
import { logDeletion } from "./deletions";
import { loadMessages, updateMessages } from "./messages";
import { purgeAttachments } from "./attachments";
import type { IgMessagingEvent } from "./instagram-inbound";

/*
 * Instagram (L1): o que muda numa DM depois que ela chega.
 *   - post ou reel compartilhado (anexos ig_post/post e ig_reel/reel): reconhecido, com a
 *     referência (id, link, legenda) guardada na mensagem; o assistente lê a legenda;
 *   - mensagem editada (message_edit): o conteúdo é atualizado e marcado como editado;
 *   - mensagem desfeita (is_deleted): vira lápide (o conteúdo some, a linha fica, com deleted_at)
 *     e vai para o registro de exclusões; se o aviso chega antes da mensagem, ela já é gravada assim.
 */

export const DELETED_LABEL = "(mensagem apagada pelo contato)";

/** Chave da DM na fila e na mensagem gravada (o mesmo hash que a fila usa). */
export const igMessageKey = (mid: string) => sha256(`ig:msg:${mid}`);

export interface SharedRef {
  kind: "post" | "reel" | "story";
  /** Id do post (ig_post) ou do vídeo (ig_reel). */
  id: string | null;
  url: string | null;
  /** Legenda do post no momento da mensagem. */
  title: string | null;
  /** Link do post no Instagram (só quando o post é da própria conta conectada). */
  permalink?: string | null;
}

const POST_TYPES = new Set(["ig_post", "post", "share"]);
const REEL_TYPES = new Set(["ig_reel", "reel"]);
/** Story de outra conta encaminhado na DM: só vem a imagem (story não tem legenda). */
const STORY_TYPES = new Set(["ig_story", "story"]);

/** Post, reel ou story compartilhado nesta DM, ou null. Função pura. */
export function sharedRef(ev: IgMessagingEvent): SharedRef | null {
  for (const a of ev.message?.attachments ?? []) {
    const type = a.type ?? "";
    if (!POST_TYPES.has(type) && !REEL_TYPES.has(type) && !STORY_TYPES.has(type)) continue;
    return {
      kind: REEL_TYPES.has(type) ? "reel" : STORY_TYPES.has(type) ? "story" : "post",
      id: a.payload?.reel_video_id ?? a.payload?.id ?? null,
      url: a.payload?.url ?? null,
      title: a.payload?.title?.trim() || null,
    };
  }
  return null;
}

/** O que o assistente (e o painel) leem de um post, reel ou story compartilhado. */
export function sharedText(ref: SharedRef): string {
  // story não tem legenda: o texto fica na imagem, que o assistente ainda não lê
  if (ref.kind === "story") return "📎 Story compartilhado do Instagram (o assistente não vê a imagem)";
  const what = ref.kind === "reel" ? "Reel" : "Post";
  return ref.title ? `📎 ${what} compartilhado do Instagram: "${ref.title.slice(0, 500)}"` : `📎 ${what} compartilhado do Instagram (sem legenda)`;
}

/** A pessoa editou a DM: o conteúdo gravado passa a ser o novo, marcado como editado. */
export async function handleInstagramEdit(db: SupabaseClient, ev: IgMessagingEvent): Promise<boolean> {
  const edit = ev.message_edit;
  if (!edit?.mid || typeof edit.text !== "string") return false;
  const ids = await updateMessages(db, { inboundKey: igMessageKey(edit.mid) }, { content: edit.text.trim().slice(0, 2000), edited_at: new Date().toISOString() }, { notDeleted: true });
  if (!ids.length) console.log("instagram: edição de mensagem que não está no painel", edit.num_edit);
  return ids.length > 0;
}

/**
 * A pessoa desfez a DM: lápide (o conteúdo some, a linha fica) e registro de exclusões. Se a DM
 * ainda não foi gravada (o aviso chegou antes), fica a marca para ela já chegar apagada.
 */
export async function handleInstagramDelete(db: SupabaseClient, ev: IgMessagingEvent): Promise<"apagada" | "marcada"> {
  const mid = ev.message?.mid;
  if (!mid) return "marcada";
  const key = igMessageKey(mid);
  const ids = (await loadMessages(db, { inboundKey: key }, ["id"] as const)).map((r) => String(r.id));
  if (!ids.length) {
    await logDeletion(db, "inbound_key", [key]);
    return "marcada";
  }
  await logDeletion(db, "message_content", ids);
  await updateMessages(db, { ids }, { content: DELETED_LABEL, channel_ref: null, deleted_at: new Date().toISOString() });
  // lápide: os arquivos da mensagem saem também (objeto e linha)
  await purgeAttachments(db, { messageIds: ids.map(Number) });
  return "apagada";
}

/** Destas DMs, quais foram desfeitas antes de chegar (o aviso veio primeiro)? */
export async function deletedBeforeArrival(db: SupabaseClient, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const { data } = await db.from("deletion_log").select("row_id").eq("table_name", "inbound_key").in("row_id", keys);
  return new Set((data ?? []).map((r) => String(r.row_id)));
}
