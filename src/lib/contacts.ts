import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalPhone } from "./phone";
import { hmacHex } from "./hash";
import { openNullable, sealField, sealNullable, scopeOfBot, type CipherField } from "./field-cipher";
export { normalizeTags } from "./tags";

/*
 * Contatos (L1): a identidade de quem conversa com cada chatbot, por canal, achada por hash com
 * chave (nunca pelo dado em texto): telefone canônico, BSUID do WhatsApp e id do Instagram.
 *   - WhatsApp: telefone e BSUID são opcionais (pelo menos um). Busca primeiro pelo BSUID, depois
 *     pelo telefone, completando o que faltar quando a mensagem traz os dois.
 *   - Mesmo telefone com outro BSUID (sem o aviso de troca da Meta) é outra pessoa (número
 *     reciclado): contato novo, sem o vínculo, o consentimento e o 18+ do anterior.
 *   - first_inbound_at / last_inbound_at: só mensagem do próprio contato recebida pelo canal
 *     (nunca eco, status, histórico ou envio). "Já conversou" e a janela de 24 h saem daqui.
 * Camada única: toda leitura e gravação da tabela contacts passa por este arquivo. As colunas
 * _enc vão cifradas com a chave do cliente dono do chatbot (field-cipher.ts, leva S); a busca é
 * pelos hashes. Um teste confere que ninguém usa a tabela direto.
 */

const enc = async (field: CipherField, botId: string, v: string | null | undefined) => sealNullable(field, v, await scopeOfBot(botId));
const phoneEnc = (botId: string, v: string | null | undefined) => enc("contacts.phone_enc", botId, v);
const waUserEnc = (botId: string, v: string | null | undefined) => enc("contacts.wa_user_enc", botId, v);
const igEnc = (botId: string, v: string | null | undefined) => enc("contacts.ig_enc", botId, v);
const externalEnc = (botId: string, v: string | null | undefined) => enc("contacts.external_id_enc", botId, v);

export type ContactChannel = "whatsapp" | "instagram";

/** Versão da chave de hash (muda só se a chave vazar; a antiga nunca é destruída enquanto houver linha). */
export const HASH_KEY_VERSION = 1;

export const phoneHash = (canonical: string) => hmacHex(`phone:${canonical}`);
export const waUserHash = (bsuid: string) => hmacHex(`wa_user:${bsuid}`);
export const igHash = (igsid: string) => hmacHex(`ig:${igsid}`);
/** external_id que a empresa usa para a pessoa (token do widget, pareamento). */
export const externalIdHash = (externalId: string) => hmacHex(`external:${externalId}`);

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
  /** Aviso de indisponível já enviado neste episódio (zera quando volta ao normal). */
  unavailable_notice_reason?: string | null;
  /** A oferta de novidades já foi feita (leva B3: uma vez por contato). */
  marketing_offer_at?: string | null;
}

const COLS = "id, phone_hash, wa_user_hash, ig_hash, first_inbound_at, last_inbound_at, unavailable_notice_reason, marketing_offer_at";

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
      await db.from("contacts").update({ phone_hash: ph, phone_enc: await phoneEnc(bot.id, who.phone), updated_at: new Date().toISOString() }).eq("id", byUser.id);
      byUser.phone_hash = ph;
    }
    return byUser;
  }
  if (byPhone) {
    if (uh && byPhone.wa_user_hash && byPhone.wa_user_hash !== uh) {
      // mesmo telefone, outro BSUID, sem o aviso de troca: número reciclado, é outra pessoa
      await db.from("contacts").update({ phone_hash: null, updated_at: new Date().toISOString() }).eq("id", byPhone.id);
      return createContact(db, bot, "whatsapp", { phone_hash: ph, phone_enc: await phoneEnc(bot.id, who.phone), wa_user_hash: uh, wa_user_enc: await waUserEnc(bot.id, who.bsuid), name: who.name ?? null });
    }
    if (uh && !byPhone.wa_user_hash) {
      await db.from("contacts").update({ wa_user_hash: uh, wa_user_enc: await waUserEnc(bot.id, who.bsuid), updated_at: new Date().toISOString() }).eq("id", byPhone.id);
      byPhone.wa_user_hash = uh;
    }
    return byPhone;
  }
  return createContact(db, bot, "whatsapp", { phone_hash: ph, phone_enc: await phoneEnc(bot.id, who.phone), wa_user_hash: uh, wa_user_enc: await waUserEnc(bot.id, who.bsuid), name: who.name ?? null });
}

