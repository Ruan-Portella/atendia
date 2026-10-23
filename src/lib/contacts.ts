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
  /** quando a foto foi buscada (Instagram) */
  avatar_at?: string | null;
}

const COLS = "id, phone_hash, wa_user_hash, ig_hash, first_inbound_at, last_inbound_at, unavailable_notice_reason, marketing_offer_at, avatar_at";

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

/**
 * Marca o vínculo ativo (e o display que veio com ele, para o painel). Sem vínculo nenhum, o nome
 * da identificação sai da ficha (23/10/2026: ficava preso depois do "Sou outra pessoa"), e o painel volta
 * ao nome do perfil; no chat do site, o display vem do token da empresa e fica.
 */
export async function setActiveLink(db: SupabaseClient, contactId: string, linkId: string | null, display: Record<string, unknown> | object | null): Promise<void> {
  const { error } = await db.from("contacts").update({ active_link_id: linkId, ...(display ? { display } : {}), updated_at: new Date().toISOString() }).eq("id", contactId);
  if (error) console.error("contato: vínculo ativo não gravado", error.message);
  if (!linkId) await db.from("contacts").update({ display: null }).eq("id", contactId).neq("channel", "widget");
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

/** O contato já tem telefone (o do WhatsApp, ou o que a pessoa compartilhou pelo botão)? */
export async function contactHasPhone(db: SupabaseClient, contactId: string): Promise<boolean> {
  const { data } = await db.from("contacts").select("phone_hash").eq("id", contactId).maybeSingle();
  return Boolean(data?.phone_hash);
}

/** Nome que a empresa mandou para o contato identificado (display.name), para o painel. */
export async function contactDisplayName(db: SupabaseClient, contactId: string): Promise<string | null> {
  const { data } = await db.from("contacts").select("display").eq("id", contactId).maybeSingle();
  const name = (data?.display as { name?: unknown } | null)?.name;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : null;
}

/** O nome do contato para as respostas prontas ({nome}): o que a empresa mandou, senão o do perfil; sem nome, null. */
export async function contactName(db: SupabaseClient, contactId: string | null | undefined): Promise<string | null> {
  if (!contactId) return null;
  const { data } = await db.from("contacts").select("name, display").eq("id", contactId).maybeSingle();
  const display = (data?.display as { name?: unknown } | null)?.name;
  const name = (typeof display === "string" && display.trim()) || (data?.name as string | null)?.trim() || "";
  return name ? name.slice(0, 80) : null;
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
/**
 * Origem do link ig.me (E1, parte 3a) aberto sem mensagem, numa conversa antiga: espera no contato
 * até a próxima mensagem abrir a conversa nova (vale por 24 horas).
 */
export async function setContactOrigin(db: SupabaseClient, contactId: string, origin: { ref: string; label: string } | null): Promise<void> {
  await db.from("contacts").update(origin ? { origin_ref: origin.ref, origin_label: origin.label, origin_at: new Date().toISOString() } : { origin_ref: null, origin_label: null, origin_at: null }).eq("id", contactId);
}

/** A origem que espera no contato (até 24 horas depois de aberto o link), ou null. */
export async function pendingContactOrigin(db: SupabaseClient, contactId: string): Promise<{ ref: string; label: string } | null> {
  const { data } = await db.from("contacts").select("origin_ref, origin_label, origin_at").eq("id", contactId).maybeSingle();
  if (!data?.origin_ref || !data.origin_at || Date.now() - Date.parse(data.origin_at as string) > 86_400_000) return null;
  return { ref: data.origin_ref as string, label: (data.origin_label as string | null) ?? (data.origin_ref as string) };
}

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
 * última alteração), com o canal e os identificadores abertos (para apagar o 18+ junto). Só sai a
 * ficha sem conversa, vínculo ativo, aceite de novidades em vigor, lead, envio na fila nem horário
 * marcado pela frente (spec, Segurança: assim o paciente importado para o lembrete não some antes
 * do envio). Aceite, lead e envio ficam nas camadas deles (held: retention.ts junta). Página por id
 * (after), para não voltar sempre às mesmas fichas.
 */
export async function retentionContacts(db: SupabaseClient, botId: string, cutoff: string, opts: { after?: string; limit?: number; now?: Date; held?: (ids: string[]) => Promise<Set<string>> } = {}): Promise<{ rows: Array<{ id: string; channel: ContactChannel | "widget"; ids: string[] }>; last: string | null }> {
  const now = (opts.now ?? new Date()).getTime();
  let q = db.from("contacts").select("id, channel, phone_enc, wa_user_enc, ig_enc, appointment_at").eq("bot_id", botId).lt("created_at", cutoff).lt("updated_at", cutoff).or(`last_inbound_at.is.null,last_inbound_at.lt."${cutoff}"`);
  if (opts.after) q = q.gt("id", opts.after);
  const { data, error } = await q.order("id").limit(opts.limit ?? 200);
  if (error) throw new Error(`retenção dos contatos: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const ids = rows.map((r) => r.id as string);
  if (!ids.length) return { rows: [], last: null };
  const [{ data: convs }, { data: links }, held] = await Promise.all([
    db.from("conversations").select("contact_id").in("contact_id", ids),
    db.from("contact_links").select("contact_id").in("contact_id", ids).is("unlinked_at", null),
    opts.held ? opts.held(ids) : Promise.resolve(new Set<string>()),
  ]);
  const busy = new Set([...[...(convs ?? []), ...(links ?? [])].map((r) => r.contact_id as string), ...held]);
  // horário marcado pela frente: a régua do lembrete ainda vai precisar da ficha
  for (const r of rows) if (r.appointment_at && Date.parse(r.appointment_at as string) > now) busy.add(r.id as string);
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
  let q = db.from("contacts").select("id, bot_id, channel, phone_enc, wa_user_enc, ig_enc, external_id_enc, name, email, first_inbound_at, last_inbound_at, birthday, last_visit_at, appointment_at, custom_dates, created_at").in("bot_id", botIds);
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
      // as datas das réguas (leva Réguas): o aniversário só com o dia e o mês; as datas novas em JSON
      ...datesOf(r),
      custom_dates: Object.keys(customDatesOf(r.custom_dates)).length ? JSON.stringify(customDatesOf(r.custom_dates)) : null,
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
  /** o endereço da foto (só Instagram), ou null */
  photo?: string | null;
}

/** As datas das réguas (leva Réguas, parte 1): o aniversário ("MM-DD"), a última visita e o próximo horário. */
export interface ContactDates {
  birthday: string | null;
  last_visit_at: string | null;
  appointment_at: string | null;
}

/** As datas novas do contato (régua personalizada, 23/10/2026): { chave: "AAAA-MM-DD" }. */
export type CustomDates = Record<string, string>;

/** As datas novas de uma linha do banco, só as válidas. Pura. */
export function customDatesOf(raw: unknown): CustomDates {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k, v]) => /^[a-z][a-z0-9_]{1,39}$/.test(k) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) as CustomDates;
}

export interface ContactPanelRow extends ContactListRow, ContactDates {
  custom_dates: CustomDates;
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
  const page = await Promise.all(rows.slice(0, limit).map(listRow));
  const photos = await contactPhotoVersions(db, page.map((r) => r.id));
  return { rows: page.map((r) => ({ ...r, photo: contactPhotoUrl(r.id, photos.get(r.id)) })), more: rows.length > limit };
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
  const { data } = await db.from("contacts").select(`${LIST_COLS}, wa_user_enc, email, first_inbound_at, marketing_offer_at, birthday, last_visit_at, appointment_at, custom_dates`).eq("id", id).in("bot_id", botIds).maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const photos = await contactPhotoVersions(db, [id]);
  return {
    ...(await listRow(r)),
    photo: contactPhotoUrl(id, photos.get(id)),
    bsuid: await openNullable("contacts.wa_user_enc", r.wa_user_enc),
    email: (r.email as string | null) ?? null,
    first_inbound_at: (r.first_inbound_at as string | null) ?? null,
    marketing_offer_at: (r.marketing_offer_at as string | null) ?? null,
    ...datesOf(r),
    custom_dates: customDatesOf(r.custom_dates),
  };
}

const datesOf = (r: Record<string, unknown>): ContactDates => ({ birthday: (r.birthday as string | null) ?? null, last_visit_at: (r.last_visit_at as string | null) ?? null, appointment_at: (r.appointment_at as string | null) ?? null });

/**
 * Troca as datas das réguas dos contatos (só dos chatbots informados): undefined não muda, null
 * apaga. Devolve os ids alterados.
 */
export async function setContactDates(db: SupabaseClient, ids: string[], botIds: string[], dates: Partial<ContactDates>): Promise<string[]> {
  const patch = Object.fromEntries(Object.entries(dates).filter(([, v]) => v !== undefined));
  if (!ids.length || !botIds.length || !Object.keys(patch).length) return [];
  const { data, error } = await db.from("contacts").update({ ...patch, updated_at: new Date().toISOString() }).in("id", ids).in("bot_id", botIds).select("id");
  if (error) throw new Error(`contatos: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Troca as datas novas dos contatos (só dos chatbots informados), juntando com as que já existem:
 * "AAAA-MM-DD" grava, null apaga a chave. Devolve os ids alterados.
 */
export async function setContactCustomDates(db: SupabaseClient, ids: string[], botIds: string[], patch: Record<string, string | null>): Promise<string[]> {
  if (!ids.length || !botIds.length || !Object.keys(patch).length) return [];
  const { data, error } = await db.from("contacts").select("id, custom_dates").in("id", ids).in("bot_id", botIds);
  if (error) throw new Error(`contatos: ${error.message}`);
  const changed: string[] = [];
  for (const r of (data ?? []) as Array<{ id: string; custom_dates: unknown }>) {
    const current = customDatesOf(r.custom_dates);
    const next = mergeCustomDates(current, patch);
    if (JSON.stringify(next) === JSON.stringify(current)) continue;
    const { error: e } = await db.from("contacts").update({ custom_dates: next, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (e) throw new Error(`contatos: ${e.message}`);
    changed.push(r.id);
  }
  return changed;
}

/** As datas novas depois da troca: "AAAA-MM-DD" grava, null apaga; as outras ficam. Pura. */
export function mergeCustomDates(current: CustomDates, patch: Record<string, string | null>): CustomDates {
  const next: CustomDates = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
}

/** Troca as etiquetas do contato (só de um dos chatbots informados). */
export async function setContactTags(db: SupabaseClient, id: string, botIds: string[], tags: string[]): Promise<boolean> {
  if (!botIds.length) return false;
  const { data, error } = await db.from("contacts").update({ tags, updated_at: new Date().toISOString() }).eq("id", id).in("bot_id", botIds).select("id");
  if (error) throw new Error(`contatos: ${error.message}`);
  return Boolean(data?.length);
}

/** As datas das réguas (leva Réguas, parte 1) numa linha da planilha: ausente ou null não muda. */
export interface ImportedDates {
  birthday?: string | null;
  lastVisitAt?: string | null;
  appointmentAt?: string | null;
  /** as datas novas (régua personalizada): { chave: "AAAA-MM-DD" } */
  customDates?: CustomDates;
}

/** O que a planilha muda nas datas de quem já existe: aniversário e horário trocam; a visita só avança. Pura. */
export function importedDatesPatch(current: { birthday: string | null; last_visit_at: string | null; appointment_at: string | null }, r: ImportedDates): Record<string, string> {
  const patch: Record<string, string> = {};
  if (r.birthday && r.birthday !== current.birthday) patch.birthday = r.birthday;
  if (r.lastVisitAt && (!current.last_visit_at || Date.parse(r.lastVisitAt) > Date.parse(current.last_visit_at))) patch.last_visit_at = r.lastVisitAt;
  if (r.appointmentAt && (!current.appointment_at || Date.parse(r.appointmentAt) !== Date.parse(current.appointment_at))) patch.appointment_at = r.appointmentAt;
  return patch;
}

/**
 * Planilha (leva B3): contatos do WhatsApp de um chatbot pelo telefone canônico. Cria quem não
 * existe (sem "já conversou": a pessoa ainda não escreveu) e completa quem existe (nome só se
 * estava vazio; etiquetas somadas; as datas das réguas pela regra de importedDatesPatch). Em lotes,
 * para caber no tempo de uma requisição.
 */
export async function importWhatsAppContacts(db: SupabaseClient, bot: { id: string; agency_id: string }, rows: Array<{ phone: string; name: string | null; tags: string[] } & ImportedDates>): Promise<{ ids: Map<string, string>; created: number; updated: number }> {
  const ids = new Map<string, string>();
  const byHash = new Map(rows.map((r) => [phoneHash(r.phone), r]));
  const hashes = [...byHash.keys()];
  const existing = new Map<string, { id: string; name: string | null; tags: string[]; birthday: string | null; last_visit_at: string | null; appointment_at: string | null; custom_dates: CustomDates }>();
  for (let i = 0; i < hashes.length; i += 300) {
    const { data, error } = await db.from("contacts").select("id, phone_hash, name, tags, birthday, last_visit_at, appointment_at, custom_dates").eq("bot_id", bot.id).eq("channel", "whatsapp").in("phone_hash", hashes.slice(i, i + 300));
    if (error) throw new Error(`contatos: ${error.message}`);
    for (const c of data ?? []) existing.set(c.phone_hash as string, { id: c.id as string, name: (c.name as string | null) ?? null, tags: (c.tags as string[] | null) ?? [], birthday: (c.birthday as string | null) ?? null, last_visit_at: (c.last_visit_at as string | null) ?? null, appointment_at: (c.appointment_at as string | null) ?? null , custom_dates: customDatesOf(c.custom_dates) });
  }

  // novos: o telefone vai cifrado com a chave do cliente (uma busca da chave para o lote todo)
  const scope = await scopeOfBot(bot.id);
  const fresh = hashes.filter((h) => !existing.has(h));
  let created = 0;
  for (let i = 0; i < fresh.length; i += 200) {
    const chunk = await Promise.all(
      fresh.slice(i, i + 200).map(async (h) => {
        const r = byHash.get(h)!;
        return { agency_id: bot.agency_id, bot_id: bot.id, channel: "whatsapp", hash_key_version: HASH_KEY_VERSION, phone_hash: h, phone_enc: await sealNullable("contacts.phone_enc", r.phone, scope), name: r.name, tags: r.tags, birthday: r.birthday ?? null, last_visit_at: r.lastVisitAt ?? null, appointment_at: r.appointmentAt ?? null };
      }),
    );
    const { data, error } = await db.from("contacts").insert(chunk).select("id, phone_hash");
    if (error) throw new Error(`contatos: ${error.message}`);
    for (const c of data ?? []) ids.set(byHash.get(c.phone_hash as string)!.phone, c.id as string);
    created += data?.length ?? 0;
  }

  // existentes: só o que muda (nome vazio, etiqueta nova, as datas das réguas), 20 de cada vez
  let updated = 0;
  const changes: Array<{ id: string; patch: Record<string, unknown> }> = hashes
    .filter((h) => existing.has(h))
    .map((h) => {
      const r = byHash.get(h)!;
      const c = existing.get(h)!;
      ids.set(r.phone, c.id);
      const tags = [...c.tags, ...r.tags.filter((t) => !c.tags.some((x) => x.toLowerCase() === t.toLowerCase()))].slice(0, 20);
      const name = !c.name && r.name ? r.name : null;
      const dates = importedDatesPatch(c, r);
      // as datas novas da planilha trocam as que vieram; as outras ficam
      const custom = r.customDates && Object.keys(r.customDates).length ? mergeCustomDates(c.custom_dates, r.customDates) : null;
      const customChanged = custom !== null && JSON.stringify(custom) !== JSON.stringify(c.custom_dates);
      const patch: Record<string, unknown> = { tags, ...(name ? { name } : {}), ...dates, ...(customChanged ? { custom_dates: custom } : {}), updated_at: new Date().toISOString() };
      return tags.length !== c.tags.length || name || Object.keys(dates).length || customChanged ? { id: c.id, patch } : null;
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

/** Teto de contatos lidos para o público de uma campanha. */
export const AUDIENCE_MAX = 10_000;

export interface AudienceContact {
  id: string;
  /** canônico, aberto */
  phone: string | null;
  name: string | null;
}

/**
 * Público de uma campanha (leva B3): os contatos do WhatsApp do chatbot com qualquer uma das
 * etiquetas e os dos telefones informados, cada um uma vez. Telefone da lista que não é contato
 * do chatbot volta em unknownPhones (sem contato, não há aceite).
 */
export async function campaignAudience(db: SupabaseClient, botId: string, o: { tags: string[]; phones: string[] }): Promise<{ contacts: AudienceContact[]; unknownPhones: string[]; truncated: boolean }> {
  const rows = new Map<string, Record<string, unknown>>();
  let truncated = false;
  if (o.tags.length) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("contacts").select("id, name, phone_enc").eq("bot_id", botId).eq("channel", "whatsapp").overlaps("tags", o.tags).order("created_at").range(from, from + 999);
      if (error) throw new Error(`contatos: ${error.message}`);
      for (const r of data ?? []) rows.set(r.id as string, r);
      if ((data ?? []).length < 1000) break;
      if (rows.size >= AUDIENCE_MAX) {
        truncated = true;
        break;
      }
    }
  }
  const wanted = new Map<string, string>();
  for (const p of o.phones) {
    const c = canonicalPhone(p, { typed: true });
    if (c) wanted.set(phoneHash(c), c);
  }
  const found = new Set<string>();
  const hashes = [...wanted.keys()];
  for (let i = 0; i < hashes.length; i += 300) {
    const { data, error } = await db.from("contacts").select("id, name, phone_enc, phone_hash").eq("bot_id", botId).eq("channel", "whatsapp").in("phone_hash", hashes.slice(i, i + 300));
    if (error) throw new Error(`contatos: ${error.message}`);
    for (const r of data ?? []) {
      rows.set(r.id as string, r);
      found.add(r.phone_hash as string);
    }
  }
  const list = [...rows.values()].slice(0, AUDIENCE_MAX);
  if (rows.size > AUDIENCE_MAX) truncated = true;
  const contacts = await Promise.all(list.map(async (r) => ({ id: r.id as string, name: (r.name as string | null) ?? null, phone: canonicalPhone(await openNullable("contacts.phone_enc", r.phone_enc)) })));
  return { contacts, unknownPhones: hashes.filter((h) => !found.has(h)).map((h) => wanted.get(h)!), truncated };
}

/**
 * Contatos do WhatsApp do chatbot por telefone (lembretes da leva B3): id, nome e se a pessoa já
 * mandou mensagem pelo canal (first_inbound_at: nunca eco, histórico sincronizado ou envio).
 * Chave: o telefone canônico informado.
 */
export async function whatsappContactsByPhone(db: SupabaseClient, botId: string, phones: string[]): Promise<Map<string, { id: string; name: string | null; messaged: boolean }>> {
  const byHash = new Map<string, string>();
  for (const p of phones) byHash.set(phoneHash(p), p);
  const hashes = [...byHash.keys()];
  const out = new Map<string, { id: string; name: string | null; messaged: boolean }>();
  for (let i = 0; i < hashes.length; i += 300) {
    const { data, error } = await db.from("contacts").select("id, name, phone_hash, first_inbound_at").eq("bot_id", botId).eq("channel", "whatsapp").in("phone_hash", hashes.slice(i, i + 300));
    if (error) throw new Error(`contatos: ${error.message}`);
    for (const r of data ?? []) out.set(byHash.get(r.phone_hash as string)!, { id: r.id as string, name: (r.name as string | null) ?? null, messaged: Boolean(r.first_inbound_at) });
  }
  return out;
}

/** O contato do chatbot pelo número (ou BSUID) do WhatsApp ou pelo IGSID, sem criar (eventos de consentimento). */
export async function channelContactId(db: SupabaseClient, botId: string, channel: ContactChannel, contact: string): Promise<string | null> {
  const [column, hash] = channel === "instagram" ? ["ig_hash", igHash(contact)] : /[a-z]/i.test(contact) ? ["wa_user_hash", waUserHash(contact)] : ["phone_hash", metaPhoneHash(contact)];
  if (!hash) return null;
  const { data } = await db.from("contacts").select("id").eq("bot_id", botId).eq("channel", channel).eq(column, hash).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/* ------------------------------------------------------------------ API pública (C pública, parte 4a) */

/** Contato na listagem da API, com as identidades do canal abertas. */
export interface ApiContactRow extends ContactDates {
  /** as datas novas (régua personalizada): { chave: "AAAA-MM-DD" } */
  custom_dates: CustomDates;
  id: string;
  bot_id: string;
  channel: ContactChannel | "widget";
  name: string | null;
  email: string | null;
  tags: string[];
  phone: string | null;
  bsuid: string | null;
  igsid: string | null;
  external_id: string | null;
  first_inbound_at: string | null;
  last_inbound_at: string | null;
  created_at: string;
  updated_at: string;
}

const API_CONTACT_COLS = "id, bot_id, channel, name, email, tags, phone_enc, wa_user_enc, ig_enc, external_id_enc, first_inbound_at, last_inbound_at, birthday, last_visit_at, appointment_at, custom_dates, created_at, updated_at";

async function apiContactRow(r: Record<string, unknown>): Promise<ApiContactRow> {
  return {
    id: r.id as string,
    bot_id: r.bot_id as string,
    channel: r.channel as ApiContactRow["channel"],
    name: (r.name as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    tags: (r.tags as string[] | null) ?? [],
    phone: await openNullable("contacts.phone_enc", r.phone_enc),
    bsuid: await openNullable("contacts.wa_user_enc", r.wa_user_enc),
    igsid: await openNullable("contacts.ig_enc", r.ig_enc),
    external_id: await openNullable("contacts.external_id_enc", r.external_id_enc),
    first_inbound_at: (r.first_inbound_at as string | null) ?? null,
    last_inbound_at: (r.last_inbound_at as string | null) ?? null,
    ...datesOf(r),
    custom_dates: customDatesOf(r.custom_dates),
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

/** O horário marcado do contato agora (o lembrete da régua confere antes de sair). */
export async function contactAppointment(db: SupabaseClient, contactId: string): Promise<string | null> {
  const { data } = await db.from("contacts").select("appointment_at").eq("id", contactId).maybeSingle();
  return (data?.appointment_at as string | null | undefined) ?? null;
}

/** Um contato do WhatsApp para as réguas: o telefone (decifrado), o nome, se já escreveu e as datas. */
export interface ReguaContact extends ContactDates {
  custom_dates: CustomDates;
  id: string;
  phone: string;
  name: string | null;
  messaged: boolean;
  last_inbound_at: string | null;
}

/** Quem a régua procura: o aniversário do dia, a última visita, a última mensagem de quem não tem visita ou o horário marcado, num intervalo [de, até]. */
export type ReguaSearch = ({ birthdays: string[] } | { lastVisit: [string, string] } | { lastInboundNoVisit: [string, string] } | { appointment: [string, string] } | { customDate: { key: string; equals?: string; monthDay?: string } }) & {
  /** só quem tem esta etiqueta (régua personalizada) */
  tag?: string | null;
};

/** Os contatos do WhatsApp do chatbot (com telefone) que a régua procura. */
function reguaQuery(db: SupabaseClient, botId: string, by: ReguaSearch, columns: string, count?: { count: "exact"; head: true }) {
  let q = db.from("contacts").select(columns, count).eq("bot_id", botId).eq("channel", "whatsapp").not("phone_enc", "is", null);
  if (by.tag) q = q.contains("tags", [by.tag]);
  if ("birthdays" in by) q = q.in("birthday", by.birthdays);
  else if ("customDate" in by) {
    // a data nova: o dia exato (uma vez) ou o dia e o mês de qualquer ano (todo ano)
    const col = `custom_dates->>${by.customDate.key}`;
    q = by.customDate.equals ? q.eq(col, by.customDate.equals) : q.like(col, `%-${by.customDate.monthDay ?? "00-00"}`);
  } else if ("lastVisit" in by) q = q.gte("last_visit_at", by.lastVisit[0]).lte("last_visit_at", by.lastVisit[1]);
  else if ("lastInboundNoVisit" in by) q = q.is("last_visit_at", null).gte("last_inbound_at", by.lastInboundNoVisit[0]).lte("last_inbound_at", by.lastInboundNoVisit[1]);
  else q = q.gte("appointment_at", by.appointment[0]).lte("appointment_at", by.appointment[1]);
  return q;
}

/** Os valores de uma data nova nos contatos do WhatsApp do chatbot (a estimativa da régua personalizada), até 5.000. */
export async function reguaCustomDateValues(db: SupabaseClient, botId: string, key: string, tag: string | null): Promise<string[]> {
  let q = db.from("contacts").select("custom_dates").eq("bot_id", botId).eq("channel", "whatsapp").not("phone_enc", "is", null).not(`custom_dates->>${key}`, "is", null);
  if (tag) q = q.contains("tags", [tag]);
  const { data, error } = await q.limit(5000);
  if (error) throw new Error(`contatos da régua: ${error.message}`);
  return ((data ?? []) as Array<{ custom_dates: unknown }>).map((r) => customDatesOf(r.custom_dates)[key]).filter((v): v is string => Boolean(v));
}

/** Quantos contatos a régua acharia (a estimativa da tela das réguas). */
export async function reguaContactCount(db: SupabaseClient, botId: string, by: ReguaSearch): Promise<number> {
  const { count } = await reguaQuery(db, botId, by, "id", { count: "exact", head: true });
  return count ?? 0;
}

/** Contatos do WhatsApp do chatbot (com telefone) para uma régua (leva Réguas, parte 2). */
export async function reguaContacts(db: SupabaseClient, botId: string, by: ReguaSearch, limit = 2000): Promise<ReguaContact[]> {
  const { data, error } = await reguaQuery(db, botId, by, "id, name, phone_enc, first_inbound_at, last_inbound_at, birthday, last_visit_at, appointment_at, custom_dates").limit(limit);
  if (error) throw new Error(`contatos da régua: ${error.message}`);
  const rows = await Promise.all(
    ((data ?? []) as unknown as Array<Record<string, unknown>>).map(async (r) => ({
      id: r.id as string,
      phone: (await openNullable("contacts.phone_enc", r.phone_enc)) ?? "",
      name: (r.name as string | null) ?? null,
      messaged: Boolean(r.first_inbound_at),
      last_inbound_at: (r.last_inbound_at as string | null) ?? null,
      ...datesOf(r),
      custom_dates: customDatesOf(r.custom_dates),
    })),
  );
  return rows.filter((r) => r.phone);
}

/** Os contatos pelo id, no formato da API (só dos chatbots informados). A resposta das rotas que mudam o contato. */
export async function apiContactsByIds(db: SupabaseClient, ids: string[], botIds: string[]): Promise<ApiContactRow[]> {
  if (!ids.length || !botIds.length) return [];
  const { data, error } = await db.from("contacts").select(API_CONTACT_COLS).in("id", ids).in("bot_id", botIds);
  if (error) throw new Error(`contatos da API: ${error.message}`);
  return Promise.all(((data ?? []) as Array<Record<string, unknown>>).map(apiContactRow));
}

/**
 * Uma página de contatos destes chatbots para a API, na ordem da última alteração (sincronização:
 * since e o cursor andam juntos). after: [updated_at, id] da última da página anterior.
 */
export async function apiContactsPage(db: SupabaseClient, o: { botIds: string[]; channel?: string | null; tag?: string | null; since?: string | null; after?: [string, string] | null; limit: number }): Promise<ApiContactRow[]> {
  if (!o.botIds.length) return [];
  let q = db.from("contacts").select(API_CONTACT_COLS).in("bot_id", o.botIds);
  if (o.channel) q = q.eq("channel", o.channel);
  if (o.tag) q = q.contains("tags", [o.tag]);
  if (o.since) q = q.gte("updated_at", o.since);
  if (o.after) q = q.or(`updated_at.gt."${o.after[0]}",and(updated_at.eq."${o.after[0]}",id.gt.${o.after[1]})`);
  const { data, error } = await q.order("updated_at").order("id").limit(o.limit);
  if (error) throw new Error(`contatos da API: ${error.message}`);
  return Promise.all(((data ?? []) as Array<Record<string, unknown>>).map(apiContactRow));
}

/** Telefone (canônico) de cada contato do WhatsApp deste chatbot, pelo id (sem telefone: null). Campanha pela API. */
export async function whatsappPhonesOf(db: SupabaseClient, botId: string, contactIds: string[]): Promise<Map<string, { phone: string | null; name: string | null; messaged: boolean }>> {
  const out = new Map<string, { phone: string | null; name: string | null; messaged: boolean }>();
  for (let i = 0; i < contactIds.length; i += 300) {
    const { data, error } = await db.from("contacts").select("id, name, phone_enc, first_inbound_at").eq("bot_id", botId).eq("channel", "whatsapp").in("id", contactIds.slice(i, i + 300));
    if (error) throw new Error(`contatos: ${error.message}`);
    for (const r of data ?? []) out.set(r.id as string, { phone: await openNullable("contacts.phone_enc", r.phone_enc), name: (r.name as string | null) ?? null, messaged: Boolean(r.first_inbound_at) });
  }
  return out;
}

/**
 * O nome de cada contato para as listas (Caixa de entrada): o nome da empresa (display), senão o
 * que veio do canal, senão o telefone ou o @. Uma consulta para a lista inteira.
 */
export async function contactLabels(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return out;
  const { data } = await db.from("contacts").select("id, name, display, phone_enc").in("id", unique);
  for (const r of (data ?? []) as Array<{ id: string; name: string | null; display: { name?: unknown } | null; phone_enc: string | null }>) {
    const display = typeof r.display?.name === "string" ? r.display.name.trim() : "";
    const label = display || r.name?.trim() || (await openNullable("contacts.phone_enc", r.phone_enc)) || "";
    if (label) out.set(r.id, label.slice(0, 80));
  }
  return out;
}

/* ------------------------------------------------------------------ memória do contato */

/*
 * Memória do contato (leva Memória e avisos no celular, parte 1): até 10 fatos curtos que a IA tirou
 * das conversas anteriores com este chatbot, cifrados com a chave do cliente. Só este módulo lê e
 * grava a coluna; quem decide o que entra é contact-memory.ts.
 */

/** Os fatos guardados do contato ([] sem memória). */
export async function contactMemory(db: SupabaseClient, contactId: string): Promise<string[]> {
  const { data } = await db.from("contacts").select("memory_enc").eq("id", contactId).maybeSingle();
  const raw = await openNullable("contacts.memory_enc", data?.memory_enc).catch(() => null);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Grava a memória (lista vazia apaga). */
export async function saveContactMemory(db: SupabaseClient, contact: { id: string; botId: string }, facts: string[], now = new Date()): Promise<void> {
  const patch = facts.length ? { memory_enc: await enc("contacts.memory_enc", contact.botId, JSON.stringify(facts)), memory_updated_at: now.toISOString() } : { memory_enc: null, memory_updated_at: null };
  const { error } = await db.from("contacts").update(patch).eq("id", contact.id).eq("bot_id", contact.botId);
  if (error) throw new Error(`memória do contato: ${error.message}`);
}

/** Apaga a memória de todos os contatos de um chatbot (desligou a memória ou ligou o modo dados sensíveis). Devolve quantos. */
export async function clearBotMemories(db: SupabaseClient, botId: string): Promise<number> {
  const { data, error } = await db.from("contacts").update({ memory_enc: null, memory_updated_at: null }).eq("bot_id", botId).not("memory_updated_at", "is", null).select("id");
  if (error) throw new Error(`memória do contato: ${error.message}`);
  return data?.length ?? 0;
}

/** Apaga as memórias sem atualização desde `before` (o prazo de 180 dias, na tarefa diária). Devolve quantas. */
export async function expireContactMemories(db: SupabaseClient, before: string, limit = 500): Promise<number> {
  const { data: rows } = await db.from("contacts").select("id").lt("memory_updated_at", before).limit(limit);
  const ids = (rows ?? []).map((r) => r.id as string);
  if (!ids.length) return 0;
  const { error } = await db.from("contacts").update({ memory_enc: null, memory_updated_at: null }).in("id", ids);
  if (error) throw new Error(`memória do contato: ${error.message}`);
  return ids.length;
}

export interface GoToContact {
  id: string;
  name: string | null;
  channel: string;
  bot: { id: string; name: string; client_id: string | null; client_name: string | null };
}

/**
 * Contatos para o Ir para (Ctrl K): pelo nome, ou pelo telefone (pelo hash, como na lista do
 * cliente). Com o cliente da pessoa logada (a RLS limita ao escopo dela); os chatbots em modo
 * sensível ficam de fora, porque lá ver o contato pede o segundo fator.
 */
export async function goToContacts(db: SupabaseClient, term: string, limit = 5): Promise<GoToContact[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  let q = db.from("contacts").select("id, name, channel, bots!inner(id, name, client_id, client_name, sensitive_mode)").eq("bots.sensitive_mode", false);
  const ph = t.replace(/\D/g, "").length >= 8 ? typedPhoneHash(t) : null;
  if (ph) q = q.eq("phone_hash", ph);
  else {
    const clean = t.replace(/[%_*,()\\]/g, " ").trim();
    if (!clean) return [];
    q = q.ilike("name", `%${clean}%`);
  }
  const { data, error } = await q.order("last_inbound_at", { ascending: false, nullsFirst: false }).limit(limit);
  if (error) throw new Error(`contatos: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const b = (Array.isArray(r.bots) ? r.bots[0] : r.bots) as GoToContact["bot"];
    return { id: r.id as string, name: (r.name as string | null) ?? null, channel: r.channel as string, bot: { id: b.id, name: b.name, client_id: b.client_id, client_name: b.client_name } };
  });
}

export interface PickableContact {
  id: string;
  name: string | null;
  phone: string;
  tags: string[];
  /** o horário marcado da ficha ("Datas para as réguas"), para o lembrete já vir com ele */
  appointment_at: string | null;
  last_inbound_at: string | null;
}

/**
 * Os contatos do WhatsApp de um chatbot para escolher numa campanha ou num lembrete (redesenho, etapa
 * 5): a busca pelo nome ou pelo telefone (pelo hash, como na lista), ou só entre `ids` (os que viraram
 * lead). Os de mensagem mais recente primeiro; só os que têm telefone.
 */
export async function pickableContacts(db: SupabaseClient, botId: string, o: { q?: string | null; ids?: string[] | null; page?: number; limit?: number }): Promise<{ rows: PickableContact[]; more: boolean }> {
  if (o.ids && !o.ids.length) return { rows: [], more: false };
  const limit = o.limit ?? 40;
  const from = Math.max(0, o.page ?? 0) * limit;
  let q = db.from("contacts").select("id, name, tags, phone_enc, appointment_at, last_inbound_at").eq("bot_id", botId).eq("channel", "whatsapp").not("phone_enc", "is", null);
  if (o.ids) q = q.in("id", o.ids.slice(0, 1000));
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
  const out = await Promise.all(
    rows.slice(0, limit).map(async (r) => ({
      id: r.id as string,
      name: (r.name as string | null) ?? null,
      phone: (await openNullable("contacts.phone_enc", r.phone_enc)) ?? "",
      tags: (r.tags as string[] | null) ?? [],
      appointment_at: (r.appointment_at as string | null) ?? null,
      last_inbound_at: (r.last_inbound_at as string | null) ?? null,
    })),
  );
  return { rows: out.filter((r) => r.phone), more: rows.length > limit };
}

/*
 * Foto do contato (22/10/2026): só o Instagram dá (a API de perfil do usuário). Vai cifrada na
 * própria ficha ("mime;base64"), então sai junto com o contato no prazo de guarda e no pedido do
 * titular. É buscada de novo quando a pessoa escreve e passou uma semana.
 */
const PHOTO_MAX_AGE_MS = 7 * 86_400_000;

/** A foto precisa ser buscada (nunca buscada ou com mais de uma semana). Pura. */
export const photoStale = (c: { avatar_at?: string | null }, now = Date.now()) => !c.avatar_at || now - Date.parse(c.avatar_at) > PHOTO_MAX_AGE_MS;

/**
 * Grava o que veio do perfil: a foto (ou nada, e a busca só volta em uma semana) e o nome, quando a
 * ficha ainda não tem (o nome do perfil ou o @). Service role.
 */
export async function saveContactProfile(db: SupabaseClient, botId: string, contactId: string, p: { name: string | null; username: string | null; photo: { mime: string; base64: string } | null }): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { avatar_at: now, updated_at: now };
  if (p.photo) patch.avatar_enc = await enc("contacts.avatar_enc", botId, `${p.photo.mime};${p.photo.base64}`);
  await db.from("contacts").update(patch).eq("id", contactId);
  const name = p.name ?? p.username;
  if (name) await db.from("contacts").update({ name }).eq("id", contactId).is("name", null);
}

/** A foto para mostrar (pela sessão de quem vê: a RLS limita ao escopo). null sem foto. */
export async function contactPhoto(db: SupabaseClient, id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const { data } = await db.from("contacts").select("avatar_enc").eq("id", id).maybeSingle();
  const raw = await openNullable("contacts.avatar_enc", data?.avatar_enc).catch(() => null);
  const m = raw ? /^(image\/(?:jpeg|png|webp));([A-Za-z0-9+/=]+)$/.exec(raw) : null;
  return m ? { mime: m[1], bytes: Buffer.from(m[2], "base64") } : null;
}

/** Quais destes contatos têm foto, com a versão (o avatar_at, para o endereço mudar quando a foto muda). */
export async function contactPhotoVersions(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter(Boolean))].slice(0, 500);
  if (!clean.length) return new Map();
  const { data } = await db.from("contacts").select("id, avatar_at").in("id", clean).not("avatar_enc", "is", null);
  return new Map((data ?? []).map((r) => [r.id as string, r.avatar_at as string]));
}

/** O endereço da foto no painel (com a versão, para o navegador guardar até a foto mudar). */
export const contactPhotoUrl = (id: string, version: string | null | undefined) => (version ? `/api/painel/contatos/${id}/foto?v=${Date.parse(version) || 0}` : null);
