import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Mídia que o assistente não enxerga (foto, vídeo, arquivo, story, post ou reel sem legenda): ele
 * não responde à pergunta sobre ela, para não chutar ("quanto custa?" sobre uma foto que ele não
 * vê). Sai um texto fixo pedindo para a pessoa escrever o que é. Vale para a pergunta na legenda e
 * para a que chega logo depois, em outra mensagem: a conversa guarda por 2 minutos que chegou mídia.
 */

export type UnseenKind = "foto" | "vídeo" | "arquivo" | "story" | "post" | "reel";

/** Por quanto tempo a próxima mensagem ainda é "sobre a mídia que acabou de chegar". */
export const UNSEEN_WINDOW_MS = 2 * 60_000;

const WHAT: Record<UnseenKind, string> = { foto: "sua foto", vídeo: "seu vídeo", arquivo: "seu arquivo", story: "o story", post: "o post", reel: "o reel" };
const CANT: Record<UnseenKind, string> = { foto: "ver imagens", vídeo: "ver vídeos", arquivo: "abrir arquivos", story: "ver imagens", post: "ver imagens", reel: "ver vídeos" };

/** O texto fixo ao contato. Função pura. */
export function unseenMediaText(kind: UnseenKind): string {
  return `Recebi ${WHAT[kind]}, mas por aqui eu ainda não consigo ${CANT[kind]}. Pode me escrever o que é ou o que você quer saber (o nome do produto, por exemplo)? Assim eu te respondo certo.`;
}

/** WhatsApp: foto, vídeo e documento (com ou sem legenda). Figurinha, localização e áudio não. */
export function waUnseenKind(type: string): UnseenKind | null {
  return type === "image" ? "foto" : type === "video" ? "vídeo" : type === "document" ? "arquivo" : null;
}

/**
 * Instagram: foto, vídeo, arquivo e story; post ou reel compartilhado só quando vem sem legenda
 * (com legenda, o assistente lê a legenda, escrita por quem publicou).
 */
export function igUnseenKind(attachments: Array<{ type?: string; payload?: { title?: string } }> | undefined): UnseenKind | null {
  let kind: UnseenKind | null = null;
  for (const a of attachments ?? []) {
    const t = a.type ?? "";
    const hasCaption = Boolean(a.payload?.title?.trim());
    if (t === "image") kind = "foto";
    else if (t === "video") kind = "vídeo";
    else if (t === "file") kind = "arquivo";
    else if (t === "ig_story" || t === "story") kind = "story";
    else if ((t === "ig_post" || t === "post" || t === "share") && !hasCaption) kind = "post";
    else if ((t === "ig_reel" || t === "reel") && !hasCaption) kind = "reel";
  }
  return kind;
}

export interface UnseenMark {
  unseen_media_at?: string | null;
  unseen_media_kind?: string | null;
}

/** Chegou mídia há menos de 2 minutos e ainda ninguém respondeu sobre ela? Qual? */
export function recentUnseen(conv: UnseenMark | null | undefined, now = Date.now()): UnseenKind | null {
  if (!conv?.unseen_media_at || now - Date.parse(conv.unseen_media_at) > UNSEEN_WINDOW_MS) return null;
  return (conv.unseen_media_kind as UnseenKind | null) ?? "foto";
}

/** Guarda na conversa que chegou mídia (a pergunta deve vir na próxima mensagem). */
export async function markUnseen(db: SupabaseClient, conversationId: string, kind: UnseenKind) {
  await db.from("conversations").update({ unseen_media_at: new Date().toISOString(), unseen_media_kind: kind }).eq("id", conversationId);
}

/** Já respondemos sobre a mídia: a marca sai. */
export async function clearUnseen(db: SupabaseClient, conversationId: string) {
  await db.from("conversations").update({ unseen_media_at: null, unseen_media_kind: null }).eq("id", conversationId).not("unseen_media_at", "is", null);
}
