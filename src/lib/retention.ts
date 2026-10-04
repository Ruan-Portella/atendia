import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "./audit";
import { logDeletion } from "./deletions";
import { notifyAgencyOwner } from "./notify";
import { reportedUntil } from "./report-daily";
import { deleteLeads, leadIdsBefore } from "./leads";
import { deleteUnanswered, unansweredIdsBefore } from "./unanswered";
import { deleteRefusalsBefore } from "./scope-refusals";
import { deleteContacts, retentionContacts } from "./contacts";
import { deleteAgesOf } from "./gate/age";
import { appUrl } from "./utils";

/*
 * Retenção (leva S; spec "Ciclo de vida dos dados"). Prazo efetivo de um chatbot: o do modo dados
 * sensíveis (7 a 90 dias), senão o do cliente, senão o da agência (6, 12 ou 24 meses);
 * demonstração: 30 dias. A rotina diária apaga, por chatbot e em lotes, conversas (com as
 * mensagens) paradas desde antes do corte, leads, perguntas sem resposta e pedidos fora do assunto
 * mais antigos, e fichas de contato paradas, sem conversa nem vínculo ativo (com a resposta de
 * 18+). Nada depois do último dia somado nos relatórios (report_daily) sai. Toda exclusão vai
 * para o registro de exclusões.
 * Agência: mudança de prazo por pendência (redução em 30 dias, com aviso; aumento na hora). O
 * "Não apagar" deixa de existir: a rotina agenda 12 meses com efeito em 30 dias e avisa.
 */

export const RETENTION_MONTHS = [6, 12, 24] as const;
export type RetentionMonths = (typeof RETENTION_MONTHS)[number];
export const DEFAULT_RETENTION_MONTHS: RetentionMonths = 12;
export const RETENTION_NOTICE_DAYS = 30;
export const SENSITIVE_DAYS = [7, 15, 30, 60, 90] as const;
export const SENSITIVE_MIN_DAYS = 7;
export const SENSITIVE_MAX_DAYS = 90;
export const DEMO_RETENTION_DAYS = 30;
/** Código no registro de exclusões (o que a retenção apagou). */
export const RETENTION_CODE = "retencao";

const DAY = 86_400_000;

export const isRetentionMonths = (v: unknown): v is RetentionMonths => RETENTION_MONTHS.includes(v as RetentionMonths);

export type RetentionSource = "demo" | "sensivel" | "cliente" | "agencia" | "nenhum";

export interface BotRetentionInput {
  isDemo: boolean;
  sensitiveMode: boolean;
  sensitiveDays: number | null;
  clientMonths: number | null;
  agencyMonths: number | null;
}

/** Prazo efetivo de um chatbot, em dias (null: sem prazo, não apaga). Pura. */
export function effectiveRetention(b: BotRetentionInput): { days: number | null; source: RetentionSource } {
  if (b.isDemo) return { days: DEMO_RETENTION_DAYS, source: "demo" };
  if (b.sensitiveMode) return { days: Math.min(SENSITIVE_MAX_DAYS, Math.max(SENSITIVE_MIN_DAYS, b.sensitiveDays ?? 30)), source: "sensivel" };
  if (b.clientMonths) return { days: b.clientMonths * 30, source: "cliente" };
  if (b.agencyMonths) return { days: b.agencyMonths * 30, source: "agencia" };
  return { days: null, source: "nenhum" };
}

/** "12 meses", "30 dias" ou "sem prazo". Pura. */
export function retentionLabel(days: number | null): string {
  if (days === null) return "sem prazo";
  return days >= 180 && days % 30 === 0 ? `${days / 30} meses` : `${days} dias`;
}

/** O prazo novo é menor que o de antes? (null = sem prazo, o maior de todos). Pura. */
export const retentionReduced = (beforeDays: number | null, afterDays: number | null) => afterDays !== null && (beforeDays === null || afterDays < beforeDays);

export interface AgencyRetention {
  months: number | null;
  pendingMonths: number | null;
  effectiveAt: string | null;
}

export type AgencyRetentionPlan =
  | { kind: "sem_mudanca" }
  | { kind: "aumento" | "desfazer"; patch: { retention_months: number; retention_pending_months: null; retention_effective_at: null } }
  | { kind: "reducao"; patch: { retention_pending_months: number; retention_effective_at: string } };

/**
 * A agência escolhe um prazo. Aumento vale na hora; redução (ou sair do "Não apagar") espera 30
 * dias, pendente; escolher o prazo atual desfaz a pendência. Uma pendência já avisada continua
 * com a data dela se o prazo novo não for menor que o avisado. Pura.
 */
