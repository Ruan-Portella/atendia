import type { SupabaseClient } from "@supabase/supabase-js";
import { openNullable, scopeOfBot, sealNullable } from "./field-cipher";
import { activeSuppressions, blocks, suppress, suppressionScope, type SuppressionKind } from "./suppression";
import { consentHistory, consentStateOf, revokeConsents, type ConsentState } from "./marketing-consent";
import { getAge, type AgeStatus } from "./gate/age";
import { WhatsAppError, phoneStanding, waIdVariants } from "./whatsapp";
import { listTemplates, loadTemplateChannel, sendTemplate, type TemplateChannel } from "./whatsapp-templates";
import { renderTemplate, templateBody, unsupportedReason, type Template } from "./template-text";
import { channelMsgHash } from "./hash";
import { saveMessage } from "./messages";
import { metaPhoneHash, phoneHash, whatsappContact } from "./contacts";
import { TOKEN_REJECTED, isAccessError, isPaymentError, markDisconnected, markPaymentIssue } from "./whatsapp-access";
import { sendBlockedReason } from "./conversation-mode";
import { aiBlockedReason, type AiBlockReason } from "./chat";
import { notifyAgencyOwner } from "./notify";
import { appUrl, currentPeriodBR } from "./utils";
import { referencePrices } from "./whatsapp-usage";

/*
 * Motor das campanhas e lembretes (leva B3, parte 3a; spec Peça 7). Só WhatsApp no MVP.
 *   - A agenda é a tabela campaign_sends (migração 0081): um tique por minuto (pg_cron chamando
 *     /api/cron/campaigns, migração 0082) reserva lotes com FOR UPDATE SKIP LOCKED (campaign_claim).
 *   - Limite: contatos únicos por 24 h do portfólio (o nível da Meta no número), contando as
 *     campanhas e os lembretes de todos os chatbots da mesma conta do WhatsApp, e um teto por tique.
 *   - Antes de cada envio: descadastro (pela categoria do modelo), aceite de novidades (marketing),
 *     18+ confirmado (campanha de bebida ou remédio) e contato apagado (pedido do titular).
 *   - Envio com biz_opaque_callback_data = "cs:<id>": o status da Meta concilia (conciliar abaixo).
 *     Sem resposta da Meta a linha fica "sending" e vira "uncertain" em 5 minutos, nunca reenviada.
 *   - Erro 131050 (a pessoa parou o marketing): opted_out, supressão e o aceite revogado.
 *   - Pausa sozinha e avisa o dono (parte 3b): nota de qualidade do número caiu durante o envio
 *     (conferida a cada tique e pelo aviso da Meta), modelo pausado ou reclassificado (a cada
 *     tique, pelos avisos message_template_status_update e template_category_update e pelo
 *     pricing.category dos status: lembrete cobrado como marketing).
 * Camada única: só este arquivo lê e grava campaign_sends (telefone e variáveis cifrados).
 */

export type CampaignKind = "marketing" | "utility_reminder";
export type CampaignStatus = "draft" | "scheduled" | "sending" | "paused" | "finished" | "canceled";
export type SendStatus = "queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "uncertain" | "skipped_no_consent" | "skipped_suppressed" | "skipped_no_age" | "skipped_contact_deleted" | "opted_out";

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = { draft: "rascunho", scheduled: "agendada", sending: "enviando", paused: "pausada", finished: "terminada", canceled: "cancelada" };
export const SEND_STATUS_LABEL: Record<SendStatus, string> = {
  queued: "na fila",
  sending: "enviando",
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  failed: "com erro",
  uncertain: "incerta (sem resposta da Meta)",
  skipped_no_consent: "sem aceite de novidades",
  skipped_suppressed: "pediu para sair",
  skipped_no_age: "sem 18+ confirmado",
  skipped_contact_deleted: "contato apagado",
  opted_out: "parou o marketing na Meta",
};

/** Linha enviada sem resposta da Meta vira "uncertain" depois disto (nunca é reenviada sozinha). */
export const UNCERTAIN_AFTER_MS = 5 * 60_000;
/** Teto de envios por número em cada tique (a função da Vercel tem 60 s). */
export const PER_TICK = 150;
/** Lote reservado de cada vez. */
const BATCH = 25;
/** Erro da Meta: a pessoa parou as mensagens de marketing (vira descadastro, sem reenvio). */
export const MARKETING_STOPPED = 131050;
/** Erros de ritmo da Meta: a linha volta para a fila e sai um minuto depois. */
const RATE_LIMITED = new Set([130429, 131056, 131048]);

/** Nota de qualidade do número na Meta. */
export const QUALITY_LABEL: Record<string, string> = { GREEN: "alta (verde)", YELLOW: "média (amarela)", RED: "baixa (vermelha)" };
const QUALITY_RANK: Record<string, number> = { GREEN: 3, YELLOW: 2, RED: 1 };

/** A nota caiu desde o começo (ou a retomada) da campanha? Sem nota de um dos lados, não. Pura. */
export function qualityDropped(start: string | null | undefined, now: string | null | undefined): boolean {
  const a = QUALITY_RANK[(start ?? "").toUpperCase()];
  const b = QUALITY_RANK[(now ?? "").toUpperCase()];
  return Boolean(a && b && b < a);
}

/**
 * Estimativa da campanha: custo na Meta (preço de referência por mensagem, em R$, o mesmo de
 * Cobrança > Uso) e em quantos dias sai, pelo saldo de hoje no limite de 24 h do portfólio e o
 * limite cheio nos dias seguintes. Pura.
 */
export function estimateCampaign(o: { contacts: number; price: number; limit: number; recent: number }): { contacts: number; costBrl: number; days: number } {
  const contacts = Math.max(0, Math.floor(o.contacts));
  const costBrl = Math.round(contacts * o.price * 100) / 100;
  if (!contacts) return { contacts, costBrl, days: 0 };
  const today = Math.max(0, o.limit - o.recent);
  const days = contacts <= today ? 1 : 1 + Math.ceil((contacts - today) / o.limit);
  return { contacts, costBrl, days };
}

