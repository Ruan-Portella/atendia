import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyPlatform } from "./notify";
import { noticeOnce } from "./rate-limit";
import { resubscribeApp, subscribedAppIds } from "./whatsapp";
import { instagramSubscribedFields, resubscribeInstagram } from "./instagram";
import { CAMPAIGN_NOTICE_FIELDS } from "./campaigns";
import { inboundErrorStats } from "./inbound-queue";
import { sendFailureStats } from "./messages";

/*
 * Monitoramento da Meta (spec, Infraestrutura, Monitoramento; leva Pendências do MVP, parte 3):
 * - todo dia, cada número e cada conta do Instagram ainda tem o app inscrito? Sem a inscrição, o
 *   webhook não recebe nada e ninguém percebe (o Instagram descarta os webhooks depois de 36 horas);
 *   o BoaVoz inscreve de novo e avisa o Ruan;
 * - evento da Meta que o código não reconhece (campo novo, tipo de mensagem novo) avisa o Ruan, uma
 *   vez por dia por tipo, para não virar contato sem resposta em silêncio;
 * - erro alto de IA ou da Meta nas últimas 24 horas (mensagens que precisaram de outra tentativa e
 *   envios recusados pelo canal) também avisa.
 */

/** Campos do webhook do WhatsApp que o BoaVoz trata ou confirma de propósito (o histórico sincronizado não é guardado). */
export const KNOWN_WA_FIELDS: ReadonlySet<string> = new Set(["messages", "account_update", "smb_message_echoes", "user_preferences", "history", "smb_app_state_sync", ...CAMPAIGN_NOTICE_FIELDS]);
/** Tipos de mensagem do WhatsApp que o BoaVoz trata (os silenciosos também: reação, sistema…). */
export const KNOWN_WA_MESSAGE_TYPES: ReadonlySet<string> = new Set(["text", "interactive", "button", "audio", "image", "video", "document", "sticker", "location", "contacts", "reaction", "unsupported", "system", "ephemeral", "request_welcome", "order"]);
/** Campos do webhook do Instagram que o BoaVoz trata. */
export const KNOWN_IG_FIELDS: ReadonlySet<string> = new Set(["messages", "comments", "messaging_postbacks", "messaging_referral", "message_edit", "message_reactions", "messaging_seen", "live_comments"]);

/** Avisa o Ruan do que a Meta mandou e o código não conhece: uma vez por dia por tipo. */
export async function reportUnknownMeta(db: SupabaseClient, source: "whatsapp" | "instagram", kinds: string[]): Promise<number> {
  let sent = 0;
  for (const kind of new Set(kinds.filter(Boolean))) {
    if (!(await noticeOnce(db, { key: `meta-desconhecido:${source}:${kind}`, max: 1, windowSeconds: 86_400, message: "" }))) continue;
    console.warn("meta: evento não reconhecido", source, kind);
    await notifyPlatform(`Evento da Meta não reconhecido: ${source} ${kind}`, [
      `O webhook do ${source === "whatsapp" ? "WhatsApp" : "Instagram"} recebeu "${kind}", que o BoaVoz ainda não trata.`,
      "Se for mensagem de contato, ela pode ter ficado sem resposta. Veja os logs da Vercel e, se for preciso, trate no código.",
      "Este aviso vai uma vez por dia para cada tipo.",
    ]).catch(() => false);
    sent++;
  }
  return sent;
}

export interface SubscriptionDeps {
  waApps: (ch: { phone_number_id: string; waba_id: string; access_token_enc: string | null }) => Promise<string[]>;
  waResubscribe: (ch: { phone_number_id: string; waba_id: string; access_token_enc: string | null }) => Promise<void>;
  igFields: (ch: { ig_user_id: string; access_token_enc: string | null }) => Promise<string[]>;
  igResubscribe: (ch: { ig_user_id: string; access_token_enc: string | null }) => Promise<void>;
}

const defaultDeps: SubscriptionDeps = { waApps: subscribedAppIds, waResubscribe: resubscribeApp, igFields: instagramSubscribedFields, igResubscribe: resubscribeInstagram };

/**
 * A conferência diária das inscrições. Sem o app na conta: inscreve de novo e avisa. Erro ao
 * consultar (token recusado, conta removida) não vira aviso aqui: o acesso perdido já tem o
 * caminho dele (PARTNER_REMOVED, token do Instagram vencido).
 */
