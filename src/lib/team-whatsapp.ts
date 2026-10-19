import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLATFORM_SCOPE, openNullable, sealField } from "./field-cipher";
import { canonicalPhone } from "./phone";
import { metaPhoneHash, phoneHash, whatsappContact } from "./contacts";
import { TEMPLATE_LANGUAGE, createTemplate, listTemplates, loadTemplateChannel, renderTemplate, sendTemplate, type Template, type TemplateChannel } from "./whatsapp-templates";
import { activeSuppressions, blocks, suppress, suppressionScope } from "./suppression";
import { deliver } from "./send";
import { firstExceeded } from "./rate-limit";
import { normalizeKeyword } from "./routines";
import { company } from "./company";
import { SYSTEM_AUTHOR } from "./chat";
import type { MessageComponent } from "./components";

/*
 * Avisos e assistente no WhatsApp (leva de 19/10/2026, parte 1): a BoaVoz atende pelo próprio
 * produto. Um chatbot da plataforma (platform_flags.assistant_bot_id), com número próprio, manda os
 * avisos da conta para a equipe do painel e responde sobre o app. Cada pessoa da equipe põe o número
 * no painel e confirma pelo botão do modelo que chega no WhatsApp (aceite duplo: o "Confirmar" prova
 * que o número é dela e que ela quer; "Não fui eu" bloqueia o número para sempre, com a supressão de
 * tudo). Só a equipe do painel: a área do cliente mostraria a marca BoaVoz no lugar da agência.
 */

/** O modelo de utilidade que pede a confirmação (criado pelo backoffice na conta do assistente). */
export const NOTICE_TEMPLATE = "boavoz_confirmar_avisos";
export const NOTICE_TEMPLATE_BODY = `Olá, {{1}}! Aqui é a ${company.brand}. Você pediu no painel para receber por aqui os avisos da conta {{2}}. Toque em Confirmar para ativar.`;
export const NOTICE_YES = "Confirmar";
export const NOTICE_NO = "Não fui eu";
/** Os botões do modelo voltam com "avs:sim:<nonce>" e "avs:nao:<nonce>". */
export const NOTICE_BUTTON_PREFIX = "avs:";
export const NOTICE_CONSENT_VERSION = "2026-10-19";
/** O que a pessoa lê no painel antes de pedir (o aceite). */
export const NOTICE_CONSENT_TEXT = `Ao tocar em "Receber no WhatsApp", você aceita receber do número da ${company.brand} os avisos da sua conta (como atendimento urgente, lead novo e cobrança; você escolhe quais em Meu perfil) e pode conversar com o assistente da ${company.brand} por lá. A confirmação é pelo botão que chega no WhatsApp. Para parar, mande SAIR por lá ou desligue aqui.`;

/** Pedidos por dia: por pessoa e por agência (ninguém usa o painel para mandar mensagem a números de outros). */
const REQUESTS_PER_MEMBER = 3;
const REQUESTS_PER_AGENCY = 10;
const SEND_TIMEOUT_MS = 15_000;

export const NOTICE_TEXTS = {
  confirmed: (name: string, agency: string) =>
    `Pronto, ${name}! Os avisos da ${agency} chegam por aqui (você escolhe quais em Meu perfil, no painel). E pode me perguntar o que quiser sobre o ${company.brand}: como conectar o WhatsApp de um cliente, montar um roteiro, os tamanhos e os preços. Para parar os avisos, mande SAIR.`,
  already: `Os avisos já estão ligados por aqui. Pode me perguntar o que quiser sobre o ${company.brand}.`,
  refused: "Tudo bem: não vou mandar mais nada para este número. Desculpe o incômodo.",
  stale: "Esse pedido não vale mais. Para receber os avisos, peça de novo no painel, em Meu perfil.",
} as const;

/* ------------------------------------------------------------------ puras */

/** O toque num botão do modelo de confirmação. Pura. */
export function parseNoticeButton(id: string | null | undefined): { kind: "sim" | "nao"; nonce: string } | null {
  const m = /^avs:(sim|nao):([0-9a-f]{12})$/.exec(id ?? "");
  return m ? { kind: m[1] as "sim" | "nao", nonce: m[2] } : null;
}