/**
 * Conta ou chatbot em que as campanhas param (regra de estado, degraus 4 e 5): chatbot pausado pelo
 * dono ou pelo limite do plano, teste grátis vencido, assinatura cancelada. Cota de atendimentos
 * esgotada não para (campanha não consome cota). Pura.
 */
export function accountStopReason(o: { botPaused: boolean; planPaused: boolean; block: AiBlockReason | null }): string | null {
  if (o.botPaused) return "o chatbot está pausado (botão de emergência)";
  if (o.planPaused) return "o chatbot está pausado pelo limite do plano";
  if (o.block === "trial_expired") return "o teste grátis da agência venceu";
  if (o.block === "cancelled") return "a assinatura da agência foi cancelada";
  return null;
}

/** Contatos únicos por 24 h do nível da Meta. Sem a informação, o menor nível (250). Pura. */
export function tierLimit(tier: string | null | undefined): number {
  const table: Record<string, number> = { TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10_000, TIER_100K: 100_000, TIER_UNLIMITED: Number.POSITIVE_INFINITY };
  return (tier && table[tier.toUpperCase()]) || 250;
}

/** Quantos envios cabem agora: saldo do portfólio nas 24 h e o teto do tique. Pura. */
export const allowance = (o: { limit: number; recent: number; perTick?: number }) => Math.max(0, Math.min(o.perTick ?? PER_TICK, o.limit - o.recent));

export type SendDecision = "send" | "skipped_suppressed" | "skipped_no_consent" | "skipped_no_age" | "skipped_contact_deleted";

/** O que fazer com uma linha antes de enviar. Pura. */
export function decideSend(o: { templateCategory: string; suppressed: SuppressionKind[]; consent: ConsentState; regulated: boolean; age: AgeStatus; contactGone: boolean }): SendDecision {
  if (o.contactGone) return "skipped_contact_deleted";
  if (blocks(o.suppressed, o.templateCategory)) return "skipped_suppressed";
  if (o.templateCategory.toUpperCase() === "MARKETING" && o.consent !== "granted") return "skipped_no_consent";
  // quem disse "não" ao 18+ não entra em campanha de marketing; bebida ou remédio, só com 18+ confirmado
  if ((o.templateCategory.toUpperCase() === "MARKETING" && o.age === "nao") || (o.regulated && o.age !== "sim")) return "skipped_no_age";
  return "send";
}

/** Erro da Meta num envio: descadastro, tentar de novo daqui a pouco ou falha. Pura. */
export function sendErrorOutcome(code: number | undefined): "opted_out" | "retry" | "failed" {
  if (code === MARKETING_STOPPED) return "opted_out";
  if (code !== undefined && RATE_LIMITED.has(code)) return "retry";
  return "failed";
}

/** Status de entrega da Meta para a linha: só avança (lido não volta a entregue). Pura. */
export function nextSendStatus(current: SendStatus, metaStatus: string, errorCode?: number): SendStatus | null {
  const order: SendStatus[] = ["sending", "uncertain", "sent", "delivered", "read"];
  if (metaStatus === "failed") return current === "sending" || current === "uncertain" || current === "sent" ? (errorCode === MARKETING_STOPPED ? "opted_out" : "failed") : null;
  const target = ({ sent: "sent", delivered: "delivered", read: "read" } as Record<string, SendStatus>)[metaStatus];
  if (!target || !order.includes(current)) return null;
  return order.indexOf(target) > order.indexOf(current) ? target : null;
}

/** A campanha pausa sozinha: o modelo mudou de categoria (utilidade virou marketing) ou deixou de estar aprovado. Pura. */
export function templateProblem(kind: CampaignKind, template: Pick<Template, "status" | "category" | "components"> | null): string | null {
  if (!template) return "o modelo não existe mais na conta do WhatsApp";
  if (template.status.toUpperCase() !== "APPROVED") return `o modelo não está aprovado pela Meta (situação: ${template.status})`;
  if (kind === "utility_reminder" && template.category.toUpperCase() === "MARKETING") return "a Meta mudou o modelo de utilidade para marketing";
  const unsupported = unsupportedReason(template);
  return unsupported ? `o modelo ${unsupported}` : null;
}

/** Contatos únicos que receberam campanha ou lembrete nas últimas 24 h, em todos os chatbots da mesma conta do WhatsApp. */
async function portfolioRecipients(db: SupabaseClient, wabaId: string, botId: string, now: Date): Promise<number> {
  const { data: siblings } = await db.from("whatsapp_channels").select("bot_id").eq("waba_id", wabaId).is("disconnected_at", null);
  const botIds = [...new Set([botId, ...(siblings ?? []).map((s) => s.bot_id as string)])];
  const { data } = await db.rpc("campaign_recent_recipients", { p_bot_ids: botIds, p_since: new Date(now.getTime() - 86_400_000).toISOString() });
  return Number(data) || 0;
}

/** Estimativa para um chatbot: o nível do número na Meta e o que o portfólio já enviou nas 24 h. */
export async function estimateFor(db: SupabaseClient, ch: TemplateChannel, botId: string, contacts: number, category: string): Promise<ReturnType<typeof estimateCampaign> & { limit: number; recent: number }> {
  const [standing, recent] = await Promise.all([phoneStanding(ch).catch(() => ({ tier: null, quality: null })), portfolioRecipients(db, ch.waba_id, botId, new Date())]);
  const limit = tierLimit(standing.tier);
  const prices = referencePrices();
  return { ...estimateCampaign({ contacts, price: prices[category.toLowerCase()] ?? prices.marketing, limit, recent }), limit, recent };
}

/** "≈ R$ 17,50": o custo estimado na Meta. Pura. */
export const costText = (costBrl: number) => `≈ ${costBrl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`;

/* ------------------------------------------------------------------ montar */

export interface NewRecipient {
  contactId: string | null;
  /** Canônico (só dígitos, com o DDI). */
  phone: string;
  /** Marketing: "c:<contato>"; lembrete: "l:<linha da planilha>". */
  dedupeKey: string;
  variables: string[];
  sendAt?: string | null;
}