/** Contato do Instagram deste chatbot (pelo IGSID); cria se não existir. Service role. */
export async function instagramContact(db: SupabaseClient, bot: { id: string; agency_id: string }, igsid: string): Promise<ContactRow | null> {
  if (!igsid) return null;
  const h = igHash(igsid);
  const { data } = await db.from("contacts").select(COLS).eq("bot_id", bot.id).eq("channel", "instagram").eq("ig_hash", h).maybeSingle<ContactRow>();
  return data ?? createContact(db, bot, "instagram", { ig_hash: h, ig_enc: await igEnc(bot.id, igsid) });
}

/**
 * Contato identificado do widget (P2): achado pelo external_id do token, criado na primeira vez;
 * o display ({"name": "Ruan"}) acompanha o que o token mais novo mandou. Service role.
 */
export async function widgetUserContact(db: SupabaseClient, bot: { id: string; agency_id: string }, externalId: string, display: Record<string, unknown> | null): Promise<ContactRow | null> {
  const h = externalIdHash(externalId);
  const { data } = await db.from("contacts").select(`${COLS}, display`).eq("bot_id", bot.id).eq("channel", "widget").eq("external_id_hash", h).maybeSingle<ContactRow & { display: unknown }>();
  if (data) {
    if (display && JSON.stringify(display) !== JSON.stringify(data.display)) await db.from("contacts").update({ display, updated_at: new Date().toISOString() }).eq("id", data.id);
    return data;
  }
  return createContact(db, bot, "widget", { external_id_hash: h, external_id_enc: await externalEnc(bot.id, externalId), display });
}

/** Vínculo ativo do contato (pareamento): o último pareado ou usado. */
export async function contactActiveLinkId(db: SupabaseClient, contactId: string): Promise<string | null> {
  const { data } = await db.from("contacts").select("active_link_id").eq("id", contactId).maybeSingle();
  return (data?.active_link_id as string | null) ?? null;
}

/** Marca o vínculo ativo (e o display que veio com ele, para o painel). */
export async function setActiveLink(db: SupabaseClient, contactId: string, linkId: string | null, display: Record<string, unknown> | object | null): Promise<void> {
  const { error } = await db.from("contacts").update({ active_link_id: linkId, ...(display ? { display } : {}), updated_at: new Date().toISOString() }).eq("id", contactId);
  if (error) console.error("contato: vínculo ativo não gravado", error.message);
}

/** Identificadores do contato no canal (abertos): telefone, BSUID e IGSID, para os webhooks. */
export async function contactChannelIds(db: SupabaseClient, contactId: string): Promise<{ phone: string | null; bsuid: string | null; igsid: string | null }> {
  const { data } = await db.from("contacts").select("phone_enc, wa_user_enc, ig_enc").eq("id", contactId).maybeSingle();
  const [phone, bsuid, igsid] = await Promise.all([openNullable("contacts.phone_enc", data?.phone_enc), openNullable("contacts.wa_user_enc", data?.wa_user_enc), openNullable("contacts.ig_enc", data?.ig_enc)]);
  return { phone, bsuid, igsid };
}

/** Telefone do contato do WhatsApp, quando conhecido (null com só o BSUID). */
export async function contactPhone(db: SupabaseClient, contactId: string): Promise<string | null> {
  const { data } = await db.from("contacts").select("phone_enc").eq("id", contactId).maybeSingle();
  return openNullable("contacts.phone_enc", data?.phone_enc);
}