export function planAgencyRetention(cur: AgencyRetention, chosen: RetentionMonths, now = new Date()): AgencyRetentionPlan {
  if (cur.months === chosen) return cur.pendingMonths !== null ? { kind: "desfazer", patch: { retention_months: chosen, retention_pending_months: null, retention_effective_at: null } } : { kind: "sem_mudanca" };
  if (cur.months !== null && chosen > cur.months) return { kind: "aumento", patch: { retention_months: chosen, retention_pending_months: null, retention_effective_at: null } };
  if (cur.pendingMonths === chosen && cur.effectiveAt) return { kind: "sem_mudanca" };
  const keepDate = cur.pendingMonths !== null && cur.effectiveAt !== null && chosen >= cur.pendingMonths;
  return { kind: "reducao", patch: { retention_pending_months: chosen, retention_effective_at: keepDate ? cur.effectiveAt! : new Date(now.getTime() + RETENTION_NOTICE_DAYS * DAY).toISOString() } };
}

export const dateBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/* ------------------------------------------------------------------ rotina diária */

/** Promove os prazos de agência que chegaram à data de efeito. */
export async function promoteAgencyRetention(db: SupabaseClient, now = new Date()): Promise<number> {
  const { data } = await db.from("agencies").select("id, retention_months, retention_pending_months").not("retention_pending_months", "is", null).lte("retention_effective_at", now.toISOString()).limit(500);
  let n = 0;
  for (const a of data ?? []) {
    const { data: upd } = await db
      .from("agencies")
      .update({ retention_months: a.retention_pending_months, retention_pending_months: null, retention_effective_at: null })
      .eq("id", a.id)
      .eq("retention_pending_months", a.retention_pending_months)
      .select("id");
    if (!upd?.length) continue;
    n++;
    await audit(db, { agencyId: a.id as string, actorType: "system", actorId: null, action: "retencao.promover", targetType: "agency", targetId: a.id as string, before: { retention_months: a.retention_months }, after: { retention_months: a.retention_pending_months } });
  }
  return n;
}

/** "Não apagar" deixa de existir: agenda 12 meses com efeito em 30 dias e avisa a agência (uma vez). */
export async function scheduleDefaultRetention(db: SupabaseClient, now = new Date()): Promise<number> {
  const { data } = await db.from("agencies").select("id").is("retention_months", null).is("retention_pending_months", null).not("owner_id", "is", null).limit(200);
  const effective = new Date(now.getTime() + RETENTION_NOTICE_DAYS * DAY).toISOString();
  let n = 0;
  for (const a of data ?? []) {
    const { data: upd } = await db
      .from("agencies")
      .update({ retention_pending_months: DEFAULT_RETENTION_MONTHS, retention_effective_at: effective })
      .eq("id", a.id)
      .is("retention_months", null)
      .is("retention_pending_months", null)
      .select("id");
    if (!upd?.length) continue;
    n++;
    const sent = await notifyAgencyOwner(db, a.id as string, `As conversas passam a ser guardadas por ${DEFAULT_RETENTION_MONTHS} meses`, [
      `Sua conta está em "Não apagar" as conversas e os contatos dos chatbots. A LGPD pede guardar dados pessoais só pelo tempo necessário, então o BoaVoz passa a apagar automaticamente o que tiver mais de ${DEFAULT_RETENTION_MONTHS} meses.`,
      "",
      `A mudança vale a partir de ${dateBR(effective)}. Até lá nada é apagado.`,
      "",
      "O que muda: conversas paradas há mais tempo que o prazo, com as mensagens, leads, perguntas sem resposta e fichas de contato sem conversa. Os relatórios continuam com os números de todos os meses.",
      `Se precisar guardar algo mais antigo, exporte os leads antes (planilha com todos os clientes): ${appUrl("/api/leads/export")}`,
      "",
      `Você pode escolher 6, 12 ou 24 meses em Marca e domínio → Privacidade e LGPD, e cada cliente pode ter um prazo próprio: ${appUrl("/painel/marca")}`,
    ]).catch(() => false);
    await audit(db, { agencyId: a.id as string, actorType: "system", actorId: null, action: "retencao.aviso_padrao", targetType: "agency", targetId: a.id as string, before: { retention_months: null }, after: { retention_pending_months: DEFAULT_RETENTION_MONTHS, retention_effective_at: effective, aviso_enviado: sent } });
  }
  return n;
}

export interface RetentionTotals {
  conversations: number;
  leads: number;
  unanswered: number;
  refusals: number;
  contacts: number;
}

const BATCH = 200;