const TYPED_YES = new Set(["confirmar", "confirmo", "sim", "sim confirmo", "pode confirmar", "confirmado"]);
const TYPED_NO = new Set(["nao fui eu", "nao fui", "nao pedi", "nao pedi isso"]);

/** A resposta digitada no lugar do botão (só vale com um pedido em aberto para o número). Pura. */
export function typedNoticeAnswer(text: string | null | undefined): "sim" | "nao" | null {
  const t = normalizeKeyword(text ?? "");
  return TYPED_YES.has(t) ? "sim" : TYPED_NO.has(t) ? "nao" : null;
}

/** "+55 41 9•••• 0000": o número para a tela, sem o meio. Pura. */
export function maskPhone(canonical: string): string {
  const d = canonical.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) return `+55 ${d.slice(2, 4)} ${d.slice(4, 5)}•••• ${d.slice(-4)}`;
  return `+${d.slice(0, Math.max(1, d.length - 8))} •••• ${d.slice(-4)}`;
}

/** Texto de variável do modelo: uma linha, sem espaços seguidos (regra da Meta), com reserva. Pura. */
export function templateValue(raw: string | null | undefined, fallback: string): string {
  const v = (raw ?? "").replace(/\s+/g, " ").replace(/[{}]/g, "").trim().slice(0, 60);
  return v || fallback;
}

/** Primeiro nome para o modelo: o de exibição, senão o começo do e-mail. Pura. */
export function firstNameOf(m: { display_name?: string | null; email?: string | null }): string {
  const name = (m.display_name ?? "").trim().split(/\s+/)[0] ?? "";
  const fromEmail = (m.email ?? "").split("@")[0]?.replace(/[._-]+/g, " ").trim().split(/\s+/)[0] ?? "";
  const raw = name || fromEmail;
  return templateValue(raw ? raw[0].toUpperCase() + raw.slice(1) : "", "tudo bem");
}

/** Os botões do modelo como a conversa do assistente guarda (o painel mostra; o toque volta por eles). Pura. */
export function noticeButtons(nonce: string): MessageComponent {
  return { type: "options", options: [{ id: `${NOTICE_BUTTON_PREFIX}sim:${nonce}`, title: NOTICE_YES }, { id: `${NOTICE_BUTTON_PREFIX}nao:${nonce}`, title: NOTICE_NO }] };
}

export type NoticeTemplateStatus = "aprovado" | "em_analise" | "recusado" | "reclassificado" | "ausente";

/** Estado do modelo de confirmação na conta do assistente. Pura. */
export function noticeTemplateStatus(templates: Template[]): NoticeTemplateStatus {
  const t = templates.find((x) => x.name === NOTICE_TEMPLATE && x.language === TEMPLATE_LANGUAGE);
  if (!t) return "ausente";
  if (t.category !== "UTILITY") return "reclassificado";
  if (t.status === "APPROVED") return "aprovado";
  if (t.status === "REJECTED" || t.status === "DISABLED" || t.status === "PAUSED") return "recusado";
  return "em_analise";
}

/* ------------------------------------------------------------------ o assistente */

let cachedBot: { at: number; botId: string | null } | null = null;

/** O chatbot da BoaVoz (o assistente), ou null se ninguém configurou no backoffice. */
export async function assistantBotId(db: SupabaseClient): Promise<string | null> {
  if (cachedBot && Date.now() - cachedBot.at < 60_000) return cachedBot.botId;
  const { data } = await db.from("platform_flags").select("assistant_bot_id").eq("id", 1).maybeSingle();
  cachedBot = { at: Date.now(), botId: ((data as { assistant_bot_id?: string | null } | null)?.assistant_bot_id as string | null) ?? null };
  return cachedBot.botId;
}

/** Depois de trocar o assistente no backoffice. */
export function forgetAssistantCache(): void {
  cachedBot = null;
  cachedChannel = null;
}

type AssistantChannel = { botId: string; agencyId: string; ch: TemplateChannel };
let cachedChannel: { at: number; botId: string; value: AssistantChannel | null } | null = null;

/**
 * O assistente pronto para mandar: o chatbot configurado com o WhatsApp conectado (e a conta do
 * WhatsApp Business). Guardado por 1 minuto: o painel pergunta em toda página.
 */
