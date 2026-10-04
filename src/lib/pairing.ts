import { randomBytes } from "node:crypto";
import { tool, type Tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hmacHex } from "./hash";
import { openField, sealField, type CipherField } from "./field-cipher";
import { canonicalPhone } from "./phone";
import { contextHashOf } from "./identity";
import { contactActiveLinkId, contactPhone, externalIdHash, phoneHash, setActiveLink } from "./contacts";
import { normalizeGateText } from "./gate/payment";
import type { ChatIdentity } from "./widget-identity";

/*
 * Pareamento no WhatsApp e no Instagram (P2, spec "Peça 4"): o SaaS gera um código
 * (POST /v1/pairings) e manda a pessoa ao link (wa.me/<número>?text=Conectar ABC123 ou
 * ig.me/<usuário>?ref=ABC123, ou o código digitado no direct). O contato fica vinculado à conta
 * dela (external_id) e a um contexto (workspace); a IA vê só o display, e as ações recebem o
 * nível usuario e o contexto. Regras:
 * - código de 6 caracteres sem letras ambíguas, uso único, 10 minutos;
 * - no máximo 5 códigos inválidos por contato por hora; depois, nenhum código é aceito na hora;
 * - telefone esperado (opcional): código de outro número é recusado;
 * - golpe inverso: este WhatsApp já conectado a outra conta pede confirmação antes;
 * - um contexto ativo por contato (o último pareado ou usado); trocar abre um trecho novo da
 *   conversa (a IA só lê o que veio depois); "desconectar" no chat desfaz o vínculo ativo.
 */

export const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PAIRING_TTL_MS = 10 * 60_000;
export const MAX_INVALID_CODES = 5;
const CODE_RE = new RegExp(`^[${PAIRING_ALPHABET}]{6}$`);

export type PairingChannel = "whatsapp" | "instagram";

export interface PairingDisplay {
  name?: string;
  workspace_name?: string;
}

export interface LinkRow {
  id: string;
  bot_id: string;
  contact_id: string;
  channel: PairingChannel;
  external_id_hash: string;
  external_id_enc: string;
  context_hash: string | null;
  context_enc: string | null;
  display: PairingDisplay | null;
  linked_at: string;
}

const LINK_COLS = "id, bot_id, contact_id, channel, external_id_hash, external_id_enc, context_hash, context_enc, display, linked_at";

const seal = (field: CipherField, v: string) => sealField(field, v);
const open = (field: CipherField, v: string | null) => (v ? openField(field, v) : null);
export const codeHash = (botId: string, code: string) => hmacHex(`pair:${botId}:${code}`);

/** Código novo (6 caracteres, sem 0/O, 1/I/L), sempre com um dígito: digitado sozinho, ele é reconhecido. */
export function newPairingCode(): string {
  for (;;) {
    const code = [...randomBytes(6)].map((b) => PAIRING_ALPHABET[b % PAIRING_ALPHABET.length]).join("");
    if (/[0-9]/.test(code)) return code;
  }
}

/**
 * Comando de pareamento na mensagem: "Conectar ABC123" (sempre uma tentativa) ou o código sozinho
 * (só vale se o código existir: uma palavra de 6 letras não pode virar tentativa inválida). Função pura.
 */
export function pairingCommand(text: string | null): { code: string; explicit: boolean } | null {
  if (!text) return null;
  const t = text.trim();
  const explicit = /^conectar\s+([a-z0-9]{6})\s*[.!]?$/i.exec(t);
  if (explicit) return { code: explicit[1].toUpperCase(), explicit: true };
  const bare = /^([a-z0-9]{6})$/i.exec(t);
  return bare && /\d/.test(bare[1]) ? { code: bare[1].toUpperCase(), explicit: false } : null;
}

