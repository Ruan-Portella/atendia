import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "./audit";
import { logDeletion } from "./deletions";
import { notifyAgencyOwner } from "./notify";
import { appUrl } from "./utils";
import { contactsForErasure, deleteContacts, type ErasureContact } from "./contacts";
import { deleteLeads, leadIdsOfConversations } from "./leads";
import { deleteUnanswered, unansweredIdsOfConversations } from "./unanswered";
import { deleteActionCallsOfConversations } from "./actions";
import { deleteContactDeliveries, emitContactDeleted } from "./webhooks";
import { deleteAgesOf } from "./gate/age";
import { suppress, suppressionScope } from "./suppression";
import { deliver } from "./send";
import { sendText } from "./whatsapp";
import { purgeAttachments } from "./attachments";

/*
 * Pedido do titular (LGPD, art. 18; leva S). Pelo chat: o contato escreve "apaga meus dados", o
 * assistente pergunta se é isso mesmo (botões no WhatsApp e no Instagram, SIM/NÃO no site) e, no
 * "sim", o pedido fica aguardando a agência, que confirma em Segurança (operadora, em nome do
 * negócio). A rotina única de exclusão (eraseTargets) serve ao chat, ao painel e, na C pública, à
 * API: apaga entregas de webhook e chamadas de ações do contato, perguntas, leads, conversas (com
 * as mensagens), o 18+ e a ficha; põe os números na supressão (5 anos, só o hash); emite
 * contact.deleted; e, pelo chat, confirma ao contato se a janela do canal estiver aberta.
 */

export const ERASE_YES = "erase_yes";
export const ERASE_NO = "erase_no";
/** Prazo mostrado ao contato e à agência (LGPD, art. 19). */
export const DSR_DAYS = 15;
/** O "sim" digitado vale por este tempo depois da pergunta. */
const ASK_TTL_MS = 15 * 60_000;
const DAY = 86_400_000;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const VERB = "(apag\\w*|exclu\\w*|delet\\w*|remov\\w*|elimin\\w*|limp\\w*|esquec(?:am|a|er))";
const OBJ = "(meus dados|meu dado|dados pessoais|minhas informacoes|minha informacao|meu cadastro|meus registros|meu registro|meu historico|minhas mensagens|minhas conversas|essa conversa|esta conversa|nossa conversa|meu numero|meu telefone|meu contato)";
const FORWARD = new RegExp(`(?:^| )${VERB}(?: \\w+){0,3} ${OBJ}(?: |$)`);
const BACKWARD = new RegExp(`(?:^| )${OBJ}(?: \\w+){0,3} (apagad\\w*|excluid\\w*|deletad\\w*|removid\\w*|eliminad\\w*)`);
const NEGATED = new RegExp(`(?:^| )nao(?: \\w+){0,2} ${VERB}`);

/** "Apaga meus dados", "quero meus dados excluídos", "LGPD: exclusão"… (não: "esqueci meus dados de acesso"). Pura. */
export function isErasureRequest(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = norm(text);
  if (!t || t.length > 300) return false;
  if (NEGATED.test(t)) return false;
  if (/direito (ao|de) esquecimento/.test(t)) return true;
  if (/(^| )lgpd( |$)/.test(t) && new RegExp(VERB).test(t)) return true;
  return FORWARD.test(t) || BACKWARD.test(t);
}

/** Resposta digitada à pergunta: "sim" ou "nao" (null: outra coisa, segue normal). Pura. */
export function typedAnswer(text: string | null | undefined): "sim" | "nao" | null {
  if (!text) return null;
  const t = norm(text);
  if (t.length > 40) return null;
  if (/^(nao|n|cancela|cancelar|deixa|melhor nao)( |$)/.test(t)) return "nao";
  if (/^(sim|s|confirmo|pode|pode apagar|isso|quero|claro|ok)( |$)/.test(t)) return "sim";
  return null;
}

