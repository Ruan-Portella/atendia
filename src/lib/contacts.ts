import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalPhone } from "./phone";
import { hmacHex } from "./hash";

/*
 * Contatos (L1): a identidade de quem conversa com cada chatbot, por canal, achada por hash com
 * chave (nunca pelo dado em texto): telefone canônico, BSUID do WhatsApp e id do Instagram.
 *   - WhatsApp: telefone e BSUID são opcionais (pelo menos um). Busca primeiro pelo BSUID, depois
 *     pelo telefone, completando o que faltar quando a mensagem traz os dois.
 *   - Mesmo telefone com outro BSUID (sem o aviso de troca da Meta) é outra pessoa (número
 *     reciclado): contato novo, sem o vínculo, o consentimento e o 18+ do anterior.
 *   - first_inbound_at / last_inbound_at: só mensagem do próprio contato recebida pelo canal
 *     (nunca eco, status, histórico ou envio). "Já conversou" e a janela de 24 h saem daqui.
 */

export type ContactChannel = "whatsapp" | "instagram";

/** Versão da chave de hash (muda só se a chave vazar; a antiga nunca é destruída enquanto houver linha). */
export const HASH_KEY_VERSION = 1;

export const phoneHash = (canonical: string) => hmacHex(`phone:${canonical}`);
export const waUserHash = (bsuid: string) => hmacHex(`wa_user:${bsuid}`);
export const igHash = (igsid: string) => hmacHex(`ig:${igsid}`);

/** Hash do wa_id que veio da Meta (já com o DDI), ou null se não for telefone (BSUID). */
export function metaPhoneHash(waId: string | null | undefined): string | null {
  const c = canonicalPhone(waId);
  return c ? phoneHash(c) : null;
}

/** Hash do telefone digitado por alguém (lead, painel), ou null se não for telefone. */
export function typedPhoneHash(raw: string | null | undefined): string | null {
  const c = canonicalPhone(raw, { typed: true });
  return c ? phoneHash(c) : null;
}

export interface ContactRow {
  id: string;
  phone_hash: string | null;
  wa_user_hash: string | null;
  ig_hash: string | null;
  first_inbound_at: string | null;
  last_inbound_at: string | null;
}

const COLS = "id, phone_hash, wa_user_hash, ig_hash, first_inbound_at, last_inbound_at";

export interface WhatsAppIdentity {
  /** wa_id / from: telefone com DDI (some quando a pessoa usa nome de usuário). */
  phone?: string | null;
  /** BSUID (from_user_id / user_id). */
  bsuid?: string | null;
  name?: string | null;
}

/**
 * Contato do WhatsApp deste chatbot: acha pelo BSUID, depois pelo telefone; completa o que faltar;
 * cria se não existir. Número reciclado (mesmo telefone, BSUID diferente) vira contato novo e o
 * telefone sai do anterior. Service role.
 */
export async function whatsappContact(db: SupabaseClient, bot: { id: string; agency_id: string }, who: WhatsAppIdentity): Promise<ContactRow | null> {
  const canonical = canonicalPhone(who.phone);
  const ph = canonical ? phoneHash(canonical) : null;
  const uh = who.bsuid ? waUserHash(who.bsuid) : null;
  if (!ph && !uh) return null;
  const base = () => db.from("contacts").select(COLS).eq("bot_id", bot.id).eq("channel", "whatsapp");

  const byUser = uh ? (await base().eq("wa_user_hash", uh).maybeSingle<ContactRow>()).data : null;
  const byPhone = ph ? (await base().eq("phone_hash", ph).maybeSingle<ContactRow>()).data : null;

  if (byUser) {
    // achou pelo BSUID: completa o telefone (se outro contato tinha esse telefone sem BSUID, ele é o antigo registro da mesma pessoa)
    if (ph && byUser.phone_hash !== ph) {
      if (byPhone && byPhone.id !== byUser.id) await db.from("contacts").update({ phone_hash: null, updated_at: new Date().toISOString() }).eq("id", byPhone.id);
      await db.from("contacts").update({ phone_hash: ph, phone_enc: who.phone, updated_at: new Date().toISOString() }).eq("id", byUser.id);
      byUser.phone_hash = ph;
    }
    return byUser;
  }
  if (byPhone) {
    if (uh && byPhone.wa_user_hash && byPhone.wa_user_hash !== uh) {
      // mesmo telefone, outro BSUID, sem o aviso de troca: número reciclado, é outra pessoa
      await db.from("contacts").update({ phone_hash: null, updated_at: new Date().toISOString() }).eq("id", byPhone.id);
      return createContact(db, bot, "whatsapp", { phone_hash: ph, phone_enc: who.phone, wa_user_hash: uh, wa_user_enc: who.bsuid, name: who.name ?? null });
    }
    if (uh && !byPhone.wa_user_hash) {
      await db.from("contacts").update({ wa_user_hash: uh, wa_user_enc: who.bsuid, updated_at: new Date().toISOString() }).eq("id", byPhone.id);
      byPhone.wa_user_hash = uh;
    }
    return byPhone;
  }
  return createContact(db, bot, "whatsapp", { phone_hash: ph, phone_enc: who.phone ?? null, wa_user_hash: uh, wa_user_enc: who.bsuid ?? null, name: who.name ?? null });
}

/** Contato do Instagram deste chatbot (pelo IGSID); cria se não existir. Service role. */
export async function instagramContact(db: SupabaseClient, bot: { id: string; agency_id: string }, igsid: string): Promise<ContactRow | null> {
  if (!igsid) return null;
  const h = igHash(igsid);
  const { data } = await db.from("contacts").select(COLS).eq("bot_id", bot.id).eq("channel", "instagram").eq("ig_hash", h).maybeSingle<ContactRow>();
  return data ?? createContact(db, bot, "instagram", { ig_hash: h, ig_enc: igsid });
}