/** Grava a campanha e os envios. Sem data, começa a enviar no próximo tique. */
export async function createCampaign(db: SupabaseClient, c: { agencyId: string; clientId: string | null; botId: string; kind: CampaignKind; name: string; template: { name: string; language: string; category: string }; regulated: boolean; audience: Record<string, unknown>; scheduledAt: string | null; createdBy: string | null; recipients: NewRecipient[]; estimatedCostBrl?: number | null }): Promise<{ id: string; queued: number }> {
  const scheduled = c.scheduledAt && Date.parse(c.scheduledAt) > Date.now() ? c.scheduledAt : null;
  const { data, error } = await db
    .from("campaigns")
    .insert({ agency_id: c.agencyId, client_id: c.clientId, bot_id: c.botId, kind: c.kind, name: c.name.slice(0, 120), template_name: c.template.name, template_language: c.template.language, template_category: c.template.category.toUpperCase(), regulated: c.regulated, audience: c.audience, scheduled_at: scheduled, status: scheduled ? "scheduled" : "sending", estimated_contacts: c.recipients.length, estimated_cost_cents: c.estimatedCostBrl == null ? null : Math.round(c.estimatedCostBrl * 100), created_by: c.createdBy })
    .select("id")
    .single();
  if (error || !data) throw new Error(`campanha: ${error?.message ?? "não gravada"}`);
  const scope = await scopeOfBot(c.botId);
  let queued = 0;
  for (let i = 0; i < c.recipients.length; i += 300) {
    const rows = await Promise.all(
      c.recipients.slice(i, i + 300).map(async (r) => ({
        campaign_id: data.id,
        contact_id: r.contactId,
        dedupe_key: r.dedupeKey,
        phone_enc: await sealNullable("campaign_sends.phone_enc", r.phone, scope),
        phone_hash: phoneHash(r.phone),
        send_at: r.sendAt ?? scheduled ?? new Date().toISOString(),
        variables_enc: r.variables.length ? await sealNullable("campaign_sends.variables_enc", JSON.stringify(r.variables), scope) : null,
      })),
    );
    const { data: inserted, error: insertError } = await db.from("campaign_sends").upsert(rows, { onConflict: "campaign_id,dedupe_key", ignoreDuplicates: true }).select("id");
    if (insertError) throw new Error(`campanha: ${insertError.message}`);
    queued += inserted?.length ?? 0;
  }
  return { id: data.id as string, queued };
}

/** Pausar ou retomar (retomar volta a enviar no próximo tique). */
export async function setCampaignStatus(db: SupabaseClient, id: string, status: "paused" | "sending" | "canceled", reason: string | null = null): Promise<boolean> {
  const from = status === "sending" ? ["paused"] : ["scheduled", "sending", "paused"];
  const now = new Date().toISOString();
  // cancelada termina ali (o prazo de guarda conta do fim); o que estava na fila não sai mais.
  // Retomada: a nota de qualidade de agora vira a referência (quem retomou já viu a nota)
  const { data } = await db
    .from("campaigns")
    .update({ status, pause_reason: status === "paused" ? reason : null, updated_at: now, ...(status === "canceled" ? { finished_at: now } : {}), ...(status === "sending" ? { quality_at_start: null } : {}) })
    .eq("id", id)
    .in("status", from)
    .select("id");
  return Boolean(data?.length);
}

/** Modelo reclassificado: o que o dono pode fazer (pedir revisão da categoria à Meta). */
export const CATEGORY_REVIEW_HINT = "Se o modelo é mesmo de utilidade, peça revisão da categoria no Gerenciador do WhatsApp (Modelos de mensagem, abra o modelo e peça a revisão). Ou troque o texto por um sem promoção.";

/** Pausa e avisa o dono (só quando a campanha estava enviando ou agendada). */
async function pause(db: SupabaseClient, c: Pick<CampaignRow, "id" | "agency_id" | "bot_id" | "name">, reason: string, extra: string[] = []): Promise<boolean> {
  const { data } = await db.from("campaigns").update({ status: "paused", pause_reason: reason, updated_at: new Date().toISOString() }).eq("id", c.id).in("status", ["scheduled", "sending"]).select("id");
  if (!data?.length) return false;
  await notifyAgencyOwner(db, c.agency_id, `Campanha pausada: ${c.name}`, [
    `A campanha "${c.name}" foi pausada: ${reason}.`,
    ...extra,
    "Os envios que já saíram continuam valendo; os que faltam esperam você retomar.",
    `Veja em ${appUrl(`/painel/bots/${c.bot_id}`)}`,
  ]).catch(() => false);
  return true;
}

/**
 * Aviso da Meta sobre a conta (qualidade do número, modelo pausado ou reclassificado): pausa as
 * campanhas enviando ou agendadas dos chatbots daquela conta. phone: só o desse número;
 * templateName: só as desse modelo; kinds: só desses tipos. Devolve quantas pausou.
 */
export async function pauseCampaignsFor(db: SupabaseClient, where: { wabaId: string; phone?: string | null; templateName?: string; templateLanguage?: string | null; kinds?: CampaignKind[] }, reason: string, extra: string[] = []): Promise<number> {
  const { data: chs } = await db.from("whatsapp_channels").select("bot_id, display_phone").eq("waba_id", where.wabaId).is("disconnected_at", null);
  const digits = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "");
  const botIds = (chs ?? []).filter((c) => !where.phone || digits(c.display_phone as string) === digits(where.phone)).map((c) => c.bot_id as string);
  if (!botIds.length) return 0;
  let q = db.from("campaigns").select("id, agency_id, bot_id, name").in("bot_id", botIds).in("status", ["scheduled", "sending"]);
  if (where.templateName) q = q.eq("template_name", where.templateName);
  if (where.templateLanguage) q = q.eq("template_language", where.templateLanguage);
  if (where.kinds?.length) q = q.in("kind", where.kinds);
  const { data: campaigns } = await q;
  let paused = 0;
  for (const c of (campaigns ?? []) as Array<Pick<CampaignRow, "id" | "agency_id" | "bot_id" | "name">>) if (await pause(db, c, reason, extra)) paused++;
  return paused;
}

/* ------------------------------------------------------------------ avisos da Meta */