export const dueDateBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** Textos fixos ao contato (sem IA). */
export const ERASURE_TEXTS = {
  ask: (company: string, widget: boolean) =>
    `Você quer que a ${company} apague seus dados deste atendimento? Saem as conversas, o seu contato e o que você informou por aqui. O pedido vai para a ${company}, que conclui em até ${DSR_DAYS} dias.${widget ? " Responda SIM para confirmar ou NÃO para cancelar." : ""}`,
  registered: (company: string, due: string, widget: boolean) =>
    `Pedido registrado. A ${company} vai apagar seus dados deste atendimento até ${dueDateBR(due)}${widget ? "." : ", e você recebe a confirmação por aqui."}`,
  already: (company: string, due: string) => `Seu pedido de exclusão já está registrado. A ${company} conclui até ${dueDateBR(due)}.`,
  cancelled: "Tudo bem, nada foi apagado. Pode seguir com o atendimento.",
  done: (company: string) => `Pronto: a ${company} apagou seus dados deste atendimento (conversas e contato). Se você escrever de novo, a conversa começa do zero.`,
};

export const ERASURE_BUTTONS = [
  { id: ERASE_YES, title: "Sim, apagar" },
  { id: ERASE_NO, title: "Não" },
];

export type DsrChannel = "widget" | "whatsapp" | "instagram";

interface BotRef {
  id: string;
  agency_id: string;
  client_id?: string | null;
  client_name: string;
  name: string;
}

/* ------------------------------------------------------------------ pelo chat */

export interface ErasureIO {
  db: SupabaseClient;
  bot: BotRef;
  channel: DsrChannel;
  contactId: string | null;
  /** A conversa atual, sem abrir uma nova (para ler a pergunta em aberto). */
  currentConversation: string | null;
  /** A conversa do contato (abre se não houver). */
  conversation: () => Promise<string | null>;
  /** Grava a mensagem i na conversa. */
  store: (i: number, conversationId: string) => Promise<void>;
  /** Resposta fixa (gravada como do sistema), com botões quando houver. */
  reply: (conversationId: string | null, text: string, buttons?: Array<{ id: string; title: string }>) => Promise<void>;
}

interface PendingRow {
  id: string;
  due_at: string;
}

async function pendingRequest(db: SupabaseClient, botId: string, contactId: string | null, conversationId: string | null): Promise<PendingRow | null> {
  if (!contactId && !conversationId) return null;
  let q = db.from("data_subject_requests").select("id, due_at").eq("bot_id", botId).eq("status", "aguardando");
  q = contactId ? q.eq("contact_id", contactId) : q.eq("conversation_id", conversationId!);
  const { data } = await q.limit(1).maybeSingle();
  return (data as PendingRow | null) ?? null;
}

/**
 * Trata, numa rajada de mensagens, o pedido de exclusão e a resposta à pergunta. Devolve os índices
 * tratados (a IA não responde a eles).
 */
export async function handleErasureRequest(io: ErasureIO, items: Array<{ text: string | null; buttonId: string | null }>): Promise<Set<number>> {
  const handled = new Set<number>();
  const company = io.bot.client_name;
  const widget = io.channel === "widget";
  let askedAt: string | null = null;
  if (io.currentConversation && items.some((x) => x.text)) {
    const { data } = await io.db.from("conversations").select("erasure_asked_at").eq("id", io.currentConversation).maybeSingle();
    askedAt = (data?.erasure_asked_at as string | null) ?? null;
  }
  const setAsked = async (convId: string | null, at: string | null) => {
    askedAt = at;
    if (convId) await io.db.from("conversations").update({ erasure_asked_at: at }).eq("id", convId);
  };

  for (const [i, item] of items.entries()) {
    const button = item.buttonId === ERASE_YES ? "sim" : item.buttonId === ERASE_NO ? "nao" : null;
    const open = askedAt !== null && Date.now() - Date.parse(askedAt) < ASK_TTL_MS;
    const answer = button ?? (open ? typedAnswer(item.text) : null);
    const ask = !answer && isErasureRequest(item.text);
    if (!answer && !ask) continue;
    handled.add(i);
    const convId = await io.conversation();
    if (convId) await io.store(i, convId);
    const pending = await pendingRequest(io.db, io.bot.id, io.contactId, convId);

    if (ask) {
      if (pending) {
        await io.reply(convId, ERASURE_TEXTS.already(company, pending.due_at));
        continue;
      }
      await setAsked(convId, new Date().toISOString());
      await io.reply(convId, ERASURE_TEXTS.ask(company, widget), widget ? undefined : ERASURE_BUTTONS);
      continue;
    }
    await setAsked(convId, null);
    if (answer === "nao") {
      await io.reply(convId, ERASURE_TEXTS.cancelled);
      continue;
    }
    if (pending) {
      await io.reply(convId, ERASURE_TEXTS.already(company, pending.due_at));
      continue;
    }
    const req = await createRequest(io.db, { bot: io.bot, contactId: io.contactId, conversationId: convId, channel: io.channel, origin: "chat" });
    await io.reply(convId, ERASURE_TEXTS.registered(company, req.due_at, widget));
  }
  return handled;
}

