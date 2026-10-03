import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contactIdsOfChannel, deleteContacts } from "./contacts";

/*
 * Registro de exclusões (migração 0033): o que é apagado por pedido fica registrado (só id e
 * data), para ser apagado de novo se um backup for restaurado. Registrar vem ANTES de apagar:
 * se o registro falhar, a exclusão não acontece (senão uma restauração traria o dado de volta).
 */

export type DeletableTable = "conversations" | "leads" | "instagram_channels" | "whatsapp_channels" | "bots" | "clients" | "unanswered" | "contacts" | "message_content" | "inbound_key";

export async function logDeletion(db: SupabaseClient, table: DeletableTable, ids: string[], requestCode?: string | null) {
  if (!ids.length) return;
  const { error } = await db.from("deletion_log").insert(ids.map((id) => ({ table_name: table, row_id: id, request_code: requestCode ?? null })));
  if (error) throw new Error(`registro de exclusões: ${error.message}`);
}

/** Código de confirmação que a Meta mostra à pessoa (curto, sem dado pessoal). */
export const newDeletionCode = () => randomBytes(9).toString("base64url");

/* ------------------------------------------------------------------ signed_request da Meta */

export interface SignedRequest {
  user_id: string;
  algorithm: string;
  issued_at?: number;
}

/**
 * Lê o `signed_request` dos callbacks da Meta: "assinatura.dados", os dois em base64url, com a
 * assinatura HMAC-SHA256 dos dados pela chave secreta do app. Tenta cada chave (app do
 * Instagram e app do WhatsApp) e devolve qual delas assinou. null = assinatura inválida.
 */
export function parseSignedRequest(signed: string | null | undefined, secrets: Array<{ app: string; secret: string | undefined }>): { app: string; data: SignedRequest } | null {
  if (!signed || !signed.includes(".")) return null;
  const [sigPart, payload] = signed.split(".", 2);
  const sig = Buffer.from(sigPart, "base64url");
  for (const { app, secret } of secrets) {
    if (!secret) continue;
    const expected = createHmac("sha256", secret).update(payload).digest();
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) continue;
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SignedRequest;
      if (String(data.algorithm).toUpperCase() !== "HMAC-SHA256" || !data.user_id) return null;
      return { app, data: { ...data, user_id: String(data.user_id) } };
    } catch {
      return null;
    }
  }
  return null;
}

/** As chaves dos dois apps da Meta (Instagram com login do Instagram e WhatsApp). */
export const metaAppSecrets = () => [
  { app: "instagram", secret: process.env.INSTAGRAM_APP_SECRET },
  { app: "facebook", secret: process.env.WHATSAPP_APP_SECRET },
];

/* ------------------------------------------------------------------ exclusão pedida pela Meta */

/**
 * "Apague meus dados" vindo da Meta para uma conta do Instagram conectada (o dono da conta
 * profissional): desconecta, apaga o token e a conexão, e apaga as conversas do Instagram
 * daquele chatbot, com os contatos capturados nelas. Tudo registrado no registro de exclusões.
 */
export async function deleteInstagramAccountData(db: SupabaseClient, igUserId: string, code: string) {
  const { data: channels } = await db.from("instagram_channels").select("id, bot_id").eq("ig_user_id", igUserId);
  let conversations = 0;
  let leads = 0;
  for (const ch of channels ?? []) {
    for (;;) {
      const { data: convs } = await db.from("conversations").select("id").eq("bot_id", ch.bot_id).eq("channel", "instagram").limit(500);
      const ids = (convs ?? []).map((c) => c.id as string);
      if (!ids.length) break;
      const { data: leadRows } = await db.from("leads").select("id").in("conversation_id", ids);
      const leadIds = (leadRows ?? []).map((l) => l.id as string);
      await logDeletion(db, "leads", leadIds, code);
      await logDeletion(db, "conversations", ids, code);
      if (leadIds.length) await db.from("leads").delete().in("id", leadIds);
      const { error } = await db.from("conversations").delete().in("id", ids);
      if (error) throw new Error(`exclusão de conversas: ${error.message}`);
      conversations += ids.length;
      leads += leadIds.length;
    }
    // as fichas dos contatos do Instagram deste chatbot
    const contactIds = await contactIdsOfChannel(db, ch.bot_id as string, "instagram");
    await logDeletion(db, "contacts", contactIds, code);
    await deleteContacts(db, contactIds);
    await logDeletion(db, "instagram_channels", [ch.id as string], code);
    const { error } = await db.from("instagram_channels").delete().eq("id", ch.id);
    if (error) throw new Error(`exclusão da conexão: ${error.message}`);
  }
  return { accounts: channels?.length ?? 0, conversations, leads };
}