export async function assistantChannel(db: SupabaseClient): Promise<AssistantChannel | null> {
  const botId = await assistantBotId(db);
  if (!botId) return null;
  if (cachedChannel && cachedChannel.botId === botId && Date.now() - cachedChannel.at < 60_000) return cachedChannel.value;
  const [ch, { data: bot }] = await Promise.all([loadTemplateChannel(db, botId), db.from("bots").select("agency_id").eq("id", botId).maybeSingle()]);
  const value = ch && bot ? { botId, agencyId: String(bot.agency_id), ch } : null;
  cachedChannel = { at: Date.now(), botId, value };
  return value;
}

/** Cria o modelo de confirmação na conta do assistente, se faltar. Devolve o estado. */
export async function ensureNoticeTemplate(ch: TemplateChannel): Promise<NoticeTemplateStatus> {
  const current = noticeTemplateStatus(await listTemplates(ch));
  if (current !== "ausente") return current;
  await createTemplate(ch, { name: NOTICE_TEMPLATE, category: "UTILITY", body: NOTICE_TEMPLATE_BODY, examples: ["Ana", "Norte Marketing"], quickReplies: [NOTICE_YES, NOTICE_NO] });
  return "em_analise";
}

/* ------------------------------------------------------------------ o número de cada pessoa */

export type TeamWhatsAppStatus = "pending" | "confirmed" | "refused";

export interface TeamWhatsApp {
  memberId: string;
  agencyId: string;
  phone: string;
  status: TeamWhatsAppStatus;
  requestedAt: string;
  confirmedAt: string | null;
  refusedAt: string | null;
  prefs: Record<string, boolean>;
}

const COLS = "member_id, agency_id, phone_enc, status, requested_at, confirmed_at, refused_at, prefs";
type Row = { member_id: string; agency_id: string; phone_enc: string; status: TeamWhatsAppStatus; requested_at: string; confirmed_at: string | null; refused_at: string | null; prefs: Record<string, boolean> | null };

async function opened(r: Row): Promise<TeamWhatsApp> {
  return { memberId: r.member_id, agencyId: r.agency_id, phone: (await openNullable("team_whatsapp.phone_enc", r.phone_enc)) ?? "", status: r.status, requestedAt: r.requested_at, confirmedAt: r.confirmed_at, refusedAt: r.refused_at, prefs: r.prefs ?? {} };
}

export async function loadTeamWhatsApp(db: SupabaseClient, memberId: string): Promise<TeamWhatsApp | null> {
  const { data } = await db.from("team_whatsapp").select(COLS).eq("member_id", memberId).maybeSingle<Row>();
  return data ? opened(data) : null;
}

export interface NoticeStatus {
  /** O assistente da BoaVoz está configurado e conectado (sem ele, o painel não mostra nada). */
  available: boolean;
  status: TeamWhatsAppStatus | null;
  masked: string | null;
  confirmedAt: string | null;
  /** Confirmado, mas a pessoa mandou SAIR no WhatsApp (o "Foi engano" de lá devolve). */
  stopped: boolean;
  /** "Agora não" no cartão do topo. */
  dismissed: boolean;
}

/** O que o painel mostra para a pessoa: os avisos existem nesta plataforma? O número dela e o estado. */
export async function noticeStatus(db: SupabaseClient, memberId: string): Promise<NoticeStatus> {
  const assistant = await assistantChannel(db);
  if (!assistant) return { available: false, status: null, masked: null, confirmedAt: null, stopped: false, dismissed: false };
  const [row, { data: m }] = await Promise.all([loadTeamWhatsApp(db, memberId), db.from("agency_members").select("whatsapp_card_dismissed_at").eq("id", memberId).maybeSingle()]);
  const stopped = Boolean(row?.status === "confirmed" && row.phone && blocks((await activeSuppressions(db, { channel: "whatsapp", scope: suppressionScope({ wabaId: assistant.ch.waba_id, botId: assistant.botId }), contact: row.phone })).map((s) => s.kind), "UTILITY"));
  return { available: true, status: row?.status ?? null, masked: row?.phone ? maskPhone(row.phone) : null, confirmedAt: row?.confirmedAt ?? null, stopped, dismissed: Boolean(m?.whatsapp_card_dismissed_at) };
}