/** Registra o pedido (aguardando a agência) e avisa o dono da agência, sem dado do contato. */
export async function createRequest(db: SupabaseClient, r: { bot: BotRef; contactId: string | null; conversationId: string | null; channel: DsrChannel; origin: "chat" }): Promise<{ id: string; due_at: string }> {
  const { data, error } = await db
    .from("data_subject_requests")
    .insert({ agency_id: r.bot.agency_id, client_id: r.bot.client_id ?? null, bot_id: r.bot.id, contact_id: r.contactId, conversation_id: r.conversationId, channel: r.channel, origin: r.origin, due_at: new Date(Date.now() + DSR_DAYS * DAY).toISOString() })
    .select("id, due_at")
    .single();
  if (error || !data) throw new Error(`pedido do titular não registrado: ${error?.message}`);
  const channelName = r.channel === "whatsapp" ? "WhatsApp" : r.channel === "instagram" ? "Instagram" : "chat do site";
  const sent = await notifyAgencyOwner(db, r.bot.agency_id, `Pedido de exclusão de dados (LGPD) · ${r.bot.client_name}`, [
    `Um contato pediu pelo ${channelName} do assistente ${r.bot.name} (${r.bot.client_name}) que os dados dele sejam apagados.`,
    "",
    `Pela LGPD, o pedido precisa ser atendido até ${dueDateBR(data.due_at as string)}. Confirme em Segurança: o BoaVoz apaga as conversas, o contato e o que ele informou, põe o número na lista de quem não recebe mensagens da empresa e avisa a pessoa.`,
    "",
    appUrl("/painel/seguranca"),
  ]).catch(() => false);
  if (sent) await db.from("data_subject_requests").update({ notified_at: new Date().toISOString() }).eq("id", data.id);
  await audit(db, { agencyId: r.bot.agency_id, actorType: "system", actorId: null, action: "titular.pedido", targetType: "bot", targetId: r.bot.id, after: { request_id: data.id, channel: r.channel } });
  return { id: data.id as string, due_at: data.due_at as string };
}

/* ------------------------------------------------------------------ rotina única de exclusão */

export interface ErasureSummary {
  conversas: number;
  arquivos: number;
  leads: number;
  perguntas: number;
  contatos: number;
  entregas: number;
  chamadas: number;
}

const BATCH = 200;
const chunked = <T,>(xs: T[], n = BATCH) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Identidades de canal de um contato (para supressão e 18+). */
function identities(c: ErasureContact): Array<{ channel: "whatsapp" | "instagram"; contact: string }> {
  if (c.channel === "whatsapp") return [c.phone, c.bsuid].filter((v): v is string => Boolean(v)).map((contact) => ({ channel: "whatsapp" as const, contact }));
  if (c.channel === "instagram" && c.igsid) return [{ channel: "instagram", contact: c.igsid }];
  return [];
}

/**
 * Apaga o que é destes contatos e conversas (e destes leads soltos), em qualquer chatbot. code: o
 * registro de exclusões; source: a origem na supressão. Devolve as contagens e as fichas apagadas.
 */