/** "desconectar" (ou "desvincular"), sozinho ou com "este WhatsApp". Função pura. */
export function isUnlinkCommand(text: string | null): boolean {
  if (!text) return false;
  const n = normalizeGateText(text).trim();
  return /^(desconectar|desvincular)( (este|esse|meu|minha) (whatsapp|instagram|numero|perfil|conta))?$/.test(n);
}

/** Como o vínculo aparece para a pessoa: o workspace, senão "a conta de Nome". Função pura. */
export function linkLabel(d: PairingDisplay | null | undefined, o: { byName?: boolean } = {}): string {
  const ws = typeof d?.workspace_name === "string" && d.workspace_name.trim() ? d.workspace_name.trim().slice(0, 80) : null;
  const name = typeof d?.name === "string" && d.name.trim() ? d.name.trim().slice(0, 60) : null;
  if (o.byName && name) return `a conta de ${name}`;
  return ws ?? (name ? `a conta de ${name}` : "sua conta");
}

export const PAIRING_TEXTS = {
  linked: (channel: PairingChannel, where: string) => `Pronto! Este ${channel === "whatsapp" ? "WhatsApp" : "Instagram"} está conectado a ${where}. Agora posso consultar seus dados por aqui.`,
  invalid: "Esse código não é válido ou já venceu. Gere um novo e mande de novo.",
  otherPhone: "Esse código foi gerado para outro número de WhatsApp. Gere um novo código com o número certo.",
  noPhone: "Esse código pede o número deste WhatsApp, e ele não apareceu para nós. Gere um código sem número esperado ou fale com a empresa.",
  confirm: (current: string, next: string) => `Este WhatsApp está conectado a ${current}. Conectar também a ${next}?`,
  confirmInstagram: (current: string, next: string) => `Este Instagram está conectado a ${current}. Conectar também a ${next}?`,
  cancelled: "Tudo bem, não conectei.",
  unlinked: (channel: PairingChannel, where: string, remaining: string[]) =>
    `Pronto, este ${channel === "whatsapp" ? "WhatsApp" : "Instagram"} foi desconectado de ${where}.${remaining.length ? ` Continua conectado a ${remaining.join(", ")}: para desconectar também, mande "desconectar" de novo.` : ""}`,
  notLinked: (channel: PairingChannel) => `Este ${channel === "whatsapp" ? "WhatsApp" : "Instagram"} não está conectado a nenhuma conta.`,
} as const;

/* ------------------------------------------------------------------ códigos */

export interface PairingInput {
  botId: string;
  channel: PairingChannel;
  externalId: string;
  context: Record<string, unknown> | null;
  display: PairingDisplay | null;
  expectedPhone: string | null;
  apiKeyId: string | null;
}

/** Link que abre a conversa já com o código: wa.me (texto pronto) ou ig.me (ref). Função pura. */
export function pairingLink(channel: PairingChannel, target: { phone?: string | null; username?: string | null }, code: string): string | null {
  if (channel === "whatsapp") {
    const digits = (target.phone ?? "").replace(/\D/g, "");
    return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(`Conectar ${code}`)}` : null;
  }
  return target.username ? `https://ig.me/${encodeURIComponent(target.username)}?ref=${code}` : null;
}

/** Gera o código (10 minutos, uso único). */
export async function createPairing(db: SupabaseClient, i: PairingInput, target: { phone?: string | null; username?: string | null }, now = Date.now()): Promise<{ id: string; code: string; link: string | null; expires_at: string }> {
  const code = newPairingCode();
  const expires_at = new Date(now + PAIRING_TTL_MS).toISOString();
  const expected = i.expectedPhone ? canonicalPhone(i.expectedPhone, { typed: true }) : null;
  const { data, error } = await db
    .from("pairing_codes")
    .insert({
      bot_id: i.botId,
      channel: i.channel,
      code_hash: codeHash(i.botId, code),
      external_id_hash: externalIdHash(i.externalId),
      external_id_enc: seal("pairing_codes.external_id_enc", i.externalId),
      context_hash: contextHashOf(i.context),
      context_enc: i.context ? seal("pairing_codes.context_enc", JSON.stringify(i.context)) : null,
      display: i.display,
      expected_phone_hash: expected ? phoneHash(expected) : null,
      api_key_id: i.apiKeyId,
      expires_at,
    })
    .select("id")
    .single();
  if (error) throw new Error(`pareamento não criado: ${error.message}`);
  return { id: data.id as string, code, link: pairingLink(i.channel, target, code), expires_at };
}