/** Campos do webhook da conta que mexem com as campanhas (assinados no app da Meta). */
export const CAMPAIGN_NOTICE_FIELDS = ["phone_number_quality_update", "message_template_status_update", "template_category_update"] as const;
export type CampaignNoticeField = (typeof CAMPAIGN_NOTICE_FIELDS)[number];
export const isCampaignNoticeField = (f: string | undefined): f is CampaignNoticeField => (CAMPAIGN_NOTICE_FIELDS as readonly string[]).includes(f ?? "");

const QUALITY_HINT = "Nota em queda costuma vir de bloqueios e denúncias: revise o público (só quem pediu novidades) e o texto antes de retomar.";
/** Situações do modelo em que a campanha para (pausado, desativado, recusado, saindo ou com nota baixa). */
const TEMPLATE_STOP: Record<string, string> = { PAUSED: "pausou", DISABLED: "desativou", REJECTED: "recusou", PENDING_DELETION: "está apagando", FLAGGED: "marcou com nota baixa" };

export interface NoticeEffect {
  where: { phone?: string | null; templateName?: string; templateLanguage?: string | null; kinds?: CampaignKind[] };
  reason: string;
  extra: string[];
}

/** O que um aviso da Meta faz com as campanhas da conta, ou null (nada a pausar). Pura. */
export function campaignNoticeEffect(field: string, value: Record<string, unknown>): NoticeEffect | null {
  const str = (k: string) => (typeof value[k] === "string" && value[k] ? (value[k] as string) : null);
  if (field === "phone_number_quality_update") {
    if ((str("event") ?? "").toUpperCase() !== "FLAGGED") return null;
    return { where: { phone: str("display_phone_number") }, reason: "a Meta avisou que a nota de qualidade do número caiu", extra: [QUALITY_HINT] };
  }
  const name = str("message_template_name");
  if (!name) return null;
  const template = { templateName: name, templateLanguage: str("message_template_language") };
  if (field === "message_template_status_update") {
    const verb = TEMPLATE_STOP[(str("event") ?? "").toUpperCase()];
    if (!verb) return null;
    const why = str("reason");
    return { where: template, reason: `a Meta ${verb} o modelo ${name}${why && why.toUpperCase() !== "NONE" ? ` (motivo: ${why})` : ""}`, extra: [] };
  }
  if (field === "template_category_update") {
    // o aviso antecipado traz correct_category; a mudança feita traz new_category
    if ((str("new_category") ?? str("correct_category") ?? "").toUpperCase() !== "MARKETING") return null;
    return { where: { ...template, kinds: ["utility_reminder"] }, reason: `a Meta mudou o modelo ${name} de utilidade para marketing`, extra: [CATEGORY_REVIEW_HINT] };
  }
  return null;
}

/** Aviso da Meta sobre a conta (entry.id = WABA): pausa e avisa o dono quando preciso. */
export async function handleCampaignNotice(db: SupabaseClient, wabaId: string, field: string, value: Record<string, unknown>): Promise<number> {
  const effect = campaignNoticeEffect(field, value);
  return effect ? pauseCampaignsFor(db, { wabaId, ...effect.where }, effect.reason, effect.extra) : 0;
}

/* ------------------------------------------------------------------ enviar (o tique) */

interface CampaignRow {
  id: string;
  agency_id: string;
  client_id: string | null;
  bot_id: string;
  kind: CampaignKind;
  name: string;
  template_name: string;
  template_language: string;
  template_category: string;
  regulated: boolean;
  quality_at_start: string | null;
}

interface SendRow {
  id: number;
  contact_id: string | null;
  dedupe_key: string;
  phone_enc: string | null;
  variables_enc: string | null;
}

export interface TickResult {
  campaigns: number;
  sent: number;
  skipped: number;
  failed: number;
  uncertain: number;
  finished: number;
  paused: number;
}

/**
 * Um tique: marca as incertas, liga as agendadas que venceram e envia o que cabe de cada campanha
 * (para antes do tempo da função; o resto fica para o próximo tique).
 */
export async function runCampaignTick(db: SupabaseClient, o: { hasTime: () => boolean; now?: Date } = { hasTime: () => true }): Promise<TickResult> {
  const now = o.now ?? new Date();
  const result: TickResult = { campaigns: 0, sent: 0, skipped: 0, failed: 0, uncertain: 0, finished: 0, paused: 0 };
  const { data: unsure } = await db
    .from("campaign_sends")
    .update({ status: "uncertain", updated_at: now.toISOString() })
    .eq("status", "sending")
    .lt("claimed_at", new Date(now.getTime() - UNCERTAIN_AFTER_MS).toISOString())
    .select("id");
  result.uncertain = unsure?.length ?? 0;
  await db.from("campaigns").update({ status: "sending", updated_at: now.toISOString() }).eq("status", "scheduled").lte("scheduled_at", now.toISOString());

  const { data: active } = await db.from("campaigns").select("id, agency_id, client_id, bot_id, kind, name, template_name, template_language, template_category, regulated, quality_at_start").eq("status", "sending").order("created_at").limit(20);
  const standings = new Map<string, { tier: string | null; quality: string | null }>();
  for (const c of (active ?? []) as CampaignRow[]) {
    if (!o.hasTime()) break;
    result.campaigns++;
    const r = await sendCampaign(db, c, { hasTime: o.hasTime, now, standings });
    result.sent += r.sent;
    result.skipped += r.skipped;
    result.failed += r.failed;
    if (r.paused) result.paused++;
    if (r.finished) result.finished++;
  }
  return result;
}