export async function checkSubscriptions(db: SupabaseClient, o: { hasTime?: () => boolean; appId?: string | null; deps?: SubscriptionDeps } = {}): Promise<{ checked: number; fixed: string[]; failed: string[] }> {
  const deps = o.deps ?? defaultDeps;
  const hasTime = o.hasTime ?? (() => true);
  const appId = o.appId === undefined ? (process.env.META_APP_ID ?? process.env.WHATSAPP_APP_ID ?? null) : o.appId;
  const fixed: string[] = [];
  const failed: string[] = [];
  let checked = 0;
  const { data: wa } = await db.from("whatsapp_channels").select("bot_id, phone_number_id, waba_id, access_token_enc").is("disconnected_at", null).not("waba_id", "is", null).limit(1000);
  for (const ch of (wa ?? []) as Array<{ bot_id: string; phone_number_id: string; waba_id: string; access_token_enc: string | null }>) {
    if (!hasTime()) break;
    if (!appId) break;
    let apps: string[];
    try {
      apps = await deps.waApps(ch);
    } catch {
      continue;
    }
    checked++;
    if (apps.includes(appId)) continue;
    try {
      await deps.waResubscribe(ch);
      fixed.push(`WhatsApp ${ch.phone_number_id} (chatbot ${ch.bot_id})`);
    } catch (e) {
      failed.push(`WhatsApp ${ch.phone_number_id} (chatbot ${ch.bot_id}): ${(e as Error).message.slice(0, 120)}`);
    }
  }
  const { data: ig } = await db.from("instagram_channels").select("bot_id, ig_user_id, access_token_enc").is("disconnected_at", null).not("access_token_enc", "is", null).limit(1000);
  for (const ch of (ig ?? []) as Array<{ bot_id: string; ig_user_id: string; access_token_enc: string | null }>) {
    if (!hasTime()) break;
    let fields: string[];
    try {
      fields = await deps.igFields(ch);
    } catch {
      continue;
    }
    checked++;
    if (fields.includes("messages")) continue;
    try {
      await deps.igResubscribe(ch);
      fixed.push(`Instagram ${ch.ig_user_id} (chatbot ${ch.bot_id})`);
    } catch (e) {
      failed.push(`Instagram ${ch.ig_user_id} (chatbot ${ch.bot_id}): ${(e as Error).message.slice(0, 120)}`);
    }
  }
  if (fixed.length || failed.length) {
    await notifyPlatform(`Inscrição do app na Meta: ${fixed.length} refeita(s), ${failed.length} com erro`, [
      "Contas em que o app do BoaVoz não estava inscrito (o webhook não recebia nada delas):",
      ...fixed.map((x) => `- inscrito de novo: ${x}`),
      ...failed.map((x) => `- não deu para inscrever: ${x}`),
      "Confira no painel da Meta e nos logs se as mensagens voltaram a chegar.",
    ]).catch(() => false);
  }
  return { checked, fixed, failed };
}

/** Limites do alerta de erro alto (24 horas): a partir de um mínimo de casos, para não disparar com pouco volume. */
export const ERROR_ALERT = { minRetried: 10, retriedRatio: 0.05, minFailed: 20, failedRatio: 0.1 } as const;

/** O que passou do limite: mensagens que precisaram de outra tentativa e envios recusados. Função pura. */
export function errorAlerts(inbound: { total: number; retried: number }, sends: { sent: number; failed: number }): string[] {
  const out: string[] = [];
  const pct = (n: number, d: number) => `${Math.round((n / Math.max(d, 1)) * 100)}%`;
  if (inbound.retried >= ERROR_ALERT.minRetried && inbound.retried / Math.max(inbound.total, 1) >= ERROR_ALERT.retriedRatio)
    out.push(`IA ou processamento: ${inbound.retried} de ${inbound.total} mensagens recebidas precisaram de outra tentativa ou falharam (${pct(inbound.retried, inbound.total)}).`);
  if (sends.failed >= ERROR_ALERT.minFailed && sends.failed / Math.max(sends.sent, 1) >= ERROR_ALERT.failedRatio)
    out.push(`Meta: ${sends.failed} de ${sends.sent} respostas pelo WhatsApp e pelo Instagram foram recusadas pelo canal (${pct(sends.failed, sends.sent)}).`);
  return out;
}

/** O alerta diário de erro alto (últimas 24 horas). */
export async function checkErrorRates(db: SupabaseClient, now = Date.now()): Promise<{ alerts: string[] }> {
  const since = new Date(now - 86_400_000).toISOString();
  const [inbound, sends] = await Promise.all([inboundErrorStats(db, since), sendFailureStats(db, since)]);
  const alerts = errorAlerts(inbound, sends);
  if (alerts.length)
    await notifyPlatform("Erro alto nas últimas 24 horas", [...alerts, "Veja o Sentry, os logs da Vercel e a lista de envios que falharam em cada chatbot (o motivo da Meta vem lá)."]).catch(() => false);
  return { alerts };
}