/** A pessoa saiu da equipe (ou pediu para parar): o número sai. */
export async function forgetTeamWhatsApp(db: SupabaseClient, memberId: string): Promise<void> {
  const { error } = await db.from("team_whatsapp").delete().eq("member_id", memberId);
  if (error) console.error("avisos: número da equipe não saiu", error.message);
}

/** "Agora não" no cartão do topo do painel. */
export async function dismissNoticeCard(db: SupabaseClient, memberId: string): Promise<void> {
  await db.from("agency_members").update({ whatsapp_card_dismissed_at: new Date().toISOString() }).eq("id", memberId);
}

/** A conversa do número com o assistente (a recente, senão uma nova): o modelo e as respostas ficam nela. */
async function assistantConversation(db: SupabaseClient, a: { botId: string; agencyId: string }, phone: string): Promise<string | null> {
  const contact = await whatsappContact(db, { id: a.botId, agency_id: a.agencyId }, { phone });
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  let q = db.from("conversations").select("id").eq("bot_id", a.botId).eq("channel", "whatsapp").gt("last_message_at", since);
  q = contact ? q.eq("contact_id", contact.id) : q.eq("wa_id", phone);
  const { data: recent } = await q.order("last_message_at", { ascending: false }).limit(1).maybeSingle();
  if (recent) return recent.id as string;
  const { data, error } = await db.from("conversations").insert({ bot_id: a.botId, channel: "whatsapp", wa_id: phone, contact_id: contact?.id ?? null, visitor_id: null }).select("id").single();
  if (error) console.error("avisos: conversa do assistente não abriu", error.message);
  return (data?.id as string | undefined) ?? null;
}

/**
 * O pedido no painel: confere o número, os limites, a supressão e se ele já é de outra pessoa;
 * grava o pedido em aberto e manda o modelo com "Confirmar" e "Não fui eu" pelo número da BoaVoz.
 */