interface PairingRow {
  id: string;
  bot_id: string;
  channel: PairingChannel;
  external_id_hash: string;
  external_id_enc: string;
  context_hash: string | null;
  context_enc: string | null;
  display: PairingDisplay | null;
  expected_phone_hash: string | null;
  expires_at: string;
  used_at: string | null;
}
const PAIRING_COLS = "id, bot_id, channel, external_id_hash, external_id_enc, context_hash, context_enc, display, expected_phone_hash, expires_at, used_at";

async function activePairing(db: SupabaseClient, botId: string, channel: PairingChannel, q: { code: string } | { id: string }): Promise<PairingRow | null> {
  let r = db.from("pairing_codes").select(PAIRING_COLS).eq("bot_id", botId).eq("channel", channel).is("used_at", null).gt("expires_at", new Date().toISOString());
  r = "code" in q ? r.eq("code_hash", codeHash(botId, q.code)) : r.eq("id", q.id);
  const { data } = await r.limit(1).maybeSingle<PairingRow>();
  return data;
}

/* ------------------------------------------------------------------ vínculos */

export async function activeLinks(db: SupabaseClient, contactId: string): Promise<LinkRow[]> {
  const { data } = await db.from("contact_links").select(LINK_COLS).eq("contact_id", contactId).is("unlinked_at", null).order("linked_at");
  return (data ?? []) as LinkRow[];
}

/** O vínculo ativo do contato (o último pareado ou usado); sem ele marcado, o mais recente. */
export async function activeLinkOf(db: SupabaseClient, contactId: string): Promise<{ active: LinkRow | null; all: LinkRow[] }> {
  const all = await activeLinks(db, contactId);
  if (!all.length) return { active: null, all };
  const id = await contactActiveLinkId(db, contactId);
  return { active: all.find((l) => l.id === id) ?? all[all.length - 1], all };
}

/** Identidade para a IA e as ações a partir do vínculo (o contexto só vai para as ações). */
export function chatIdentityFromLink(link: LinkRow, others: LinkRow[] = []): ChatIdentity {
  const ctx = open("contact_links.context_enc", link.context_enc);
  return {
    externalId: open("contact_links.external_id_enc", link.external_id_enc),
    userDisplay: link.display?.name ? { name: link.display.name } : null,
    contextDisplay: link.display?.workspace_name ?? null,
    context: ctx ? (JSON.parse(ctx) as Record<string, unknown>) : null,
    source: "pairing",
    ageVerified: null,
    otherContexts: others.filter((o) => o.id !== link.id).map((o) => linkLabel(o.display)),
  };
}

/** Colunas da conversa no contexto deste vínculo (trecho novo a partir de agora). */
export function linkConversationColumns(link: LinkRow | null, now = new Date().toISOString()): Record<string, unknown> {
  if (!link) return { identity_hash: null, context_hash: null, context_enc: null, context_source: null, context_display: null, context_since: now };
  return {
    identity_hash: link.external_id_hash,
    context_hash: link.context_hash,
    context_enc: link.context_enc ? sealField("conversations.context_enc", openField("contact_links.context_enc", link.context_enc)) : null,
    context_source: "pairing",
    context_display: linkLabel(link.display),
    context_since: now,
  };
}

/** Conversa nova de um contato vinculado: já nasce no contexto ativo (sem trecho anterior). */
export async function linkColumnsForContact(db: SupabaseClient, contactId: string | null): Promise<Record<string, unknown>> {
  if (!contactId) return {};
  const { active } = await activeLinkOf(db, contactId);
  if (!active) return {};
  const { context_since: _since, ...cols } = linkConversationColumns(active);
  void _since;
  return cols;
}

