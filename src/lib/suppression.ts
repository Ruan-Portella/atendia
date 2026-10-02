import type { SupabaseClient } from "@supabase/supabase-js";
import { waIdVariants } from "./whatsapp";
import { hmacHex } from "./hash";

/*
 * Lista de supressão (migração 0030): quem pediu para não receber mensagens iniciadas pela
 * empresa. Consultada em todo envio de modelo; a conversa normal (o contato escreve, o bot
 * responde) continua. Só hash do contato, sem conversa.
 */

export type SuppressionKind = "marketing" | "utility" | "all";
export type SuppressionChannel = "whatsapp" | "instagram";

/** Celular brasileiro sempre com o 9: o mesmo contato com e sem o 9 vira um hash só. */
export function canonicalPhone(waId: string): string {
  const v = waIdVariants(waId);
  return v.find((x) => x.length === 13) ?? v[0];
}

export function contactHash(channel: SuppressionChannel, contact: string): string {
  const id = channel === "whatsapp" ? canonicalPhone(contact) : contact;
  return hmacHex(`${channel}:${id}`);
}

/** Escopo da supressão: o número do negócio (WABA) quando existe; senão, o bot. */
export const suppressionScope = (s: { wabaId?: string | null; botId: string }) => (s.wabaId ? `waba:${s.wabaId}` : `bot:${s.botId}`);

interface Target {
  channel: SuppressionChannel;
  scope: string;
  contact: string;
}

/** Categorias suprimidas e ativas para o contato (vazio = pode receber). */
export async function activeSuppressions(db: SupabaseClient, t: Target): Promise<Array<{ id: number; kind: SuppressionKind }>> {
  const { data, error } = await db.from("suppressions").select("id, kind").eq("contact_hash", contactHash(t.channel, t.contact)).eq("channel", t.channel).eq("scope", t.scope).is("revoked_at", null);
  if (error) throw new Error(`supressão: ${error.message}`);
  return (data ?? []) as Array<{ id: number; kind: SuppressionKind }>;
}

/** O contato pode receber um modelo dessa categoria? (MARKETING, UTILITY, …) */
export function blocks(kinds: SuppressionKind[], templateCategory: string): boolean {
  const c = templateCategory.toUpperCase();
  return kinds.some((k) => k === "all" || (k === "marketing" && c === "MARKETING") || (k === "utility" && c !== "MARKETING"));
}

export async function suppress(db: SupabaseClient, t: Target & { kind: SuppressionKind; reason: string; source: string }): Promise<number | null> {
  // idempotente: já existe pedido ativo da mesma categoria (ex.: o evento foi reprocessado)? usa ele
  const { data: existing } = await db
    .from("suppressions")
    .select("id")
    .eq("contact_hash", contactHash(t.channel, t.contact))
    .eq("channel", t.channel)
    .eq("scope", t.scope)
    .eq("kind", t.kind)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id as number;
  const { data, error } = await db
    .from("suppressions")
    .insert({ contact_hash: contactHash(t.channel, t.contact), channel: t.channel, scope: t.scope, kind: t.kind, reason: t.reason, source: t.source })
    .select("id")
    .single();
  if (error) throw new Error(`supressão: ${error.message}`);
  return (data?.id as number | undefined) ?? null;
}

/** Novo opt-in dado pela própria pessoa: desfaz supressões ativas (todas ou só de uma categoria). */
export async function revoke(db: SupabaseClient, t: Target & { kind?: SuppressionKind; ids?: number[]; reason?: string; source: string }) {
  let q = db.from("suppressions").update({ revoked_at: new Date().toISOString(), revoke_source: t.source }).eq("contact_hash", contactHash(t.channel, t.contact)).eq("channel", t.channel).eq("scope", t.scope).is("revoked_at", null);
  if (t.kind) q = q.eq("kind", t.kind);
  if (t.ids?.length) q = q.in("id", t.ids);
  if (t.reason) q = q.eq("reason", t.reason);
  const { error } = await q;
  if (error) throw new Error(`supressão: ${error.message}`);
}

/* ------------------------------------------------------------------ opt-out pelo chat */

/** SAIR, PARAR ou STOP (sozinhos, sem diferença de maiúsculas, acento ou pontuação). */
export function isOptOutKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z]/g, "").toUpperCase();
  return t === "SAIR" || t === "PARAR" || t === "STOP";
}

/** Confirmação fixa ao contato (aba Textos legais, seção 6). */
export function optOutConfirmation(kind: SuppressionKind, company: string): string {
  const what = kind === "marketing" ? "promoções" : kind === "utility" ? "lembretes e avisos" : "promoções nem lembretes";
  return `Feito, você não vai mais receber ${what} da ${company}. O atendimento continua normal por aqui.`;
}

/** Botões que vão com a confirmação (ids lidos de volta em handleOptOutButton). */
export const OPTOUT_UNDO = "optout_undo";
export const OPTOUT_ALSO = "optout_also";
