import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { agenciesWithWebhooks, contactObject, type BotRef } from "./message-events";
import type { WebhookEvent } from "./webhooks";

/*
 * Eventos dos webhooks que não levam conteúdo de conversa (C pública, parte 2b; spec Peça 2):
 * canal, pausa do chatbot, modelo, campanha e conformidade saem sempre que o webhook está ativo,
 * mesmo sob restrição e sem o aceite do negócio. O consentimento (contact.opted_in e opted_out)
 * fala de um contato: só sai com o aceite, como os eventos de conteúdo.
 * Fato da conta inteira (modelo do número, descadastro no número, conformidade do cliente) vira um
 * envelope por chatbot com a mesma chave: o id do evento é o mesmo, então cada webhook recebe o fato
 * uma vez só, mesmo cobrindo vários chatbots. Nada aqui derruba quem chamou.
 */

const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;

/** Os chatbots (só os de agências com webhook ativo; sem nenhum, nada é consultado). */
async function botsFor(db: SupabaseClient, botIds: string[]): Promise<BotRef[]> {
  const ids = [...new Set(botIds.filter(Boolean))];
  if (!ids.length) return [];
  const agencies = await agenciesWithWebhooks(db);
  if (!agencies.size) return [];
  const { data } = await db.from("bots").select("id, agency_id, client_id, name").in("id", ids);
  return ((data ?? []) as BotRef[]).filter((b) => agencies.has(b.agency_id));
}

/** Chatbots ligados a uma conta do WhatsApp (WABA). */
async function botsOfWaba(db: SupabaseClient, wabaId: string): Promise<string[]> {
  const { data } = await db.from("whatsapp_channels").select("bot_id").eq("waba_id", wabaId);
  return (data ?? []).map((c) => c.bot_id as string);
}

/** Evento sem conteúdo de conversa para estes chatbots (mesma chave em todos: um envio por webhook). */
export async function queueBotEvent(db: SupabaseClient, botIds: string[], e: { type: WebhookEvent; key: string; createdAt?: string; data: Record<string, unknown> }): Promise<void> {
  try {
    const bots = await botsFor(db, botIds);
    if (!bots.length) return;
    const { emitEvent } = await import("./webhooks");
    const createdAt = e.createdAt ?? new Date().toISOString();
    for (const bot of bots) await emitEvent(db, { type: e.type, key: e.key, bot, createdAt, conversation: null, contact: null, data: e.data }, { background: true });
  } catch (err) {
    console.error(`webhook: evento ${e.type} não registrado`, (err as Error).message);
  }
}

/* ------------------------------------------------------------------ canais */

export type ChannelRef = { type: "whatsapp"; phoneNumberId: string; display: string | null } | { type: "instagram"; igUserId: string; username: string | null };

/** O canal no evento: id estável (o número ou a conta na Meta), o tipo e o que o contato vê. Pura. */
export function channelObject(c: ChannelRef): { id: string; type: string; display: string | null } {
  return c.type === "whatsapp" ? { id: `chn_wa_${c.phoneNumberId}`, type: "whatsapp", display: c.display } : { id: `chn_ig_${c.igUserId}`, type: "instagram", display: c.username ? `@${c.username}` : null };
}

/** Desconexão por inatividade da coexistência (o app do celular ficou uns 14 dias sem abrir). */
export const PRIMARY_INACTIVITY_TEXT = "o app WhatsApp Business ficou sem ser aberto no celular; abra o app WhatsApp Business no celular e conecte de novo";

/**
 * channel.connected, channel.disconnected (com reason {code, message}) e channel.issue (com
 * issue {code, message}). Chave: o chatbot, o canal e a hora daquela mudança.
 */
export async function queueChannelEvent(db: SupabaseClient, botId: string, kind: "connected" | "disconnected" | "issue", ch: ChannelRef, o: { at: string; reason?: { code: string; message: string }; issue?: { code: string; message: string } }): Promise<void> {
  const channel = channelObject(ch);
  await queueBotEvent(db, [botId], {
    type: `channel.${kind}`,
    key: `${botId}:${channel.id}:${kind}:${o.at}`,
    createdAt: o.at,
    data: { channel, ...(o.reason ? { reason: o.reason } : {}), ...(o.issue ? { issue: o.issue } : {}) },
  });
}

/* ------------------------------------------------------------------ pausa do chatbot */