/** A conversa entra no contexto do vínculo (ou sai de qualquer contexto, com null). */
export async function applyLinkToConversation(db: SupabaseClient, conversationId: string, link: LinkRow | null): Promise<void> {
  const { error } = await db.from("conversations").update(linkConversationColumns(link)).eq("id", conversationId);
  if (error) console.error("pareamento: conversa não atualizada", error.message);
}

async function linkFromPairing(db: SupabaseClient, p: PairingRow, contactId: string): Promise<LinkRow> {
  const now = new Date().toISOString();
  // o código é de uso único: só um contato consome (outra mensagem ao mesmo tempo perde)
  const { data: used } = await db.from("pairing_codes").update({ used_at: now, used_by_contact_id: contactId }).eq("id", p.id).is("used_at", null).select("id");
  if (!used?.length) throw new Error("pairing_used");
  const row = {
    bot_id: p.bot_id,
    contact_id: contactId,
    channel: p.channel,
    external_id_hash: p.external_id_hash,
    external_id_enc: seal("contact_links.external_id_enc", openField("pairing_codes.external_id_enc", p.external_id_enc)),
    context_hash: p.context_hash,
    context_enc: p.context_enc ? seal("contact_links.context_enc", openField("pairing_codes.context_enc", p.context_enc)) : null,
    display: p.display,
    pairing_id: p.id,
  };
  // mesma conta e mesmo contexto já vinculados: renova o display (não duplica)
  const existing = (await activeLinks(db, contactId)).find((l) => l.external_id_hash === p.external_id_hash && (l.context_hash ?? "") === (p.context_hash ?? ""));
  if (existing) {
    const { data } = await db.from("contact_links").update({ display: p.display, pairing_id: p.id, last_used_at: now }).eq("id", existing.id).select(LINK_COLS).single<LinkRow>();
    return data ?? existing;
  }
  const { data, error } = await db.from("contact_links").insert(row).select(LINK_COLS).single<LinkRow>();
  if (error || !data) throw new Error(`vínculo não criado: ${error?.message}`);
  return data;
}

/** Desfaz um vínculo; se era o ativo, o contato passa para o mais recente que sobrou (ou nenhum). */
export async function unlinkLink(db: SupabaseClient, link: Pick<LinkRow, "id" | "contact_id">, reason: string): Promise<boolean> {
  const { data } = await db.from("contact_links").update({ unlinked_at: new Date().toISOString(), unlink_reason: reason }).eq("id", link.id).is("unlinked_at", null).select("id");
  if (!data?.length) return false;
  if ((await contactActiveLinkId(db, link.contact_id)) === link.id) {
    const rest = await activeLinks(db, link.contact_id);
    const next = rest[rest.length - 1] ?? null;
    await setActiveLink(db, link.contact_id, next?.id ?? null, next?.display ?? null);
    // a conversa aberta muda de contexto (ou fica sem): a IA não lê o trecho da conta desconectada
    const { data: convs } = await db.from("conversations").select("id").eq("contact_id", link.contact_id).gt("last_message_at", new Date(Date.now() - 24 * 3_600_000).toISOString());
    for (const c of convs ?? []) await applyLinkToConversation(db, c.id as string, next);
  }
  return true;
}

/* ------------------------------------------------------------------ mensagens do canal */

export interface PairingIO {
  db: SupabaseClient;
  bot: { id: string; agency_id: string };
  channel: PairingChannel;
  contactId: string | null;
  /** Telefone do WhatsApp quando a Meta mandou (para o telefone esperado). */
  phone: string | null;
  /** A conversa do contato (abre se não houver). */
  conversation: () => Promise<string | null>;
  /** Grava a mensagem i da rajada na conversa. */
  store: (i: number, conversationId: string) => Promise<void>;
  /** Resposta fixa (gravada como do sistema), com botões quando houver. */
  reply: (conversationId: string | null, text: string, buttons?: Array<{ id: string; title: string }>) => Promise<void>;
}