/** Apaga, em lotes, o que deste chatbot é mais antigo que o corte. */
export async function deleteBotDataBefore(db: SupabaseClient, botId: string, cutoff: string, hasTime: () => boolean = () => true): Promise<RetentionTotals> {
  const t: RetentionTotals = { conversations: 0, leads: 0, unanswered: 0, refusals: 0, contacts: 0 };
  // conversas paradas desde antes do corte (mensagens, recusas e detecções vão junto)
  while (hasTime()) {
    const { data } = await db.from("conversations").select("id").eq("bot_id", botId).lt("last_message_at", cutoff).limit(BATCH);
    const ids = (data ?? []).map((c) => c.id as string);
    if (!ids.length) break;
    await logDeletion(db, "conversations", ids, RETENTION_CODE);
    const { error } = await db.from("conversations").delete().in("id", ids).eq("bot_id", botId);
    if (error) throw new Error(`retenção das conversas: ${error.message}`);
    t.conversations += ids.length;
    if (ids.length < BATCH) break;
  }
  while (hasTime()) {
    const ids = await leadIdsBefore(db, botId, cutoff, BATCH);
    if (!ids.length) break;
    await logDeletion(db, "leads", ids, RETENTION_CODE);
    t.leads += (await deleteLeads(db, ids)) ?? 0;
    if (ids.length < BATCH) break;
  }
  while (hasTime()) {
    const ids = await unansweredIdsBefore(db, botId, cutoff, BATCH);
    if (!ids.length) break;
    await logDeletion(db, "unanswered", ids, RETENTION_CODE);
    await deleteUnanswered(db, ids);
    t.unanswered += ids.length;
    if (ids.length < BATCH) break;
  }
  if (hasTime()) t.refusals += await deleteRefusalsBefore(db, botId, cutoff);
  // fichas paradas, sem conversa nem vínculo ativo; a resposta de 18+ sai junto
  let after: string | undefined;
  while (hasTime()) {
    const { rows, last } = await retentionContacts(db, botId, cutoff, { after, limit: BATCH });
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      await logDeletion(db, "contacts", ids, RETENTION_CODE);
      for (const r of rows) {
        if (r.channel !== "widget") await deleteAgesOf(db, botId, r.ids.map((contact) => ({ channel: r.channel as "whatsapp" | "instagram", contact })));
      }
      await deleteContacts(db, ids, [botId]);
      t.contacts += ids.length;
    }
    if (!last) break;
    after = last;
  }
  return t;
}

type BotRow = {
  id: string;
  is_demo: boolean;
  sensitive_mode: boolean;
  sensitive_retention_days: number | null;
  clients: { retention_months: number | null } | Array<{ retention_months: number | null }> | null;
  agencies: { retention_months: number | null } | Array<{ retention_months: number | null }> | null;
};
const one = <T,>(x: T | T[] | null) => (Array.isArray(x) ? x[0] : x) ?? null;

/** O prazo de cada chatbot, aplicado. Promove antes os prazos vencidos e agenda o padrão de quem estava em "Não apagar". */
export async function applyRetentionTerms(db: SupabaseClient, hasTime: () => boolean = () => true, now = new Date()): Promise<RetentionTotals & { promoted: number; scheduled: number; skipped?: string }> {
  const promoted = await promoteAgencyRetention(db, now);
  const scheduled = await scheduleDefaultRetention(db, now);
  const totals: RetentionTotals = { conversations: 0, leads: 0, unanswered: 0, refusals: 0, contacts: 0 };
  // os totais diários vêm antes: nada depois do último dia somado é apagado (sem totais, nada sai)
  const until = await reportedUntil(db);
  if (!until) return { ...totals, promoted, scheduled, skipped: "totais diários ainda não somados" };
  const { data: bots, error } = await db.from("bots").select("id, is_demo, sensitive_mode, sensitive_retention_days, clients(retention_months), agencies(retention_months)");
  if (error) throw new Error(`retenção: ${error.message}`);
  for (const b of (bots ?? []) as unknown as BotRow[]) {
    if (!hasTime()) break;
    const r = effectiveRetention({ isDemo: b.is_demo, sensitiveMode: b.sensitive_mode, sensitiveDays: b.sensitive_retention_days, clientMonths: one(b.clients)?.retention_months ?? null, agencyMonths: one(b.agencies)?.retention_months ?? null });
    if (r.days === null) continue;
    const cutoff = new Date(Math.min(now.getTime() - r.days * DAY, until.getTime())).toISOString();
    const t = await deleteBotDataBefore(db, b.id, cutoff, hasTime);
    for (const k of Object.keys(totals) as Array<keyof RetentionTotals>) totals[k] += t[k];
  }
  return { ...totals, promoted, scheduled };
}