/** Nome que a empresa mandou para o contato identificado (display.name), para o painel. */
export async function contactDisplayName(db: SupabaseClient, contactId: string): Promise<string | null> {
  const { data } = await db.from("contacts").select("display").eq("id", contactId).maybeSingle();
  const name = (data?.display as { name?: unknown } | null)?.name;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : null;
}

/** external_id do contato (para as ações e os webhooks). */
export async function contactExternalId(db: SupabaseClient, contactId: string): Promise<string | null> {
  const { data } = await db.from("contacts").select("external_id_enc").eq("id", contactId).maybeSingle();
  return openNullable("contacts.external_id_enc", data?.external_id_enc);
}

async function createContact(db: SupabaseClient, bot: { id: string; agency_id: string }, channel: ContactChannel | "widget", fields: Record<string, unknown>): Promise<ContactRow | null> {
  const { data, error } = await db
    .from("contacts")
    .insert({ agency_id: bot.agency_id, bot_id: bot.id, channel, hash_key_version: HASH_KEY_VERSION, ...fields })
    .select(COLS)
    .single<ContactRow>();
  if (!error) return data;
  // outra mensagem criou o mesmo contato ao mesmo tempo: usa o que ficou
  if (/duplicate|unique/i.test(error.message)) {
    const key = (["wa_user_hash", "phone_hash", "ig_hash", "external_id_hash"] as const).find((k) => fields[k]);
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
  if (newPhone) Object.assign(patch, { phone_hash: phoneHash(newPhone), phone_enc: await phoneEnc(botId, to.phone) });
  if (to.bsuid) Object.assign(patch, { wa_user_hash: waUserHash(to.bsuid), wa_user_enc: await waUserEnc(botId, to.bsuid) });
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

/** Quando chegou a última mensagem do próprio contato (janela de 24 h da Meta), ou null. */
export async function contactLastInbound(db: SupabaseClient, contactId: string): Promise<string | null> {
  const { data } = await db.from("contacts").select("last_inbound_at").eq("id", contactId).maybeSingle();
  return (data?.last_inbound_at as string | null | undefined) ?? null;
}

/** Motivo do aviso de indisponível já enviado ao contato neste episódio, ou null. */
export async function contactNoticeReason(db: SupabaseClient, contactId: string): Promise<string | null> {
  const { data } = await db.from("contacts").select("unavailable_notice_reason").eq("id", contactId).maybeSingle();
  return (data?.unavailable_notice_reason as string | null | undefined) ?? null;
}

/** Grava (ou zera, com reason null) a marca do aviso de indisponível no contato. */
export async function setContactNotice(db: SupabaseClient, contactId: string, reason: string | null): Promise<void> {
  const q = db.from("contacts").update({ unavailable_notice_at: reason ? new Date().toISOString() : null, unavailable_notice_reason: reason }).eq("id", contactId);
  await (reason ? q : q.not("unavailable_notice_reason", "is", null));
}

/* ------------------------------------------------------------------ API pública: {contact} nas rotas */

/** {contact} das rotas da API (spec "Formatos de payload", "Contato em rotas"). */
export type ContactAddress =
  | { kind: "id"; id: string }
  | { kind: "phone"; phone: string }
  | { kind: "wa"; bsuid: string }
  | { kind: "ig"; igsid: string }
  | { kind: "ext"; externalId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ctc_<id>, phone:<número> (forma canônica), wa:<BSUID>, ig:<id> ou ext:<id externo>; null se inválido. Função pura. */
export function parseContactAddress(raw: string): ContactAddress | null {
  const v = raw.trim();
  if (v.startsWith("ctc_")) return UUID.test(v.slice(4)) ? { kind: "id", id: v.slice(4).toLowerCase() } : null;
  const m = /^(phone|wa|ig|ext):(.{1,128})$/.exec(v);
  if (!m || !m[2].trim()) return null;
  const value = m[2].trim();
  if (m[1] === "phone") {
    const c = canonicalPhone(value, { typed: true });
    return c ? { kind: "phone", phone: c } : null;
  }
  if (m[1] === "wa") return { kind: "wa", bsuid: value };
  if (m[1] === "ig") return { kind: "ig", igsid: value };
  return { kind: "ext", externalId: value };
}

/** Contato achado pela API, com as identidades do canal abertas (para a idade e o portão). */
export interface ApiContact {
  id: string;
  bot_id: string;
  channel: "widget" | "whatsapp" | "instagram";
  phone: string | null;
  bsuid: string | null;
  igsid: string | null;
}


/**
 * Contatos destes chatbots (os do escopo da chave) por um {contact} da API. ext: (id externo)
 * acha os contatos do widget com aquele external_id e os do WhatsApp e do Instagram com vínculo
 * ativo a ele (pareamento).
 */
export async function apiContacts(db: SupabaseClient, botIds: string[], addr: ContactAddress): Promise<ApiContact[]> {
  if (!botIds.length) return [];
  const base = db.from("contacts").select("id, bot_id, channel, phone_enc, wa_user_enc, ig_enc").in("bot_id", botIds);
  let linked: string[] = [];
  if (addr.kind === "ext") {
    const h = externalIdHash(addr.externalId);
    const { data: links } = await db.from("contact_links").select("contact_id").in("bot_id", botIds).eq("external_id_hash", h).is("unlinked_at", null);
    linked = [...new Set((links ?? []).map((l) => l.contact_id as string))];
  }
  const q =
    addr.kind === "ext"
      ? linked.length
        ? base.or(`external_id_hash.eq.${externalIdHash(addr.externalId)},id.in.(${linked.join(",")})`)
        : base.eq("external_id_hash", externalIdHash(addr.externalId))
      : addr.kind === "id"
      ? base.eq("id", addr.id)
      : addr.kind === "phone"
        ? base.eq("channel", "whatsapp").eq("phone_hash", phoneHash(addr.phone))
        : addr.kind === "wa"
          ? base.eq("channel", "whatsapp").eq("wa_user_hash", waUserHash(addr.bsuid))
          : base.eq("channel", "instagram").eq("ig_hash", igHash(addr.igsid));
  const { data, error } = await q.limit(50);
  if (error) throw new Error(`contatos da API: ${error.message}`);
  return Promise.all(
    (data ?? []).map(async (r) => ({
      id: r.id as string,
      bot_id: r.bot_id as string,
      channel: r.channel as ApiContact["channel"],
      phone: await openNullable("contacts.phone_enc", r.phone_enc),
      bsuid: await openNullable("contacts.wa_user_enc", r.wa_user_enc),
      igsid: await openNullable("contacts.ig_enc", r.ig_enc),
    })),
  );
}

/** Fichas para o pedido de exclusão (LGPD), nestes chatbots: pelo e-mail ou pelo hash do telefone. */
export async function findContactIds(db: SupabaseClient, botIds: string[], by: { email: string } | { phoneHash: string }): Promise<string[]> {
  const base = db.from("contacts").select("id").in("bot_id", botIds);
  const { data } = await ("email" in by ? base.ilike("email", by.email) : base.eq("phone_hash", by.phoneHash));
  return (data ?? []).map((c) => c.id as string);
}

/**
 * Retenção: fichas deste chatbot paradas desde antes do corte (criação, última mensagem recebida e
 * última alteração), sem conversa e sem vínculo ativo, com o canal e os identificadores abertos
 * (para apagar o 18+ junto). Página por id (after), para não voltar sempre às mesmas fichas.
 */
export async function retentionContacts(db: SupabaseClient, botId: string, cutoff: string, opts: { after?: string; limit?: number } = {}): Promise<{ rows: Array<{ id: string; channel: ContactChannel | "widget"; ids: string[] }>; last: string | null }> {
  let q = db.from("contacts").select("id, channel, phone_enc, wa_user_enc, ig_enc").eq("bot_id", botId).lt("created_at", cutoff).lt("updated_at", cutoff).or(`last_inbound_at.is.null,last_inbound_at.lt."${cutoff}"`);
  if (opts.after) q = q.gt("id", opts.after);
  const { data, error } = await q.order("id").limit(opts.limit ?? 200);
  if (error) throw new Error(`retenção dos contatos: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const ids = rows.map((r) => r.id as string);
  if (!ids.length) return { rows: [], last: null };
  const [{ data: convs }, { data: links }] = await Promise.all([
    db.from("conversations").select("contact_id").in("contact_id", ids),
    db.from("contact_links").select("contact_id").in("contact_id", ids).is("unlinked_at", null),
  ]);
  const busy = new Set([...(convs ?? []), ...(links ?? [])].map((r) => r.contact_id as string));
  const free = await Promise.all(
    rows
      .filter((r) => !busy.has(r.id as string))
      .map(async (r) => ({
        id: r.id as string,
        channel: r.channel as ContactChannel | "widget",
        ids: (await Promise.all([openNullable("contacts.phone_enc", r.phone_enc), openNullable("contacts.wa_user_enc", r.wa_user_enc), openNullable("contacts.ig_enc", r.ig_enc)])).filter((v): v is string => Boolean(v)),
      })),
  );
  return { rows: free, last: rows.length === (opts.limit ?? 200) ? ids[ids.length - 1] : null };
}

export interface ErasureContact {
  id: string;
  botId: string;
  channel: ContactChannel | "widget";
  phone: string | null;
  bsuid: string | null;
  igsid: string | null;
  externalId: string | null;
  lastInboundAt: string | null;
}

/** Pedido do titular: as fichas com os identificadores abertos (supressão, 18+, aviso e contact.deleted). */
export async function contactsForErasure(db: SupabaseClient, ids: string[]): Promise<ErasureContact[]> {
  if (!ids.length) return [];
  const { data, error } = await db.from("contacts").select("id, bot_id, channel, phone_enc, wa_user_enc, ig_enc, external_id_enc, last_inbound_at").in("id", ids);
  if (error) throw new Error(`contatos do pedido: ${error.message}`);
  return Promise.all(
    ((data ?? []) as Array<Record<string, unknown>>).map(async (r) => ({
      id: r.id as string,
      botId: r.bot_id as string,
      channel: r.channel as ContactChannel | "widget",
      phone: await openNullable("contacts.phone_enc", r.phone_enc),
      bsuid: await openNullable("contacts.wa_user_enc", r.wa_user_enc),
      igsid: await openNullable("contacts.ig_enc", r.ig_enc),
      externalId: await openNullable("contacts.external_id_enc", r.external_id_enc),
      lastInboundAt: (r.last_inbound_at as string | null) ?? null,
    })),
  );
}

/** Exportação dos dados do negócio: uma página de fichas destes chatbots, abertas (por id, depois de `after`). */
export async function exportContactsPage(db: SupabaseClient, botIds: string[], after: string | null, limit = 500): Promise<Array<Record<string, string | null>>> {
  if (!botIds.length) return [];
  let q = db.from("contacts").select("id, bot_id, channel, phone_enc, wa_user_enc, ig_enc, external_id_enc, name, email, first_inbound_at, last_inbound_at, created_at").in("bot_id", botIds);
  if (after) q = q.gt("id", after);
  const { data, error } = await q.order("id").limit(limit);
  if (error) throw new Error(`exportação dos contatos: ${error.message}`);
  return Promise.all(
    ((data ?? []) as Array<Record<string, unknown>>).map(async (r) => ({
      id: r.id as string,
      bot_id: r.bot_id as string,
      channel: r.channel as string,
      phone: await openNullable("contacts.phone_enc", r.phone_enc),
      whatsapp_user_id: await openNullable("contacts.wa_user_enc", r.wa_user_enc),
      instagram_id: await openNullable("contacts.ig_enc", r.ig_enc),
      external_id: await openNullable("contacts.external_id_enc", r.external_id_enc),
      name: (r.name as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      first_inbound_at: (r.first_inbound_at as string | null) ?? null,
      last_inbound_at: (r.last_inbound_at as string | null) ?? null,
      created_at: r.created_at as string,
    })),
  );
}

/** Todas as fichas de um canal de um chatbot (ex.: a conta do Instagram desconectada pela Meta). */
export async function contactIdsOfChannel(db: SupabaseClient, botId: string, channel: ContactChannel): Promise<string[]> {
  const { data } = await db.from("contacts").select("id").eq("bot_id", botId).eq("channel", channel);
  return (data ?? []).map((c) => c.id as string);
}

/** Apaga fichas (quem chama já gravou no registro de exclusões); botIds limita a estes chatbots. */
export async function deleteContacts(db: SupabaseClient, ids: string[], botIds?: string[]): Promise<void> {
  if (!ids.length) return;
  const q = db.from("contacts").delete().in("id", ids);
  const { error } = await (botIds ? q.in("bot_id", botIds) : q);
  if (error) throw new Error(`exclusão de contatos: ${error.message}`);
}

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

/* ------------------------------------------------------------------ recifra do histórico (leva S) */

const PLAIN_CONTACT = "phone_enc.not.like.v2.*,wa_user_enc.not.like.v2.*,ig_enc.not.like.v2.*,external_id_enc.not.like.v2.*";
const CONTACT_FIELDS = [
  ["phone_enc", "contacts.phone_enc"],
  ["wa_user_enc", "contacts.wa_user_enc"],
  ["ig_enc", "contacts.ig_enc"],
  ["external_id_enc", "contacts.external_id_enc"],
] as const;

/** Contatos com algum identificador ainda sem cifra. */
export async function countPlainContacts(db: SupabaseClient): Promise<number> {
  const { count } = await db.from("contacts").select("id", { count: "exact", head: true }).or(PLAIN_CONTACT);
  return count ?? 0;
}

/** Cifra um lote de contatos antigos com a chave do cliente dono do chatbot. */
export async function reencryptContacts(db: SupabaseClient, limit = 300): Promise<number> {
  const { data, error } = await db.from("contacts").select("id, bot_id, phone_enc, wa_user_enc, ig_enc, external_id_enc").or(PLAIN_CONTACT).order("id").limit(limit);
  if (error) throw new Error(`recifra dos contatos: ${error.message}`);
  let done = 0;
  for (const r of data ?? []) {
    const scope = await scopeOfBot(String(r.bot_id));
    const patch: Record<string, string> = {};
    for (const [col, field] of CONTACT_FIELDS) {
      const v = r[col] as string | null;
      if (v && !v.startsWith("v2.")) patch[col] = await sealField(field, v, scope);
    }
    if (!Object.keys(patch).length) continue;
    const { error: upErr } = await db.from("contacts").update(patch).eq("id", r.id);
    if (!upErr) done++;
  }
  return done;
}

/** A oferta de novidades saiu para este contato (leva B3: uma vez por contato). */
export async function markMarketingOffer(db: SupabaseClient, contactId: string): Promise<void> {
  await db.from("contacts").update({ marketing_offer_at: new Date().toISOString() }).eq("id", contactId);
}

/* ------------------------------------------------------------------ aba Contatos do cliente (leva B3) */

export interface ContactListRow {
  id: string;
  bot_id: string;
  channel: string;
  name: string | null;
  tags: string[];
  phone: string | null;
  instagram: string | null;
  last_inbound_at: string | null;
  created_at: string;
}

export interface ContactPanelRow extends ContactListRow {
  bsuid: string | null;
  email: string | null;
  first_inbound_at: string | null;
  marketing_offer_at: string | null;
}

const LIST_COLS = "id, bot_id, channel, name, tags, phone_enc, ig_enc, last_inbound_at, created_at";

async function listRow(r: Record<string, unknown>): Promise<ContactListRow> {
  return {
    id: r.id as string,
    bot_id: r.bot_id as string,
    channel: r.channel as string,
    name: (r.name as string | null) ?? null,
    tags: (r.tags as string[] | null) ?? [],
    phone: await openNullable("contacts.phone_enc", r.phone_enc),
    instagram: await openNullable("contacts.ig_enc", r.ig_enc),
    last_inbound_at: (r.last_inbound_at as string | null) ?? null,
    created_at: r.created_at as string,
  };
}

/**
 * Contatos dos chatbots de um cliente, os de mensagem mais recente primeiro. A busca é pelo nome
 * (em texto) ou pelo telefone (pelo hash: o número nunca é buscado em texto); a etiqueta é exata.
 */
export async function listClientContacts(db: SupabaseClient, o: { botIds: string[]; q?: string | null; channel?: string | null; tag?: string | null; page?: number; limit?: number }): Promise<{ rows: ContactListRow[]; more: boolean }> {
  if (!o.botIds.length) return { rows: [], more: false };
  const limit = o.limit ?? 50;
  const from = Math.max(0, o.page ?? 0) * limit;
  let q = db.from("contacts").select(LIST_COLS).in("bot_id", o.botIds);
  if (o.channel) q = q.eq("channel", o.channel);
  if (o.tag) q = q.contains("tags", [o.tag]);
  const term = (o.q ?? "").trim();
  if (term) {
    const ph = term.replace(/\D/g, "").length >= 8 ? typedPhoneHash(term) : null;
    if (ph) q = q.eq("phone_hash", ph);
    else {
      const clean = term.replace(/[%_*,()\\]/g, " ").trim();
      if (clean) q = q.ilike("name", `%${clean}%`);
    }
  }
  const { data, error } = await q.order("last_inbound_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).range(from, from + limit);
  if (error) throw new Error(`contatos: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return { rows: await Promise.all(rows.slice(0, limit).map(listRow)), more: rows.length > limit };
}

/** Etiquetas já usadas nos contatos do cliente (para o filtro), em ordem alfabética. */
export async function clientContactTags(db: SupabaseClient, botIds: string[]): Promise<string[]> {
  if (!botIds.length) return [];
  const { data } = await db.from("contacts").select("tags").in("bot_id", botIds).not("tags", "eq", "{}").limit(2000);
  const all = new Set<string>();
  for (const r of data ?? []) for (const t of (r.tags as string[] | null) ?? []) all.add(t);
  return [...all].sort((a, b) => a.localeCompare(b, "pt-BR")).slice(0, 200);
}

/** Um contato para o painel, só se for de um dos chatbots informados. */
export async function contactForPanel(db: SupabaseClient, id: string, botIds: string[]): Promise<ContactPanelRow | null> {
  if (!botIds.length) return null;
  const { data } = await db.from("contacts").select(`${LIST_COLS}, wa_user_enc, email, first_inbound_at, marketing_offer_at`).eq("id", id).in("bot_id", botIds).maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    ...(await listRow(r)),
    bsuid: await openNullable("contacts.wa_user_enc", r.wa_user_enc),
    email: (r.email as string | null) ?? null,
    first_inbound_at: (r.first_inbound_at as string | null) ?? null,
    marketing_offer_at: (r.marketing_offer_at as string | null) ?? null,
  };
}

/** Troca as etiquetas do contato (só de um dos chatbots informados). */
export async function setContactTags(db: SupabaseClient, id: string, botIds: string[], tags: string[]): Promise<boolean> {
  if (!botIds.length) return false;
  const { data, error } = await db.from("contacts").update({ tags, updated_at: new Date().toISOString() }).eq("id", id).in("bot_id", botIds).select("id");
  if (error) throw new Error(`contatos: ${error.message}`);
  return Boolean(data?.length);
}

/**
 * Planilha (leva B3): contatos do WhatsApp de um chatbot pelo telefone canônico. Cria quem não
 * existe (sem "já conversou": a pessoa ainda não escreveu) e completa quem existe (nome só se
 * estava vazio; etiquetas somadas). Em lotes, para caber no tempo de uma requisição.
 */
export async function importWhatsAppContacts(db: SupabaseClient, bot: { id: string; agency_id: string }, rows: Array<{ phone: string; name: string | null; tags: string[] }>): Promise<{ ids: Map<string, string>; created: number; updated: number }> {
  const ids = new Map<string, string>();
  const byHash = new Map(rows.map((r) => [phoneHash(r.phone), r]));
  const hashes = [...byHash.keys()];
  const existing = new Map<string, { id: string; name: string | null; tags: string[] }>();
  for (let i = 0; i < hashes.length; i += 300) {
    const { data, error } = await db.from("contacts").select("id, phone_hash, name, tags").eq("bot_id", bot.id).eq("channel", "whatsapp").in("phone_hash", hashes.slice(i, i + 300));
    if (error) throw new Error(`contatos: ${error.message}`);
    for (const c of data ?? []) existing.set(c.phone_hash as string, { id: c.id as string, name: (c.name as string | null) ?? null, tags: (c.tags as string[] | null) ?? [] });
  }

  // novos: o telefone vai cifrado com a chave do cliente (uma busca da chave para o lote todo)
  const scope = await scopeOfBot(bot.id);
  const fresh = hashes.filter((h) => !existing.has(h));
  let created = 0;
  for (let i = 0; i < fresh.length; i += 200) {
    const chunk = await Promise.all(
      fresh.slice(i, i + 200).map(async (h) => {
        const r = byHash.get(h)!;
        return { agency_id: bot.agency_id, bot_id: bot.id, channel: "whatsapp", hash_key_version: HASH_KEY_VERSION, phone_hash: h, phone_enc: await sealNullable("contacts.phone_enc", r.phone, scope), name: r.name, tags: r.tags };
      }),
    );
    const { data, error } = await db.from("contacts").insert(chunk).select("id, phone_hash");
    if (error) throw new Error(`contatos: ${error.message}`);
    for (const c of data ?? []) ids.set(byHash.get(c.phone_hash as string)!.phone, c.id as string);
    created += data?.length ?? 0;
  }

  // existentes: só o que muda (nome vazio, etiqueta nova), 20 de cada vez
  let updated = 0;
  const changes: Array<{ id: string; patch: Record<string, unknown> }> = hashes
    .filter((h) => existing.has(h))
    .map((h) => {
      const r = byHash.get(h)!;
      const c = existing.get(h)!;
      ids.set(r.phone, c.id);
      const tags = [...c.tags, ...r.tags.filter((t) => !c.tags.some((x) => x.toLowerCase() === t.toLowerCase()))].slice(0, 20);
      const name = !c.name && r.name ? r.name : null;
      const patch: Record<string, unknown> = { tags, ...(name ? { name } : {}), updated_at: new Date().toISOString() };
      return tags.length !== c.tags.length || name ? { id: c.id, patch } : null;
    })
    .filter((x) => x !== null);
  for (let i = 0; i < changes.length; i += 20) {
    await Promise.all(changes.slice(i, i + 20).map(async (c) => {
      const { error } = await db.from("contacts").update(c.patch).eq("id", c.id);
      if (error) throw new Error(`contatos: ${error.message}`);
    }));
    updated += changes.slice(i, i + 20).length;
  }
  return { ids, created, updated };
}