export interface PairingMessage {
  /** Texto para o pareamento (no Instagram, o ref do link vira "Conectar REF"). */
  text: string | null;
  /** Botão tocado (pair_yes:<id> / pair_no:<id>). */
  buttonId: string | null;
}

const hourWindow = () => new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();

/** Já passou de 5 códigos inválidos nesta hora? (lê o contador sem gastar uma tentativa) */
async function invalidBlocked(db: SupabaseClient, key: string): Promise<boolean> {
  const { data } = await db.from("rate_limits").select("hits").eq("key", key).eq("window_start", hourWindow()).maybeSingle();
  return Number(data?.hits ?? 0) >= MAX_INVALID_CODES;
}

/**
 * Trata o pareamento numa rajada de mensagens: "Conectar ABC123" (e o ref do Instagram), os
 * botões da confirmação e "desconectar". Devolve os índices tratados (a IA não responde a eles).
 */
export async function handlePairing(io: PairingIO, items: PairingMessage[]): Promise<Set<number>> {
  const handled = new Set<number>();
  if (!io.contactId) return handled;
  const contactId = io.contactId;
  const invalidKey = `pair:inv:${io.bot.id}:${contactId}`;

  for (const [i, item] of items.entries()) {
    const button = item.buttonId && /^pair_(yes|no):([0-9a-f-]{36})$/.exec(item.buttonId);
    const command = button ? null : pairingCommand(item.text);
    const unlink = !button && !command && isUnlinkCommand(item.text);
    if (!button && !command && !unlink) continue;

    if (command && !command.explicit) {
      // código sozinho: só conta se ele existir (senão é uma mensagem qualquer)
      if (!CODE_RE.test(command.code) || !(await activePairing(io.db, io.bot.id, io.channel, { code: command.code }))) continue;
    }
    handled.add(i);
    const convId = await io.conversation();
    if (convId) await io.store(i, convId);

    if (unlink) {
      const { active, all } = await activeLinkOf(io.db, contactId);
      if (!active) {
        await io.reply(convId, PAIRING_TEXTS.notLinked(io.channel));
        continue;
      }
      await unlinkLink(io.db, active, "chat");
      await io.reply(convId, PAIRING_TEXTS.unlinked(io.channel, linkLabel(active.display), all.filter((l) => l.id !== active.id).map((l) => linkLabel(l.display))));
      continue;
    }

    if (button) {
      const p = await activePairing(io.db, io.bot.id, io.channel, { id: button[2] });
      if (!p) await io.reply(convId, PAIRING_TEXTS.invalid);
      else if (button[1] === "no") await io.reply(convId, PAIRING_TEXTS.cancelled);
      else await finishPairing(io, p, contactId, convId);
      continue;
    }

    // "Conectar ABC123": depois de 5 códigos inválidos na hora, nenhum código é aceito (sem resposta)
    if (await invalidBlocked(io.db, invalidKey)) continue;
    const p = CODE_RE.test(command!.code) ? await activePairing(io.db, io.bot.id, io.channel, { code: command!.code }) : null;
    if (!p) {
      await io.db.rpc("hit_rate_limit", { p_key: invalidKey, p_max: MAX_INVALID_CODES, p_window_seconds: 3600 });
      await io.reply(convId, PAIRING_TEXTS.invalid);
      continue;
    }
    // telefone esperado: código de outro número é recusado
    if (p.expected_phone_hash) {
      const phone = canonicalPhone(io.phone ?? (await contactPhone(io.db, contactId)));
      if (!phone) {
        await io.reply(convId, PAIRING_TEXTS.noPhone);
        continue;
      }
      if (phoneHash(phone) !== p.expected_phone_hash) {
        await io.db.rpc("hit_rate_limit", { p_key: invalidKey, p_max: MAX_INVALID_CODES, p_window_seconds: 3600 });
        await io.reply(convId, PAIRING_TEXTS.otherPhone);
        continue;
      }
    }
    // golpe inverso: já conectado a outra conta, confirma antes (sem vínculo anterior, conecta direto)
    const others = (await activeLinks(io.db, contactId)).filter((l) => l.external_id_hash !== p.external_id_hash);
    if (others.length) {
      const ask = io.channel === "whatsapp" ? PAIRING_TEXTS.confirm : PAIRING_TEXTS.confirmInstagram;
      await io.reply(convId, ask(linkLabel(others[others.length - 1].display, { byName: true }), linkLabel(p.display, { byName: true })), [
        { id: `pair_yes:${p.id}`, title: "Conectar" },
        { id: `pair_no:${p.id}`, title: "Cancelar" },
      ]);
      continue;
    }
    await finishPairing(io, p, contactId, convId);
  }
  return handled;
}