async function sendCampaign(db: SupabaseClient, c: CampaignRow, o: { hasTime: () => boolean; now: Date; standings: Map<string, { tier: string | null; quality: string | null }> }): Promise<{ sent: number; skipped: number; failed: number; paused: boolean; finished: boolean }> {
  const out = { sent: 0, skipped: 0, failed: 0, paused: false, finished: false };
  const ch = await loadTemplateChannel(db, c.bot_id);
  if (!ch) {
    await pause(db, c, "o WhatsApp do chatbot foi desconectado");
    return { ...out, paused: true };
  }
  const bot = await botInfo(db, c.bot_id);
  // chatbot pausado, conta sem plano válido ou canal bloqueado: nada sai por ele (nem campanha)
  const stop = accountStopReason({ botPaused: Boolean(bot.paused_at), planPaused: Boolean(bot.paused_by_plan_at), block: await aiBlockedReason(db, c.agency_id) });
  const blocked = stop ?? (await sendBlockedReason(db, c.bot_id, "whatsapp"));
  if (blocked) {
    await pause(db, c, blocked.replace(/[.\s]+$/, ""));
    return { ...out, paused: true };
  }
  // a categoria do modelo é conferida de novo a cada tique (a Meta reclassifica)
  let template: Template | null = null;
  try {
    template = (await listTemplates(ch)).find((t) => t.name === c.template_name && t.language === c.template_language) ?? null;
  } catch (e) {
    if (isAccessError(e)) await markDisconnected(db, { column: "bot_id", value: c.bot_id }, TOKEN_REJECTED);
    console.error("campanha: modelos não lidos", c.id, (e as Error).message);
    return out;
  }
  const problem = templateProblem(c.kind, template);
  if (problem) {
    await pause(db, c, problem, /marketing/.test(problem) ? [CATEGORY_REVIEW_HINT] : []);
    return { ...out, paused: true };
  }
  // nível e nota do número, uma vez por tique; a nota caiu desde o começo (ou a retomada): pausa
  if (!o.standings.has(ch.phone_number_id)) o.standings.set(ch.phone_number_id, await phoneStanding(ch).catch(() => ({ tier: null, quality: null })));
  const standing = o.standings.get(ch.phone_number_id)!;
  if (qualityDropped(c.quality_at_start, standing.quality)) {
    const from = QUALITY_LABEL[c.quality_at_start!.toUpperCase()];
    const to = QUALITY_LABEL[standing.quality!.toUpperCase()];
    await pause(db, c, `a nota de qualidade do número caiu de ${from} para ${to}`, [QUALITY_HINT]);
    return { ...out, paused: true };
  }
  if (!c.quality_at_start && standing.quality) await db.from("campaigns").update({ quality_at_start: standing.quality.toUpperCase() }).eq("id", c.id);
  const body = templateBody(template!);
  const category = template!.category.toUpperCase();

  let left = allowance({ limit: tierLimit(standing.tier), recent: await portfolioRecipients(db, ch.waba_id, c.bot_id, o.now) });
  const scope = suppressionScope({ wabaId: ch.waba_id, botId: c.bot_id });

  while (left > 0 && o.hasTime()) {
    const { data: rows, error } = await db.rpc("campaign_claim", { p_campaign: c.id, p_limit: Math.min(BATCH, left) });
    if (error) throw new Error(`campanha: ${error.message}`);
    const batch = (rows ?? []) as SendRow[];
    if (!batch.length) break;
    for (let i = 0; i < batch.length; i += 5) {
      const results = await Promise.all(batch.slice(i, i + 5).map((row) => sendRow(db, c, row, { ch, scope, body, category, bot })));
      for (const r of results) {
        if (r === "sent") out.sent++;
        else if (r === "stop") out.paused = true;
        else if (r === "failed" || r === "opted_out") out.failed++;
        else if (r !== "retry" && r !== "unknown") out.skipped++;
      }
      if (out.paused) {
        // reservados e ainda não tentados voltam para a fila (não viram "incerta" sem ter saído)
        const untouched = batch.slice(i + 5).map((r) => r.id);
        if (untouched.length) await db.from("campaign_sends").update({ status: "queued", claimed_at: null, updated_at: new Date().toISOString() }).in("id", untouched).eq("status", "sending");
        break;
      }
    }
    if (out.paused) break;
    left -= batch.length;
  }
  // contatos que receberam no mês (uso da agência; não é limite de plano)
  if (out.sent) await db.rpc("usage_add_campaign_contacts", { p_agency: c.agency_id, p_period: currentPeriodBR(o.now), p_n: out.sent });
  if (!out.paused) out.finished = await finishIfDone(db, c.id);
  else await updateTotals(db, c.id);
  return out;
}

async function botInfo(db: SupabaseClient, botId: string): Promise<{ id: string; agency_id: string; paused_at: string | null; paused_by_plan_at: string | null }> {
  const { data } = await db.from("bots").select("id, agency_id, paused_at, paused_by_plan_at").eq("id", botId).single();
  return data as { id: string; agency_id: string; paused_at: string | null; paused_by_plan_at: string | null };
}

type RowOutcome = SendStatus | SendDecision | "retry" | "stop" | "unknown";

