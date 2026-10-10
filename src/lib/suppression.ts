import type { SupabaseClient } from "@supabase/supabase-js";
import { hmacHex } from "./hash";
import { canonicalPhone as canonicalPhoneOf } from "./phone";

/*
 * Lista de supressão (migração 0030): quem pediu para não receber mensagens iniciadas pela
 * empresa. Consultada em todo envio de modelo; a conversa normal (o contato escreve, o bot
 * responde) continua. Só hash do contato, sem conversa.
 */

export type SuppressionKind = "marketing" | "utility" | "all";
export type SuppressionChannel = "whatsapp" | "instagram";

/** Celular brasileiro sempre com o 9 (src/lib/phone.ts); BSUID e o que não é telefone vão como estão. */
export const canonicalPhone = (waId: string): string => canonicalPhoneOf(waId) ?? waId;

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

/** Categorias suprimidas e ativas de vários contatos de uma vez (público de campanha). Chave: o contato informado. */
export async function activeSuppressionsMany(db: SupabaseClient, t: { channel: SuppressionChannel; scope: string; contacts: string[] }): Promise<Map<string, SuppressionKind[]>> {
  const byHash = new Map(t.contacts.map((c) => [contactHash(t.channel, c), c]));
  const hashes = [...byHash.keys()];
  const out = new Map<string, SuppressionKind[]>();
  for (let i = 0; i < hashes.length; i += 300) {
    const { data, error } = await db.from("suppressions").select("contact_hash, kind").eq("channel", t.channel).eq("scope", t.scope).is("revoked_at", null).in("contact_hash", hashes.slice(i, i + 300));
    if (error) throw new Error(`supressão: ${error.message}`);
    for (const r of data ?? []) {
      const contact = byHash.get(r.contact_hash as string)!;
      out.set(contact, [...(out.get(contact) ?? []), r.kind as SuppressionKind]);
    }
  }
  return out;
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
  const id = (data?.id as number | undefined) ?? null;
  // webhooks: contact.opted_out (o pedido do titular e o resto de um aceite não são descadastro)
  if (id && t.reason !== "erasure" && !t.source.startsWith("optin:")) {
    const { consentSource, queueConsentEvent } = await import("./platform-events");
    await queueConsentEvent(db, { channel: t.channel, scope: t.scope, contact: t.contact, type: t.kind, source: consentSource(t.source), granted: false, key: `supp:${id}` });
  }
  return id;
}

/**
 * Novo opt-in dado pela própria pessoa: desfaz supressões ativas (todas ou só de uma categoria).
 * Devolve o que saiu (o "Foi engano" avisa os webhooks por categoria).
 */
export async function revoke(db: SupabaseClient, t: Target & { kind?: SuppressionKind; ids?: number[]; reason?: string; source: string }): Promise<Array<{ id: number; kind: SuppressionKind }>> {
  let q = db.from("suppressions").update({ revoked_at: new Date().toISOString(), revoke_source: t.source }).eq("contact_hash", contactHash(t.channel, t.contact)).eq("channel", t.channel).eq("scope", t.scope).is("revoked_at", null);
  if (t.kind) q = q.eq("kind", t.kind);
  if (t.ids?.length) q = q.in("id", t.ids);
  if (t.reason) q = q.eq("reason", t.reason);
  const { data, error } = await q.select("id, kind");
  if (error) throw new Error(`supressão: ${error.message}`);
  return (data ?? []) as Array<{ id: number; kind: SuppressionKind }>;
}

/**
 * "Foi engano": cada descadastro desfeito sai como contact.opted_in (origem chat). O de tudo volta
 * como promoções e lembretes (o tipo all só existe no descadastro).
 */
export async function queueUndoEvents(db: SupabaseClient, t: Target, undone: Array<{ id: number; kind: SuppressionKind }>): Promise<void> {
  if (!undone.length) return;
  const { queueConsentEvent } = await import("./platform-events");
  for (const u of undone) {
    for (const type of u.kind === "all" ? (["marketing", "utility"] as const) : [u.kind]) {
      await queueConsentEvent(db, { ...t, type, source: "chat", granted: true, key: `undo:${u.id}:${type}` });
    }
  }
}

/* ------------------------------------------------------------------ opt-out pelo chat */

/** Botão de descadastro dos modelos de marketing criados pelo BoaVoz (resposta rápida). */
export const OPTOUT_BUTTON_TEXT = "Parar promoções";

/**
 * SAIR, PARAR ou STOP (sozinhos, sem diferença de maiúsculas, acento ou pontuação), ou o botão
 * "Parar promoções" do modelo de marketing (vale para a categoria do último modelo, marketing).
 */
/** O toque no botão "Parar promoções" (sempre descadastro de marketing). */
export const isPromoOptOutButton = (text: string | null | undefined): boolean =>
  Boolean(text) && text!.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z]/g, "").toUpperCase() === "PARARPROMOCOES";

export function isOptOutKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z]/g, "").toUpperCase();
  return t === "SAIR" || t === "PARAR" || t === "STOP" || t === "PARARPROMOCOES";
}

/** Confirmação fixa ao contato (aba Textos legais, seção 6). */
export function optOutConfirmation(kind: SuppressionKind, company: string): string {
  const what = kind === "marketing" ? "promoções" : kind === "utility" ? "lembretes e avisos" : "promoções nem lembretes";
  return `Feito, você não vai mais receber ${what} da ${company}. O atendimento continua normal por aqui.`;
}

/** Botões que vão com a confirmação (ids lidos de volta em handleOptOutButton). */
export const OPTOUT_UNDO = "optout_undo";
export const OPTOUT_ALSO = "optout_also";