export async function eraseTargets(
  db: SupabaseClient,
  t: { contactIds: string[]; conversationIds: string[]; leadIds?: string[] },
  o: { code: string; source: "chat" | "painel" | "api" },
): Promise<ErasureSummary & { erased: ErasureContact[] }> {
  const contacts = await contactsForErasure(db, [...new Set(t.contactIds)]);
  const contactIds = contacts.map((c) => c.id);
  // todas as conversas dos contatos, mais as pedidas
  const convIds = new Set(t.conversationIds);
  for (const ids of chunked(contactIds)) {
    const { data } = await db.from("conversations").select("id").in("contact_id", ids);
    for (const c of data ?? []) convIds.add(c.id as string);
  }
  const conversations = [...convIds];
  // primeiro o que sai do BoaVoz para fora (entregas de webhook) e os logs ligados
  const entregas = await deleteContactDeliveries(db, contactIds);
  let chamadas = 0;
  for (const ids of chunked(conversations)) chamadas += await deleteActionCallsOfConversations(db, ids);
  let perguntas = 0;
  for (const ids of chunked(conversations)) {
    const q = await unansweredIdsOfConversations(db, ids);
    await logDeletion(db, "unanswered", q, o.code);
    await deleteUnanswered(db, q);
    perguntas += q.length;
  }
  const leadIds = new Set(t.leadIds ?? []);
  for (const ids of chunked(conversations)) for (const l of await leadIdsOfConversations(db, ids)) leadIds.add(l);
  let leads = 0;
  for (const ids of chunked([...leadIds])) {
    await logDeletion(db, "leads", ids, o.code);
    leads += (await deleteLeads(db, ids)) ?? 0;
  }
  // conversas: mensagens, recusas e detecções vão junto
  let arquivos = 0;
  for (const ids of chunked(conversations)) {
    await logDeletion(db, "conversations", ids, o.code);
    // arquivos recebidos: o objeto sai do Storage antes da conversa
    arquivos += await purgeAttachments(db, { conversationIds: ids });
    const { error } = await db.from("conversations").delete().in("id", ids);
    if (error) throw new Error(`exclusão das conversas: ${error.message}`);
  }
  // 18+ e supressão (5 anos, só o hash): o contato não recebe mais mensagens iniciadas pela empresa
  const wabaOf = new Map<string, string | null>();
  for (const c of contacts) {
    const who = identities(c);
    if (!who.length) continue;
    await deleteAgesOf(db, c.botId, who);
    if (c.channel === "whatsapp" && !wabaOf.has(c.botId)) {
      const { data } = await db.from("whatsapp_channels").select("waba_id").eq("bot_id", c.botId).maybeSingle();
      wabaOf.set(c.botId, (data?.waba_id as string | null) ?? null);
    }
    const scope = suppressionScope({ wabaId: c.channel === "whatsapp" ? wabaOf.get(c.botId) : null, botId: c.botId });
    for (const w of who) await suppress(db, { ...w, scope, kind: "all", reason: "erasure", source: o.source });
  }
  await logDeletion(db, "contacts", contactIds, o.code);
  if (contactIds.length) await deleteContacts(db, contactIds);
  return { conversas: conversations.length, arquivos, leads, perguntas, contatos: contactIds.length, entregas, chamadas, erased: contacts };
}

/** Confirmação ao contato pelo canal, se a janela de 24 horas ainda estiver aberta. */
async function tellContact(db: SupabaseClient, bot: BotRef, c: ErasureContact): Promise<boolean> {
  if (!c.lastInboundAt || Date.now() - Date.parse(c.lastInboundAt) > DAY) return false;
  const text = ERASURE_TEXTS.done(bot.client_name);
  try {
    if (c.channel === "whatsapp" && (c.phone || c.bsuid)) {
      const { data: ch } = await db.from("whatsapp_channels").select("phone_number_id, access_token_enc, disconnected_at").eq("bot_id", bot.id).maybeSingle();
      if (!ch || ch.disconnected_at) return false;
      const r = await deliver(db, { botId: bot.id, channel: "whatsapp", conversationId: null, kind: "sistema", record: null, transport: async () => (await sendText(ch, (c.phone ?? c.bsuid)!, text)).messages?.[0]?.id ?? null });
      return r.status === "sent";
    }
    if (c.channel === "instagram" && c.igsid) {
      const { data: ch } = await db.from("instagram_channels").select("bot_id, ig_user_id, access_token_enc, disconnected_at").eq("bot_id", bot.id).maybeSingle();
      if (!ch || ch.disconnected_at) return false;
      // a DM própria fica marcada (o eco do Instagram é ignorado e não abre conversa nova)
      const { send } = await import("./instagram-inbound");
      const r = await deliver(db, { botId: bot.id, channel: "instagram", conversationId: null, kind: "sistema", record: null, transport: () => send(db, ch as Parameters<typeof send>[1], c.igsid!, text) });
      return r.status === "sent";
    }
  } catch (e) {
    console.error("pedido do titular: confirmação ao contato não saiu", (e as Error).message);
  }
  return false;
}