async function sendRow(db: SupabaseClient, c: CampaignRow, row: SendRow, o: { ch: TemplateChannel; scope: string; body: string; category: string; bot: { id: string; agency_id: string } }): Promise<RowOutcome> {
  const set = async (status: SendStatus, extra: Record<string, unknown> = {}) => {
    await db.from("campaign_sends").update({ status, updated_at: new Date().toISOString(), ...extra }).eq("id", row.id);
  };
  const phone = await openNullable("campaign_sends.phone_enc", row.phone_enc);
  if (!phone) {
    await set("skipped_contact_deleted");
    return "skipped_contact_deleted";
  }
  const variables = JSON.parse((await openNullable("campaign_sends.variables_enc", row.variables_enc)) ?? "[]") as string[];
  const target = { scope: o.scope, contact: phone };
  const [suppressed, history, age] = await Promise.all([
    activeSuppressions(db, { channel: "whatsapp", ...target }),
    o.category === "MARKETING" ? consentHistory(db, target, 1) : Promise.resolve([]),
    getAge(db, { botId: c.bot_id, channel: "whatsapp", contact: phone }),
  ]);
  // marketing gravado pelo contato ("c:") cujo contato foi apagado depois (pedido do titular)
  const decision = decideSend({ templateCategory: o.category, suppressed: suppressed.map((s) => s.kind), consent: consentStateOf(history), regulated: c.regulated, age, contactGone: row.dedupe_key.startsWith("c:") && !row.contact_id });
  if (decision !== "send") {
    await set(decision);
    return decision;
  }

  let wamid: string | null;
  try {
    wamid = (await sendTemplate(o.ch, phone, { name: c.template_name, language: c.template_language }, variables, { callbackData: `cs:${row.id}` })).messages?.[0]?.id ?? null;
  } catch (e) {
    if (isAccessError(e) || isPaymentError(e)) {
      if (isAccessError(e)) await markDisconnected(db, { column: "bot_id", value: c.bot_id }, TOKEN_REJECTED);
      else await markPaymentIssue(db, { column: "bot_id", value: c.bot_id });
      await set("queued", { claimed_at: null });
      await pause(db, c, isAccessError(e) ? "a Meta recusou o acesso ao número" : "a conta do WhatsApp está sem forma de pagamento na Meta");
      return "stop";
    }
    if (!(e instanceof WhatsAppError)) return "unknown"; // sem resposta: fica "sending" e vira incerta
    const outcome = sendErrorOutcome(e.code);
    if (outcome === "retry") {
      await set("queued", { claimed_at: null, send_at: new Date(Date.now() + 60_000).toISOString() });
      return "retry";
    }
    await set(outcome, { error_code: e.code ? String(e.code) : "erro" });
    if (outcome === "opted_out") {
      await suppress(db, { channel: "whatsapp", ...target, kind: "marketing", reason: "meta_131050", source: "meta" });
      await revokeConsents(db, target, "meta:131050");
    }
    return outcome;
  }
  // o status da Meta pode chegar antes desta gravação: "enviada" não passa por cima de entregue ou lida
  const sentAt = new Date().toISOString();
  await db.from("campaign_sends").update({ sent_at: sentAt, updated_at: sentAt, channel_msg_hash: wamid ? channelMsgHash("whatsapp", wamid) : null }).eq("id", row.id);
  await db.from("campaign_sends").update({ status: "sent" }).eq("id", row.id).in("status", ["sending", "uncertain"]);
  // a mensagem entra na conversa do contato (a IA e a equipe veem o que foi enviado)
  await recordInConversation(db, o.bot, phone, row.contact_id, renderTemplate(o.body, variables), o.category, c.name, wamid).catch((e) => console.error("campanha: mensagem não gravada na conversa", (e as Error).message));
  return "sent";
}

async function recordInConversation(db: SupabaseClient, bot: { id: string; agency_id: string }, phone: string, contactId: string | null, content: string, category: string, campaignName: string, wamid: string | null) {
  const contact = contactId ? { id: contactId } : await whatsappContact(db, bot, { phone });
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const recentBy = db.from("conversations").select("id").eq("bot_id", bot.id).gt("last_message_at", since).order("last_message_at", { ascending: false }).limit(1);
  const { data: recent } = await (contact ? recentBy.eq("contact_id", contact.id) : recentBy.in("wa_id", waIdVariants(phone))).maybeSingle();
  let conversationId = recent?.id as string | undefined;
  if (!conversationId) {
    const { data: created } = await db.from("conversations").insert({ bot_id: bot.id, channel: "whatsapp", wa_id: phone, contact_id: contact?.id ?? null, visitor_id: null }).select("id").single();
    conversationId = created?.id as string | undefined;
  }
  if (!conversationId) return;
  // a categoria decide o alcance de um SAIR respondido depois (descadastro da categoria do último modelo)
  await saveMessage(db, { conversation_id: conversationId, role: "agent", content, author: "campanha", author_type: "system", author_display_name: `Campanha: ${campaignName}`.slice(0, 80), template_category: category, channel_msg_id: "enviada", channel_msg_hash: wamid ? channelMsgHash("whatsapp", wamid) : null }, { touch: "equipe" });
}

async function updateTotals(db: SupabaseClient, id: string): Promise<Record<string, number>> {
  const { data } = await db.rpc("campaign_totals", { p_campaign: id });
  const totals = (data ?? {}) as Record<string, number>;
  await db.from("campaigns").update({ totals, updated_at: new Date().toISOString() }).eq("id", id);
  return totals;
}

/** Sem nada na fila nem enviando: a campanha termina. */
async function finishIfDone(db: SupabaseClient, id: string): Promise<boolean> {
  const totals = await updateTotals(db, id);
  if ((totals.queued ?? 0) > 0 || (totals.sending ?? 0) > 0) return false;
  const { data } = await db.from("campaigns").update({ status: "finished", finished_at: new Date().toISOString() }).eq("id", id).eq("status", "sending").select("id");
  return Boolean(data?.length);
}

/* ------------------------------------------------------------------ conciliar (status da Meta) */

/** Lembrete de utilidade cobrado pela Meta como marketing: o modelo foi reclassificado. Pura. */
export const billedAsMarketing = (kind: string, pricingCategory: string | null | undefined) => kind === "utility_reminder" && (pricingCategory ?? "").toLowerCase() === "marketing";

/**
 * Status de uma mensagem de campanha ("cs:<id>" em biz_opaque_callback_data). pricingCategory: a
 * categoria em que a Meta cobrou; lembrete cobrado como marketing pausa a campanha.
 */
export async function reconcileCampaignStatus(db: SupabaseClient, ref: string, metaStatus: string, errorCode?: number, pricingCategory?: string | null): Promise<void> {
  const id = Number(ref.replace(/^cs:/, ""));
  if (!Number.isSafeInteger(id) || id <= 0) return;
  const { data: row } = await db.from("campaign_sends").select("status, campaign_id").eq("id", id).maybeSingle();
  if (!row) return;
  if (pricingCategory) {
    const { data: c } = await db.from("campaigns").select("id, agency_id, bot_id, name, kind, template_name").eq("id", row.campaign_id as string).maybeSingle();
    if (c && billedAsMarketing(c.kind as string, pricingCategory)) {
      await pause(db, c as Pick<CampaignRow, "id" | "agency_id" | "bot_id" | "name">, `a Meta cobrou o lembrete como marketing (o modelo ${c.template_name as string} foi reclassificado)`, [CATEGORY_REVIEW_HINT]);
    }
  }
  const next = nextSendStatus(row.status as SendStatus, metaStatus, errorCode);
  if (!next) return;
  await db.from("campaign_sends").update({ status: next, updated_at: new Date().toISOString(), ...(next === "failed" || next === "opted_out" ? { error_code: errorCode ? String(errorCode) : "erro" } : {}), ...(next === "sent" ? { sent_at: new Date().toISOString() } : {}) }).eq("id", id).eq("status", row.status as string);
}