export async function requestTeamWhatsApp(
  db: SupabaseClient,
  i: { member: { id: string; display_name?: string | null; email?: string | null }; agency: { id: string; name: string }; rawPhone: string },
): Promise<{ ok: true; masked: string } | { ok: false; message: string }> {
  const phone = canonicalPhone(i.rawPhone, { typed: true });
  if (!phone || phone.length < 12) return { ok: false, message: "Confira o número: DDD e o celular, como (41) 99999-0000." };
  const a = await assistantChannel(db);
  if (!a) return { ok: false, message: "Os avisos pelo WhatsApp ainda não estão disponíveis." };
  const over = await firstExceeded(db, [
    { key: `avisos:pedido:${i.member.id}`, max: REQUESTS_PER_MEMBER, windowSeconds: 86_400, message: "muitos" },
    { key: `avisos:pedido:ag:${i.agency.id}`, max: REQUESTS_PER_AGENCY, windowSeconds: 86_400, message: "muitos" },
  ]);
  if (over) return { ok: false, message: "Muitos pedidos hoje. Tente de novo amanhã." };
  const scope = suppressionScope({ wabaId: a.ch.waba_id, botId: a.botId });
  if (blocks((await activeSuppressions(db, { channel: "whatsapp", scope, contact: phone })).map((s) => s.kind), "UTILITY")) {
    return { ok: false, message: `Este número pediu para não receber mensagens da ${company.brand}. Use outro número.` };
  }
  const hash = phoneHash(phone);
  const { data: other } = await db.from("team_whatsapp").select("member_id").eq("phone_hash", hash).in("status", ["pending", "confirmed"]).neq("member_id", i.member.id).limit(1).maybeSingle();
  if (other) return { ok: false, message: "Este número já recebe os avisos de outra pessoa." };

  let template: Template | undefined;
  try {
    template = (await listTemplates(a.ch)).find((t) => t.name === NOTICE_TEMPLATE && t.language === TEMPLATE_LANGUAGE && t.status === "APPROVED" && t.category === "UTILITY");
  } catch (e) {
    console.error("avisos: modelos do assistente não leram", (e as Error).message);
  }
  if (!template) return { ok: false, message: "Os avisos pelo WhatsApp ainda não estão disponíveis (o modelo da mensagem está em análise na Meta). Tente mais tarde." };

  const nonce = randomBytes(6).toString("hex");
  const now = new Date().toISOString();
  const { error } = await db.from("team_whatsapp").upsert(
    { member_id: i.member.id, agency_id: i.agency.id, phone_enc: await sealField("team_whatsapp.phone_enc", phone, PLATFORM_SCOPE), phone_hash: hash, status: "pending", consent_version: NOTICE_CONSENT_VERSION, requested_at: now, nonce, confirmed_at: null, refused_at: null, updated_at: now },
    { onConflict: "member_id" },
  );
  // o índice único pegou outro pedido para o mesmo número ao mesmo tempo
  if (error) return { ok: false, message: error.code === "23505" ? "Este número já recebe os avisos de outra pessoa." : "Não foi possível salvar. Tente de novo." };

  const variables = [firstNameOf(i.member), templateValue(i.agency.name, "sua agência")];
  const convId = await assistantConversation(db, a, phone);
  try {
    const r = await deliver(db, {
      botId: a.botId,
      channel: "whatsapp",
      conversationId: convId,
      kind: "modelo",
      record: convId ? { insert: { role: "assistant", content: renderTemplate(NOTICE_TEMPLATE_BODY, variables), author: SYSTEM_AUTHOR, template_category: "UTILITY", components: noticeButtons(nonce) } } : null,
      transport: async () => (await sendTemplate(a.ch, phone, template, variables, { buttonPayloads: [`${NOTICE_BUTTON_PREFIX}sim:${nonce}`, `${NOTICE_BUTTON_PREFIX}nao:${nonce}`], timeoutMs: SEND_TIMEOUT_MS })).messages?.[0]?.id ?? null,
    });
    if (r.status === "blocked") return { ok: false, message: `O número da ${company.brand} não pode mandar mensagens agora. Tente mais tarde.` };
  } catch (e) {
    console.error("avisos: modelo de confirmação não saiu", (e as Error).message, (e as { code?: number }).code ?? "");
    return { ok: false, message: "Não deu para mandar a mensagem para esse número. Confira o número (com DDD) e tente de novo." };
  }
  return { ok: true, masked: maskPhone(phone) };
}

/* ------------------------------------------------------------------ o toque no WhatsApp */

export interface NoticeIO {
  db: SupabaseClient;
  bot: { id: string };
  channel: { waba_id?: string | null };
  /** O número que escreveu (wa_id da Meta). */
  waId: string;
  /** A conversa (abre se não houver). */
  conversation: () => Promise<string | null>;
  store: (i: number, conversationId: string) => Promise<void>;
  reply: (conversationId: string | null, text: string) => Promise<void>;
}

/**
 * No chatbot da BoaVoz: o toque em "Confirmar" ou "Não fui eu" (ou a resposta digitada, com um
 * pedido em aberto para o número) liga os avisos ou bloqueia o número. Devolve as mensagens tratadas
 * aqui (a IA não responde a elas). Nos outros chatbots, nada.
 */