async function finishPairing(io: PairingIO, p: PairingRow, contactId: string, convId: string | null): Promise<void> {
  let link: LinkRow;
  try {
    link = await linkFromPairing(io.db, p, contactId);
  } catch (e) {
    console.error("pareamento: vínculo não criado", (e as Error).message);
    await io.reply(convId, PAIRING_TEXTS.invalid);
    return;
  }
  await setActiveLink(io.db, contactId, link.id, link.display);
  if (convId) await applyLinkToConversation(io.db, convId, link);
  await io.reply(convId, PAIRING_TEXTS.linked(io.channel, linkLabel(link.display)));
}

/* ------------------------------------------------------------------ troca de contexto (ferramenta da IA) */

const norm = (s: string) => normalizeGateText(s).trim();

/** O vínculo que a pessoa pediu ("trocar para Empresa X"): um, nenhum ou ambíguo. Função pura. */
export function matchLink(links: LinkRow[], wanted: string): { link: LinkRow } | { options: string[] } {
  const w = norm(wanted);
  const hits = links.filter((l) => {
    const label = norm(linkLabel(l.display));
    const name = l.display?.name ? norm(l.display.name) : "";
    return w && (label.includes(w) || w.includes(label) || (name && (name.includes(w) || w.includes(name))));
  });
  return hits.length === 1 ? { link: hits[0] } : { options: (hits.length ? hits : links).map((l) => linkLabel(l.display)) };
}

/** trocar_contexto: só com 2 ou mais contas conectadas; troca o contexto ativo e abre um trecho novo. */
export function contextSwitchTool(db: SupabaseClient, i: { contactId: string; conversationId: string; links: LinkRow[]; activeId: string | null }): Record<string, Tool> {
  if (i.links.length < 2) return {};
  const names = i.links.map((l) => linkLabel(l.display)).join("; ");
  return {
    trocar_contexto: tool({
      description: `Troca a conta ativa desta conversa entre as já conectadas (${names}). Use quando a pessoa pedir para trocar ("trocar para Empresa X"). Se não der para saber qual, pergunte.`,
      inputSchema: z.object({ conta: z.string().min(1).describe("nome da conta ou do workspace, como a pessoa disse") }),
      execute: async ({ conta }) => {
        const m = matchLink(i.links, conta);
        if (!("link" in m)) return { ok: false, motivo: "ambiguo", opcoes: m.options, instrucao: "Pergunte qual destas contas a pessoa quer." };
        if (m.link.id === i.activeId) return { ok: true, conta: linkLabel(m.link.display), instrucao: "Diga que a conversa já está nessa conta." };
        await setActiveLink(db, i.contactId, m.link.id, m.link.display);
        await applyLinkToConversation(db, i.conversationId, m.link);
        return { ok: true, conta: linkLabel(m.link.display), instrucao: `Diga que agora a conversa está em ${linkLabel(m.link.display)}. As próximas consultas usam essa conta.` };
      },
    }),
  };
}
