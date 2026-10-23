import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type ActionResult } from "./action-result";
import { openNullable, scopeOfBot, sealNullable } from "./field-cipher";
import type { Attendant } from "./authors";
import { noteBody } from "./note-text";

/*
 * Notas internas e o registro das transferências (Caixa de entrada, parte 4): só a equipe vê, no
 * meio da conversa; nunca vão ao contato, à IA, à exportação nem aos webhooks. O texto é cifrado
 * com a chave do cliente (pode citar dados do contato).
 */

export type NoteKind = "nota" | "transferencia";

export interface ConversationNote {
  id: string;
  kind: NoteKind;
  authorId: string;
  authorName: string;
  body: string | null;
  targetLabel: string | null;
  createdAt: string;
}

/** Grava uma nota (ou o registro de uma transferência) na conversa. */
export async function saveNote(db: SupabaseClient, n: { conversationId: string; botId: string; kind: NoteKind; who: Attendant; body: string | null; targetLabel?: string | null }): Promise<void> {
  const body_enc = await sealNullable("conversation_notes.body_enc", n.body, await scopeOfBot(n.botId));
  const { error } = await db.from("conversation_notes").insert({
    conversation_id: n.conversationId,
    bot_id: n.botId,
    kind: n.kind,
    author_type: n.who.type,
    author_id: n.who.id,
    author_name: n.who.name,
    body_enc,
    target_label: n.targetLabel ?? null,
  });
  if (error) throw new Error(`nota: ${error.message}`);
}

/** "Nota interna" na conversa: quem vê a conversa pode escrever (a página confere a permissão). */
export async function addNote(db: SupabaseClient, conversationId: string, raw: unknown, who: Attendant): Promise<ActionResult> {
  const body = noteBody(raw);
  if (body && typeof body === "object") return fail(body.error);
  if (!body) return fail("Escreva a nota.");
  const { data: conv } = await db.from("conversations").select("bot_id").eq("id", conversationId).maybeSingle();
  if (!conv) return fail("Conversa não encontrada.");
  try {
    await saveNote(db, { conversationId, botId: conv.bot_id as string, kind: "nota", who, body });
  } catch {
    return fail("A nota não foi gravada. Tente de novo.");
  }
  return ok("Nota gravada. Só a equipe vê.");
}

/** As notas e transferências da conversa, da mais antiga para a mais nova. */
export async function listNotes(db: SupabaseClient, conversationId: string): Promise<ConversationNote[]> {
  const { data } = await db.from("conversation_notes").select("id, kind, author_id, author_name, body_enc, target_label, created_at").eq("conversation_id", conversationId).order("created_at").limit(200);
  return Promise.all(
    ((data ?? []) as Array<Record<string, unknown>>).map(async (r) => ({
      id: r.id as string,
      kind: r.kind as NoteKind,
      authorId: r.author_id as string,
      authorName: r.author_name as string,
      body: await openNullable("conversation_notes.body_enc", r.body_enc).catch(() => null),
      targetLabel: (r.target_label as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
  );
}

/** As notas internas das conversas de um contato (a ficha do contato), da mais nova para a mais antiga; sem as transferências. */
export async function listContactNotes(db: SupabaseClient, conversationIds: string[], limit = 50): Promise<Array<ConversationNote & { conversationId: string }>> {
  if (!conversationIds.length) return [];
  const { data } = await db.from("conversation_notes").select("id, conversation_id, kind, author_id, author_name, body_enc, target_label, created_at").in("conversation_id", conversationIds).eq("kind", "nota").order("created_at", { ascending: false }).limit(limit);
  return Promise.all(
    ((data ?? []) as Array<Record<string, unknown>>).map(async (r) => ({
      id: r.id as string,
      conversationId: r.conversation_id as string,
      kind: r.kind as NoteKind,
      authorId: r.author_id as string,
      authorName: r.author_name as string,
      body: await openNullable("conversation_notes.body_enc", r.body_enc).catch(() => null),
      targetLabel: (r.target_label as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
  );
}