export async function handleTeamNotices(io: NoticeIO, items: Array<{ text: string | null; buttonId: string | null }>): Promise<Set<number>> {
  const handled = new Set<number>();
  if ((await assistantBotId(io.db)) !== io.bot.id) return handled;
  const hash = metaPhoneHash(io.waId);
  if (!hash) return handled;
  type Found = { member_id: string; status: TeamWhatsAppStatus; nonce: string; agency_members: { display_name: string | null; email: string } | Array<{ display_name: string | null; email: string }> | null; agencies: { name: string } | Array<{ name: string }> | null };
  // o pedido do número (lido uma vez por rajada)
  const cache: { row?: Found | null } = {};
  const find = async (): Promise<Found | null> => {
    if (cache.row === undefined) {
      const { data } = await io.db.from("team_whatsapp").select("member_id, status, nonce, agency_members(display_name, email), agencies(name)").eq("phone_hash", hash).in("status", ["pending", "confirmed"]).maybeSingle<Found>();
      cache.row = data ?? null;
    }
    return cache.row;
  };
  for (const [i, it] of items.entries()) {
    const click = parseNoticeButton(it.buttonId);
    const typed = click ? null : typedNoticeAnswer(it.text);
    if (!click && !typed) continue;
    // digitado só vale com o pedido em aberto (senão é conversa com o assistente)
    if (typed && (await find())?.status !== "pending") continue;
    handled.add(i);
    const convId = await io.conversation();
    if (convId) await io.store(i, convId);
    const kind = click?.kind ?? typed!;
    const r = await find();
    const matches = Boolean(r && (typed || r.nonce === click?.nonce));
    if (kind === "sim") {
      if (r?.status === "confirmed") {
        await io.reply(convId, NOTICE_TEXTS.already);
      } else if (r && matches) {
        const now = new Date().toISOString();
        await io.db.from("team_whatsapp").update({ status: "confirmed", confirmed_at: now, updated_at: now }).eq("member_id", r.member_id).eq("status", "pending");
        cache.row = { ...r, status: "confirmed" };
        const m = Array.isArray(r.agency_members) ? r.agency_members[0] : r.agency_members;
        const ag = Array.isArray(r.agencies) ? r.agencies[0] : r.agencies;
        await io.reply(convId, NOTICE_TEXTS.confirmed(firstNameOf(m ?? {}), ag?.name ?? "sua agência"));
      } else {
        await io.reply(convId, NOTICE_TEXTS.stale);
      }
      continue;
    }
    // "Não fui eu" vale sempre: o número nunca mais recebe nada iniciado pela BoaVoz
    if (r && (matches || r.status === "pending")) {
      const now = new Date().toISOString();
      await io.db.from("team_whatsapp").update({ status: "refused", refused_at: now, updated_at: now }).eq("member_id", r.member_id);
      cache.row = null;
    }
    await suppress(io.db, { channel: "whatsapp", scope: suppressionScope({ wabaId: io.channel.waba_id ?? null, botId: io.bot.id }), contact: io.waId, kind: "all", reason: "opt_out", source: "chat:nao_fui_eu" });
    await io.reply(convId, NOTICE_TEXTS.refused);
  }
  return handled;
}

/* ------------------------------------------------------------------ backoffice */

export interface AssistantOverview {
  botId: string | null;
  /** "BoaVoz (assistente) · cliente (agência)", ou null sem chatbot. */
  label: string | null;
  /** O WhatsApp do chatbot está conectado (com a conta do WhatsApp Business). */
  connected: boolean;
  template: NoticeTemplateStatus | "erro" | null;
  confirmed: number;
  pending: number;
}

/** O assistente da BoaVoz para o backoffice: o chatbot, o WhatsApp, o modelo de confirmação e quantos números. */
export async function assistantOverview(db: SupabaseClient): Promise<AssistantOverview> {
  const { data: flags } = await db.from("platform_flags").select("assistant_bot_id").eq("id", 1).maybeSingle();
  const botId = ((flags as { assistant_bot_id?: string | null } | null)?.assistant_bot_id as string | null) ?? null;
  const count = async (status: TeamWhatsAppStatus) => (await db.from("team_whatsapp").select("member_id", { count: "exact", head: true }).eq("status", status)).count ?? 0;
  const [confirmed, pending] = await Promise.all([count("confirmed"), count("pending")]);
  if (!botId) return { botId: null, label: null, connected: false, template: null, confirmed, pending };
  const [{ data: bot }, ch] = await Promise.all([db.from("bots").select("name, client_name, agencies(name)").eq("id", botId).maybeSingle(), loadTemplateChannel(db, botId)]);
  const agency = bot ? ((Array.isArray(bot.agencies) ? bot.agencies[0] : bot.agencies) as { name?: string } | null)?.name : null;
  let template: AssistantOverview["template"] = null;
  if (ch) {
    try {
      template = noticeTemplateStatus(await listTemplates(ch));
    } catch (e) {
      console.error("avisos: modelos do assistente não leram", (e as Error).message);
      template = "erro";
    }
  }
  return { botId, label: bot ? `${bot.name} · ${bot.client_name}${agency ? ` (${agency})` : ""}` : null, connected: Boolean(ch), template, confirmed, pending };
}