/* ------------------------------------------------------------------ painel e backoffice */

/** O que o Supabase sabe do tique automático (migração 0083): agendamento, cofre e últimas chamadas. */
export interface TickDiagnostics {
  pg_net: boolean;
  pg_cron: boolean;
  secrets?: string[];
  secrets_error?: string;
  job?: Array<{ jobname: string; schedule: string; active: boolean }>;
  runs?: Array<{ status: string; message: string | null; start_time: string }>;
  cron_error?: string;
  calls?: TickCall[];
  calls_error?: string;
}
export interface TickCall {
  created: string;
  status_code: number | null;
  timed_out: boolean | null;
  error: string | null;
  body: string | null;
}

export async function tickDiagnostics(db: SupabaseClient): Promise<TickDiagnostics | null> {
  const { data, error } = await db.rpc("campaign_tick_diagnostics");
  return error ? null : (data as TickDiagnostics);
}

/** Segredos do cofre que faltam para o tique automático (o de bypass só vale atrás da proteção da Vercel). Pura. */
export const missingSecrets = (d: TickDiagnostics) => ["boavoz_campaigns_url", "boavoz_cron_secret"].filter((n) => !(d.secrets ?? []).includes(n));

/** O que a resposta do BoaVoz a uma chamada do Supabase quer dizer. Pura. */
export function tickCallHint(c: TickCall): string {
  if (c.timed_out) return "o BoaVoz não respondeu a tempo (o tique pode ter rodado mesmo assim)";
  if (c.error) return `a chamada não chegou: ${c.error}`;
  const status = c.status_code ?? 0;
  const body = c.body ?? "";
  if (status >= 200 && status < 300) return "ok: o tique rodou";
  if (/vercel/i.test(body) || status === 302 || status === 307) return "a proteção da Vercel barrou a chamada: confira o segredo boavoz_vercel_bypass (Protection Bypass for Automation)";
  if (status === 401) return "o segredo boavoz_cron_secret não bate com o CRON_SECRET da Vercel (ou a variável entrou sem um novo deploy)";
  if (status === 404) return "endereço errado em boavoz_campaigns_url";
  if (status >= 500) return "o tique deu erro no BoaVoz (veja o Sentry e os logs da Vercel)";
  return `resposta inesperada (HTTP ${status})`;
}

export interface CampaignView {
  id: string;
  bot_id: string;
  name: string;
  kind: CampaignKind;
  status: CampaignStatus;
  pause_reason: string | null;
  template_name: string;
  scheduled_at: string | null;
  created_at: string;
  finished_at: string | null;
  totals: Record<string, number>;
  estimated_contacts: number | null;
  /** centavos de real (custo estimado na Meta) */
  estimated_cost_cents: number | null;
}

/**
 * Campanhas de um conjunto de chatbots, as mais novas primeiro. Os totais são contados na hora:
 * entregue e lida chegam pelos status da Meta depois que a campanha terminou.
 */
export async function listCampaigns(db: SupabaseClient, botIds: string[], limit = 20): Promise<CampaignView[]> {
  if (!botIds.length) return [];
  const { data } = await db.from("campaigns").select("id, bot_id, name, kind, status, pause_reason, template_name, scheduled_at, created_at, finished_at, totals, estimated_contacts, estimated_cost_cents").in("bot_id", botIds).order("created_at", { ascending: false }).limit(limit);
  const rows = (data ?? []) as CampaignView[];
  return Promise.all(rows.map(async (c) => ({ ...c, totals: ((await db.rpc("campaign_totals", { p_campaign: c.id })).data as Record<string, number> | null) ?? c.totals })));
}

/**
 * Pedido do titular: os envios do contato perdem o telefone e as variáveis (fica só o hash, que
 * conta no limite de 24 h e no relatório), e o que estava na fila não sai mais. Por contato e pelo
 * hash do telefone (lembrete de planilha pode não ter contato).
 */
export async function forgetCampaignSends(db: SupabaseClient, o: { contactIds: string[]; phoneHashes: string[] }): Promise<number> {
  let erased = 0;
  for (const [column, values] of [["contact_id", o.contactIds], ["phone_hash", o.phoneHashes]] as const) {
    for (let i = 0; i < values.length; i += 200) {
      const chunk = values.slice(i, i + 200);
      await db.from("campaign_sends").update({ status: "skipped_contact_deleted", updated_at: new Date().toISOString() }).in(column, chunk).eq("status", "queued");
      const { data, error } = await db.from("campaign_sends").update({ phone_enc: null, variables_enc: null }).in(column, chunk).not("phone_enc", "is", null).select("id");
      if (error) throw new Error(`envios de campanha do contato: ${error.message}`);
      erased += data?.length ?? 0;
    }
  }
  return erased;
}

/** Retenção: as variáveis saem 30 dias depois do envio; as linhas, depois de 13 meses. */
export async function purgeCampaignData(db: SupabaseClient, now = Date.now()): Promise<void> {
  await db.from("campaign_sends").update({ variables_enc: null }).lt("updated_at", new Date(now - 30 * 86_400_000).toISOString()).not("variables_enc", "is", null).not("status", "in", "(queued,sending)");
  await db.from("campaign_sends").delete().lt("updated_at", new Date(now - 400 * 86_400_000).toISOString()).not("status", "in", "(queued,sending)");
  await db.from("campaigns").delete().lt("finished_at", new Date(now - 400 * 86_400_000).toISOString());
}

/* ------------------------------------------------------------------ relatório (parte 4b) */

/** Chatbots ligados a uma conta do WhatsApp (o descadastro nativo vem pela conta). */
export async function botsOfWaba(db: SupabaseClient, wabaId: string): Promise<string[]> {
  const { data } = await db.from("whatsapp_channels").select("bot_id").eq("waba_id", wabaId);
  return (data ?? []).map((c) => c.bot_id as string);
}