/** bot.paused e bot.resumed: só a pausa do dono (painel ou API); medidas saem em compliance.changed. */
export async function queueBotPauseEvent(db: SupabaseClient, botId: string, o: { paused: boolean; pausedAt: string; at: string; by: "panel" | "api"; reason?: string | null }): Promise<void> {
  await queueBotEvent(db, [botId], o.paused
    ? { type: "bot.paused", key: `${botId}:paused:${o.pausedAt}`, createdAt: o.at, data: { bot: { id: `bot_${botId}`, paused_at: o.pausedAt }, paused_by: o.by, reason: o.reason ?? null } }
    : { type: "bot.resumed", key: `${botId}:resumed:${o.pausedAt}`, createdAt: o.at, data: { bot: { id: `bot_${botId}`, paused_at: null }, resumed_by: o.by } });
}

/* ------------------------------------------------------------------ modelos do WhatsApp */

/** Aviso message_template_status_update da Meta no formato do evento, ou null. Pura. */
export function templateEventData(value: Record<string, unknown>): { template: { name: string; language: string | null; category: string | null; status: string; reason: string | null } } | null {
  const str = (k: string) => (typeof value[k] === "string" && value[k] ? (value[k] as string) : null);
  const name = str("message_template_name");
  const status = str("event");
  if (!name || !status) return null;
  const reason = str("reason");
  return {
    template: {
      name,
      language: str("message_template_language"),
      category: str("message_template_category")?.toLowerCase() ?? null,
      status: status.toLowerCase(),
      reason: reason && reason.toUpperCase() !== "NONE" ? reason : null,
    },
  };
}