/** Confirma e executa um pedido do chat (Segurança). Devolve as contagens, ou null se já executado. */
export async function executeRequest(db: SupabaseClient, requestId: string, confirmedBy: string): Promise<ErasureSummary | null> {
  const { data: req } = await db.from("data_subject_requests").select("id, agency_id, bot_id, contact_id, conversation_id, channel, origin, status").eq("id", requestId).maybeSingle();
  if (!req || req.status !== "aguardando") return null;
  const { data: bot } = req.bot_id ? await db.from("bots").select("id, agency_id, client_id, client_name, name").eq("id", req.bot_id).maybeSingle() : { data: null };
  // site: as conversas do mesmo visitante neste chatbot e, com o token da empresa, a ficha da pessoa
  const conversationIds: string[] = req.conversation_id ? [req.conversation_id as string] : [];
  const contactIds: string[] = req.contact_id ? [req.contact_id as string] : [];
  if (!req.contact_id && req.conversation_id && req.bot_id) {
    const { data: conv } = await db.from("conversations").select("visitor_id, contact_id").eq("id", req.conversation_id).maybeSingle();
    if (conv?.contact_id) contactIds.push(conv.contact_id as string);
    if (conv?.visitor_id) {
      const { data: same } = await db.from("conversations").select("id").eq("bot_id", req.bot_id).eq("visitor_id", conv.visitor_id);
      for (const c of same ?? []) if (!conversationIds.includes(c.id as string)) conversationIds.push(c.id as string);
    }
  }
  const r = await eraseTargets(db, { contactIds, conversationIds }, { code: `dsr:${req.id}`, source: "chat" });
  const { erased, ...summary } = r;
  let told = false;
  if (bot) {
    for (const c of erased) {
      await emitContactDeleted(db, { contactId: c.id, externalId: c.externalId, bot: { id: bot.id as string, agency_id: bot.agency_id as string, client_id: (bot.client_id as string | null) ?? null, name: bot.name as string }, requestId: req.id as string }).catch((e) => console.error("webhook: contact.deleted", (e as Error).message));
      if (req.origin === "chat") told = (await tellContact(db, bot as BotRef, c)) || told;
    }
  }
  const now = new Date().toISOString();
  await db.from("data_subject_requests").update({ status: "executado", confirmed_at: now, confirmed_by: confirmedBy, executed_at: now, summary, ...(told ? { contact_notified_at: now } : {}) }).eq("id", req.id).eq("status", "aguardando");
  return summary;
}

/** Pedido feito no painel (por e-mail ou telefone): já confirmado, executado pela mesma rotina. */
export async function recordPanelRequest(db: SupabaseClient, r: { agencyId: string; clientId: string; by: string; summary: ErasureSummary }): Promise<string | null> {
  const now = new Date().toISOString();
  const { data, error } = await db.from("data_subject_requests").insert({ agency_id: r.agencyId, client_id: r.clientId, channel: "painel", origin: "painel", status: "executado", requested_at: now, due_at: now, confirmed_at: now, confirmed_by: r.by, executed_at: now, summary: r.summary }).select("id").single();
  if (error) console.error("pedido do titular (painel) não registrado", error.message);
  return (data?.id as string | undefined) ?? null;
}

/** contact.deleted das fichas apagadas pelo painel (cada uma no chatbot dela). */
export async function emitErasedContacts(db: SupabaseClient, erased: ErasureContact[], requestKey: string): Promise<void> {
  const bots = new Map<string, { id: string; agency_id: string; client_id: string | null; name: string } | null>();
  for (const c of erased) {
    if (!bots.has(c.botId)) {
      const { data } = await db.from("bots").select("id, agency_id, client_id, name").eq("id", c.botId).maybeSingle();
      bots.set(c.botId, data ? { id: data.id as string, agency_id: data.agency_id as string, client_id: (data.client_id as string | null) ?? null, name: data.name as string } : null);
    }
    const bot = bots.get(c.botId);
    if (bot) await emitContactDeleted(db, { contactId: c.id, externalId: c.externalId, bot, requestId: requestKey }).catch((e) => console.error("webhook: contact.deleted", (e as Error).message));
  }
}