export type OptOutSource = "sair" | "botao" | "whatsapp";

/**
 * Resposta ou descadastro de quem recebeu campanha ou lembrete: marca o envio mais recente do
 * contato nesses chatbots (resposta nos 3 dias seguintes, descadastro nos 7). Nunca derruba o
 * atendimento: erro só vai para o log.
 */
export async function markCampaignContact(db: SupabaseClient, botIds: string[], waId: string, event: "reply" | "opt_out", source: OptOutSource | null = null): Promise<void> {
  const hash = metaPhoneHash(waId);
  if (!hash || !botIds.length) return;
  try {
    const { error } = await db.rpc("campaign_mark_contact", { p_bot_ids: botIds, p_phone_hash: hash, p_event: event, p_source: source });
    if (error) console.error("campanha: resposta ou descadastro não marcado", error.message);
  } catch (e) {
    console.error("campanha: resposta ou descadastro não marcado", (e as Error).message);
  }
}

/** Erros da Meta no envio de modelos, para o relatório. */
export const SEND_ERROR_LABEL: Record<string, string> = {
  "131049": "a Meta limita quantas promoções cada pessoa recebe, somando todas as empresas (sem contorno; tente outro dia)",
  "131026": "o número não pode receber (sem WhatsApp ou aplicativo desatualizado)",
  "131037": "o número da empresa ainda não tem o nome de exibição aprovado pela Meta",
  "131042": "a conta do WhatsApp está sem forma de pagamento na Meta",
  "131051": "tipo de mensagem não aceito",
  "130472": "a Meta segurou a mensagem (o número participa de um teste da própria Meta)",
  "132000": "o número de variáveis não bate com o modelo",
  "132001": "o modelo não existe nesse idioma",
  "132015": "o modelo foi pausado por baixa qualidade",
  "132016": "o modelo foi desativado pela Meta",
  "131000": "erro interno da Meta",
};

export const OPT_OUT_LABEL: Record<string, string> = {
  sair: "responderam SAIR, PARAR ou STOP",
  botao: "tocaram em “Parar promoções”",
  whatsapp: "pararam as promoções pelo próprio WhatsApp",
  meta_131050: "a Meta recusou o envio: a pessoa já tinha parado as promoções (erro 131050)",
};

export interface CampaignReport {
  status: Partial<Record<SendStatus, number>>;
  replied: number;
  optOut: Record<string, number>;
  errors: Record<string, number>;
}

export async function campaignReport(db: SupabaseClient, id: string): Promise<CampaignReport> {
  const { data } = await db.rpc("campaign_report", { p_campaign: id });
  const r = (data ?? {}) as { status?: Record<string, number>; replied?: number; opt_out?: Record<string, number>; errors?: Record<string, number> };
  return { status: r.status ?? {}, replied: r.replied ?? 0, optOut: r.opt_out ?? {}, errors: r.errors ?? {} };
}

/** Os números do funil a partir das contagens por status. Pura. */
export function reportNumbers(r: CampaignReport) {
  const n = (s: SendStatus) => r.status[s] ?? 0;
  const read = n("read");
  const delivered = n("delivered") + read;
  const sent = n("sent") + delivered + n("uncertain");
  const optOuts = Object.values(r.optOut).reduce((a, b) => a + b, 0);
  const skipped = n("skipped_no_consent") + n("skipped_suppressed") + n("skipped_no_age") + n("skipped_contact_deleted");
  return { sent, delivered, read, replied: r.replied, failed: n("failed"), optOuts, skipped, pending: n("queued") + n("sending"), uncertain: n("uncertain") };
}

export interface CampaignDetail extends CampaignView {
  template_language: string;
  template_category: string;
  regulated: boolean;
  created_by: string | null;
  updated_at: string;
}

/** Uma campanha, só se for de um dos chatbots informados (o escopo de quem está logado). */
export async function campaignDetail(db: SupabaseClient, id: string, botIds: string[]): Promise<CampaignDetail | null> {
  if (!botIds.length) return null;
  const { data } = await db
    .from("campaigns")
    .select("id, bot_id, name, kind, status, pause_reason, template_name, template_language, template_category, regulated, scheduled_at, created_at, created_by, updated_at, finished_at, totals, estimated_contacts, estimated_cost_cents")
    .eq("id", id)
    .in("bot_id", botIds)
    .maybeSingle();
  return (data as CampaignDetail | null) ?? null;
}

export interface WhatsAppLimit {
  wabaId: string;
  phones: string[];
  botIds: string[];
  tier: string | null;
  limit: number;
  quality: string | null;
  /** contatos únicos que receberam campanha ou lembrete nas últimas 24 h, na conta toda */
  used: number;
}

/** Limite de envio da Meta de cada conta do WhatsApp destes chatbots, com o uso das últimas 24 h. */
export async function whatsappLimits(db: SupabaseClient, botIds: string[]): Promise<WhatsAppLimit[]> {
  if (!botIds.length) return [];
  const { data } = await db.from("whatsapp_channels").select("bot_id, phone_number_id, waba_id, access_token_enc, display_phone").in("bot_id", botIds).is("disconnected_at", null).not("waba_id", "is", null);
  const byWaba = new Map<string, Array<Record<string, unknown>>>();
  for (const c of data ?? []) byWaba.set(c.waba_id as string, [...(byWaba.get(c.waba_id as string) ?? []), c]);
  const now = new Date();
  return Promise.all(
    [...byWaba.entries()].map(async ([wabaId, chs]) => {
      const first = chs[0] as unknown as TemplateChannel & { bot_id: string };
      const [standing, used] = await Promise.all([phoneStanding(first).catch(() => ({ tier: null, quality: null })), portfolioRecipients(db, wabaId, first.bot_id, now)]);
      return { wabaId, phones: chs.map((c) => (c.display_phone as string | null) ?? "").filter(Boolean), botIds: chs.map((c) => c.bot_id as string), tier: standing.tier, limit: tierLimit(standing.tier), quality: standing.quality, used };
    }),
  );
}