/** template.status_changed para os chatbots da conta do WhatsApp; a chave é o próprio aviso. */
export async function queueTemplateEvent(db: SupabaseClient, wabaId: string, value: Record<string, unknown>): Promise<void> {
  const data = templateEventData(value);
  if (!data) return;
  try {
    const key = `${wabaId}:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
    await queueBotEvent(db, await botsOfWaba(db, wabaId), { type: "template.status_changed", key, data });
  } catch (err) {
    console.error("webhook: evento de modelo não registrado", (err as Error).message);
  }
}

/* ------------------------------------------------------------------ consentimento */

export type ConsentEventType = "marketing" | "utility" | "all";
export type ConsentEventSource = "chat" | "meta" | "api" | "panel";

/** De onde veio o aceite ou o descadastro, a partir da origem gravada ("chat:sair", "panel:ana@…"). Pura. */
export function consentSource(source: string): ConsentEventSource {
  const head = source.split(":")[0];
  return head === "meta" || head === "api" || head === "panel" ? head : "chat";
}

/**
 * contact.opted_in e contact.opted_out: consent {channel, type, source, at}. O escopo é o da
 * supressão (waba:<id> vale para todos os chatbots do número; bot:<id>, só para ele). Chave: o
 * registro (a supressão ou o aceite). Só sai com o aceite do negócio naquele canal.
 */
export async function queueConsentEvent(db: SupabaseClient, c: { channel: "whatsapp" | "instagram"; scope: string; contact: string; type: ConsentEventType; source: ConsentEventSource; granted: boolean; key: string; at?: string }): Promise<void> {
  try {
    const [kind, ref] = [c.scope.slice(0, c.scope.indexOf(":")), c.scope.slice(c.scope.indexOf(":") + 1)];
    const bots = await botsFor(db, kind === "waba" ? await botsOfWaba(db, ref) : [ref]);
    if (!bots.length) return;
    const { hasAcceptance } = await import("./acceptance");
    const { emitEvent } = await import("./webhooks");
    const { channelContactId } = await import("./contacts");
    const at = c.at ?? new Date().toISOString();
    for (const bot of bots) {
      if (!bot.client_id || !(await hasAcceptance(db, bot.client_id, c.channel))) continue;
      const contactId = await channelContactId(db, bot.id, c.channel, c.contact);
      // a conversa mais recente do contato com este chatbot, quando existe
      const { data: conv } = contactId ? await db.from("conversations").select("id").eq("contact_id", contactId).eq("bot_id", bot.id).eq("channel", c.channel).order("last_message_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
      await emitEvent(
        db,
        {
          type: c.granted ? "contact.opted_in" : "contact.opted_out",
          key: c.key,
          bot,
          createdAt: at,
          conversation: conv ? { id: conv.id as string, channel: c.channel } : null,
          contact: await contactObject(db, contactId),
          contactId,
          data: { consent: { channel: c.channel, type: c.type, source: c.source, at } },
        },
        { background: true },
      );
    }
  } catch (err) {
    console.error("webhook: evento de consentimento não registrado", (err as Error).message);
  }
}

/* ------------------------------------------------------------------ conformidade */

export type PublicComplianceStatus = "active" | "review" | "blocked";
export interface Restriction {
  type: "channel" | "regulated_flows" | "campaigns";
  channel: "whatsapp" | "instagram" | "widget" | null;
  source: "boavoz" | "meta";
}
export interface PublicCompliance {
  status: PublicComplianceStatus;
  restrictions: Restriction[];
}

/** Estado do negócio na revisão, no formato público (sem revisão registrada = ativo). Pura. */
export function publicStatus(s: string | null | undefined): PublicComplianceStatus {
  if (s === "bloqueado") return "blocked";
  if (s === "em_revisao" || s === "aguardando_revisao") return "review";
  return "active";
}

export interface MeasureRow {
  source: string;
  feature: string;
  channel: string;
}

/**
 * Medidas ativas viram restrições (iguais em compliance.changed e, depois, em GET /v1/clients):
 * canal suspenso (BoaVoz ou ordem da Meta), infração de regulamentados e restrição da Meta às
 * mensagens iniciadas pela empresa. O que é só registro ("outro") não entra. Pura, sem repetição.
 */
export function restrictionsOf(measures: MeasureRow[]): Restriction[] {
  const out = new Map<string, Restriction>();
  for (const m of measures) {
    const source = m.source === "boavoz" ? "boavoz" : "meta";
    const r: Restriction | null =
      m.feature === "channel"
        ? { type: "channel", channel: m.channel === "all" ? null : (m.channel as Restriction["channel"]), source }
        : m.feature === "regulados"
          ? { type: "regulated_flows", channel: "whatsapp", source }
          : m.feature === "restricao"
            ? { type: "campaigns", channel: "whatsapp", source }
            : null;
    if (r) out.set(`${r.type}:${r.channel}:${r.source}`, r);
  }
  return [...out.values()].sort((a, b) => `${a.type}:${a.channel}`.localeCompare(`${b.type}:${b.channel}`));
}

/** Mudou o estado ou as restrições? Pura. */
export const complianceChanged = (a: PublicCompliance, b: PublicCompliance) => a.status !== b.status || JSON.stringify(a.restrictions) !== JSON.stringify(b.restrictions);

const CHANNEL_NAME: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "chat do site" };

function restrictionText(r: Restriction): string {
  if (r.type === "channel") {
    const what = r.channel ? `O ${CHANNEL_NAME[r.channel]}` : "Todos os canais";
    return r.source === "boavoz" ? `${what} ${r.channel ? "está suspenso" : "estão suspensos"} pelo BoaVoz.` : "A Meta desativou a conta do WhatsApp: nada entra nem sai por ela.";
  }
  if (r.type === "regulated_flows") return "A Meta registrou uma infração de produtos regulamentados (bebida, remédio) no WhatsApp.";
  return "A Meta restringiu as mensagens iniciadas pela empresa no WhatsApp (campanhas e modelos).";
}

/** Motivo resumido e próximo passo, sem conteúdo de conversa e sem o texto interno da revisão. Pura. */
export function complianceSummary(c: PublicCompliance): { reason_summary: string; next_step: string | null } {
  const parts = c.restrictions.map(restrictionText);
  if (c.status === "blocked") return { reason_summary: "O negócio foi bloqueado na revisão do BoaVoz: WhatsApp e Instagram ficam suspensos.", next_step: "Veja o motivo no painel (cliente, aba Conformidade) e fale com o suporte do BoaVoz para contestar." };
  if (c.status === "review") return { reason_summary: ["O negócio está em revisão pelo BoaVoz; a revisão não bloqueia nada.", ...parts].join(" "), next_step: "Aguarde a decisão: o dono da agência recebe por e-mail." };
  if (!parts.length) return { reason_summary: "Sem restrições em vigor.", next_step: null };
  const meta = c.restrictions.some((r) => r.source === "meta");
  const boavoz = c.restrictions.some((r) => r.source === "boavoz");
  return { reason_summary: parts.join(" "), next_step: [meta ? "Confira o aviso no Gerenciador do WhatsApp da Meta." : null, boavoz ? "Fale com o suporte do BoaVoz." : null].filter(Boolean).join(" ") };
}

/** Estado de conformidade de cada cliente: a revisão do negócio e as medidas que tocam os chatbots dele. */
export async function complianceOf(db: SupabaseClient, clientIds: string[]): Promise<Map<string, PublicCompliance>> {
  const ids = [...new Set(clientIds.filter(Boolean))];
  const out = new Map<string, PublicCompliance>();
  if (!ids.length) return out;
  const [{ data: reviews }, { data: bots }] = await Promise.all([
    db.from("business_compliance").select("client_id, status").in("client_id", ids),
    db.from("bots").select("id, agency_id, client_id, whatsapp_channels(waba_id)").in("client_id", ids).eq("is_demo", false),
  ]);
  const botRows = (bots ?? []).map((b) => ({ id: b.id as string, agency: b.agency_id as string, client: b.client_id as string, waba: (one(b.whatsapp_channels as { waba_id: string | null } | { waba_id: string | null }[] | null)?.waba_id ?? null) as string | null }));
  const agencies = [...new Set(botRows.map((b) => b.agency))];
  const filter = [...(agencies.length ? [`agency_id.in.(${agencies.join(",")})`] : []), ...(botRows.length ? [`bot_id.in.(${botRows.map((b) => b.id).join(",")})`] : []), ...botRows.filter((b) => b.waba).map((b) => `waba_id.eq.${b.waba}`)];
  const { data: measures } = filter.length ? await db.from("enforcement_actions").select("source, feature, channel, agency_id, bot_id, waba_id").is("lifted_at", null).or(filter.join(",")) : { data: [] };
  for (const clientId of ids) {
    const mine = botRows.filter((b) => b.client === clientId);
    // a medida da BoaVoz vale para o chatbot ou para a agência inteira; a da Meta, para a conta do WhatsApp
    const applies = (m: Record<string, unknown>) =>
      m.source === "boavoz" ? mine.some((b) => (m.bot_id ? m.bot_id === b.id : m.agency_id === b.agency)) : mine.some((b) => b.waba && m.waba_id === b.waba);
    const review = (reviews ?? []).find((r) => r.client_id === clientId);
    out.set(clientId, { status: publicStatus(review?.status as string | undefined), restrictions: restrictionsOf(((measures ?? []) as Array<MeasureRow & Record<string, unknown>>).filter(applies)) });
  }
  return out;
}

/** Clientes que uma medida pode tocar: o do chatbot, os da agência ou os dos chatbots do número. */
export async function clientsOfScope(db: SupabaseClient, s: { botId?: string | null; agencyId?: string | null; wabaId?: string | null }): Promise<string[]> {
  let botIds: string[] = [];
  if (s.botId) botIds = [s.botId];
  else if (s.wabaId) botIds = await botsOfWaba(db, s.wabaId);
  else if (s.agencyId) {
    const { data } = await db.from("clients").select("id").eq("agency_id", s.agencyId);
    return (data ?? []).map((c) => c.id as string);
  }
  if (!botIds.length) return [];
  const { data } = await db.from("bots").select("client_id").in("id", botIds);
  return [...new Set((data ?? []).map((b) => b.client_id as string | null).filter((c): c is string => Boolean(c)))];
}

/**
 * Roda a mudança e, para cada cliente cujo estado ou restrições mudaram, emite compliance.changed
 * {status, previous_status, restrictions[], reason_summary, next_step} pelos chatbots dele. key:
 * o registro daquela mudança (a medida, a revisão), ou tirado do resultado (o id da medida criada).
 * Falha ao ler o estado não atrapalha a mudança.
 */
export async function trackCompliance<T>(db: SupabaseClient, clientIds: string[] | (() => Promise<string[]>), key: string | ((result: T) => string), change: () => Promise<T>): Promise<T> {
  let ids: string[] = [];
  let before: Map<string, PublicCompliance> | null = null;
  try {
    ids = typeof clientIds === "function" ? await clientIds() : clientIds;
    if (ids.length && (await agenciesWithWebhooks(db)).size) before = await complianceOf(db, ids);
  } catch (err) {
    console.error("webhook: conformidade antes da mudança", (err as Error).message);
  }
  const result = await change();
  if (!before) return result;
  try {
    const after = await complianceOf(db, ids);
    const changeKey = typeof key === "function" ? key(result) : key;
    for (const [clientId, now] of after) {
      const prev = before.get(clientId);
      if (!prev || !complianceChanged(prev, now)) continue;
      const { data: bots } = await db.from("bots").select("id").eq("client_id", clientId).eq("is_demo", false);
      await queueBotEvent(db, (bots ?? []).map((b) => b.id as string), {
        type: "compliance.changed",
        key: `${clientId}:${changeKey}`,
        data: { compliance: { status: now.status, previous_status: prev.status, restrictions: now.restrictions, ...complianceSummary(now) } },
      });
    }
  } catch (err) {
    console.error("webhook: evento de conformidade não registrado", (err as Error).message);
  }
  return result;
}