async function createContact(db: SupabaseClient, bot: { id: string; agency_id: string }, channel: ContactChannel, fields: Record<string, unknown>): Promise<ContactRow | null> {
  const { data, error } = await db
    .from("contacts")
    .insert({ agency_id: bot.agency_id, bot_id: bot.id, channel, hash_key_version: HASH_KEY_VERSION, ...fields })
    .select(COLS)
    .single<ContactRow>();
  if (!error) return data;
  // outra mensagem criou o mesmo contato ao mesmo tempo: usa o que ficou
  if (/duplicate|unique/i.test(error.message)) {
    const key = (["wa_user_hash", "phone_hash", "ig_hash"] as const).find((k) => fields[k]);
    if (key) return (await db.from("contacts").select(COLS).eq("bot_id", bot.id).eq("channel", channel).eq(key, fields[key] as string).maybeSingle<ContactRow>()).data;
  }
  console.error("contato não criado", error.message);
  return null;
}

/** Mensagem do próprio contato chegou pelo canal: "já conversou" e a janela de 24 h. */
export async function touchInbound(db: SupabaseClient, contact: ContactRow, at = new Date()): Promise<void> {
  const now = at.toISOString();
  await db.from("contacts").update({ last_inbound_at: now, ...(contact.first_inbound_at ? {} : { first_inbound_at: now }), updated_at: now }).eq("id", contact.id);
  contact.last_inbound_at = now;
  contact.first_inbound_at ??= now;
}

/**
 * Aviso da Meta de que a pessoa trocou de número (user_changed_user_id / user_changed_number): o
 * mesmo contato passa a ter o telefone e o BSUID novos, com o consentimento e o 18+ dele.
 */
export async function changeWhatsAppIdentity(db: SupabaseClient, botId: string, from: { phone?: string | null; bsuid?: string | null }, to: { phone?: string | null; bsuid?: string | null }): Promise<boolean> {
  const oldUser = from.bsuid ? waUserHash(from.bsuid) : null;
  const oldPhone = canonicalPhone(from.phone);
  const base = () => db.from("contacts").select("id").eq("bot_id", botId).eq("channel", "whatsapp");
  const found = (oldUser ? (await base().eq("wa_user_hash", oldUser).maybeSingle()).data : null) ?? (oldPhone ? (await base().eq("phone_hash", phoneHash(oldPhone)).maybeSingle()).data : null);
  if (!found) return false;
  const newPhone = canonicalPhone(to.phone);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (newPhone) Object.assign(patch, { phone_hash: phoneHash(newPhone), phone_enc: to.phone });
  if (to.bsuid) Object.assign(patch, { wa_user_hash: waUserHash(to.bsuid), wa_user_enc: to.bsuid });
  // quem já tinha o telefone ou o BSUID novos (contato criado antes do aviso) cede para o contato antigo
  if (patch.phone_hash) await db.from("contacts").update({ phone_hash: null }).eq("bot_id", botId).eq("channel", "whatsapp").eq("phone_hash", patch.phone_hash as string).neq("id", found.id);
  if (patch.wa_user_hash) await db.from("contacts").update({ wa_user_hash: null }).eq("bot_id", botId).eq("channel", "whatsapp").eq("wa_user_hash", patch.wa_user_hash as string).neq("id", found.id);
  const { error } = await db.from("contacts").update(patch).eq("id", found.id);
  if (error) console.error("troca de número não aplicada", error.message);
  return !error;
}

/** "User X changed from OLD to NEW" (corpo da mensagem de sistema da Meta): o BSUID antigo. */
export function previousBsuid(body: string | null | undefined): string | null {
  return body?.match(/changed from (\S+) to \S+/i)?.[1] ?? null;
}

/** Ao conectar o número em outro portfólio da Meta, os BSUIDs antigos do bot deixam de valer. */
export async function forgetBsuids(db: SupabaseClient, botId: string): Promise<void> {
  await db.from("contacts").update({ wa_user_hash: null, wa_user_enc: null, updated_at: new Date().toISOString() }).eq("bot_id", botId).eq("channel", "whatsapp").not("wa_user_hash", "is", null);
}

/** Um id do WhatsApp guardado sozinho (wa_id antigo, destino do eco): telefone ou BSUID? */
export const whatsappIdentityOf = (id: string): WhatsAppIdentity => (/[a-z]/i.test(id) ? { bsuid: id } : { phone: id });

/**
 * Conversas de antes dos contatos (sem contact_id): ganham a ficha do contato, em lotes (rotina
 * diária). As que têm movimento já se ligam sozinhas na próxima mensagem. Service role.
 */
export async function linkLegacyConversations(db: SupabaseClient, limit = 300): Promise<{ linked: number; left: boolean }> {
  const { data: convs, error } = await db
    .from("conversations")
    .select("id, bot_id, channel, wa_id, ig_id, bots!inner(agency_id)")
    .is("contact_id", null)
    .in("channel", ["whatsapp", "instagram"])
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  let linked = 0;
  for (const c of convs ?? []) {
    const b = (Array.isArray(c.bots) ? c.bots[0] : c.bots) as { agency_id: string } | null;
    if (!b) continue;
    const bot = { id: c.bot_id as string, agency_id: b.agency_id };
    const contact = c.channel === "whatsapp" && c.wa_id ? await whatsappContact(db, bot, whatsappIdentityOf(c.wa_id as string)) : c.channel === "instagram" && c.ig_id ? await instagramContact(db, bot, c.ig_id as string) : null;
    if (!contact) continue;
    await db.from("conversations").update({ contact_id: contact.id }).eq("id", c.id);
    linked++;
  }
  return { linked, left: (convs?.length ?? 0) === limit };
}
