import type { SupabaseClient } from "@supabase/supabase-js";
import { PAYMENT_ISSUE_CODE } from "./whatsapp";
import { handleEcho, handleInboundBurst, type ChannelRow, type EchoMessage, type InboundMessage, type QueuedMessage } from "./whatsapp-inbound";
import { recordUsage, type MessageStatus } from "./whatsapp-usage";
import { ACCESS_LOST_EVENTS, TOKEN_REJECTED, isAccessError, isPaymentError, markDisconnected, markPaymentIssue } from "./whatsapp-access";
import { handleInstagramBurst, handleInstagramEcho, type IgChannelRow, type IgMessagingEvent } from "./instagram-inbound";
import { isInstagramAccessError } from "./instagram";
import { handleInstagramDelete, handleInstagramEdit } from "./instagram-edits";
import { IG_TOKEN_REJECTED, markInstagramDisconnected } from "./instagram-channel";
import { processGroup, sweepInbound, type Group, type GroupHandler, type InboundEvent } from "./inbound-queue";
import { revoke, suppress, suppressionScope } from "./suppression";
import { recordMetaEnforcement, type MetaAccountDetail } from "./meta-enforcement";
import { disconnectionDetail } from "./whatsapp-diagnostics";

/* ------------------------------------------------------------------ o que vai na fila */

export type WaStatus = MessageStatus & { recipient_id?: string; errors?: Array<{ code?: number; title?: string }> };
/** webhook user_preferences: a pessoa parou (ou voltou a aceitar) as mensagens de marketing. */
export interface WaPreference {
  wa_id?: string;
  category?: string;
  value?: string;
}

/** Erro da Meta: o contato bloqueou as mensagens de marketing deste negócio. */
export const MARKETING_STOPPED_CODE = 131050;

export type WaPayload =
  | { type: "msg"; phoneNumberId: string; msg: InboundMessage; profileName: string | null; identityKeyHash?: string | null }
  | { type: "echo"; phoneNumberId: string; echo: EchoMessage }
  | { type: "status"; phoneNumberId: string; status: WaStatus; wabaId?: string }
  | { type: "prefs"; phoneNumberId?: string; wabaId?: string; prefs: WaPreference[] }
  | { type: "account_update"; entryId?: string; event?: string; wabaId?: string; detail?: MetaAccountDetail };

export type IgPayload = { type: "msg" | "echo" | "edit" | "delete"; igUserId: string; ev: IgMessagingEvent };

/* ------------------------------------------------------------------ WhatsApp */

/** Número ligado e com acesso, ou null (sem chatbot, ou desconectado: não dá nem para responder). */
async function activeWaChannel(db: SupabaseClient, phoneNumberId: string) {
  const { data: channel } = await db.from("whatsapp_channels").select("bot_id, phone_number_id, waba_id, access_token_enc, coexistence, disconnected_at, payment_issue_at, identity_check_at").eq("phone_number_id", phoneNumberId).maybeSingle<ChannelRow & { disconnected_at: string | null }>();
  if (!channel) console.warn("whatsapp: número sem chatbot ligado", phoneNumberId);
  return channel && !channel.disconnected_at ? channel : null;
}

const whatsappGroup: GroupHandler = async (db, events) => {
  const all = events as InboundEvent<WaPayload>[];
  for (const e of all) {
    const p = e.payload;
    if (p?.type === "account_update") {
      const wabaIds = [...new Set([p.wabaId, p.entryId].filter(Boolean) as string[])];
      // ordem, infração ou restrição da Meta: vira medida (a ordem bloqueia o número; o resto fica registrado)
      for (const wabaId of wabaIds) await recordMetaEnforcement(db, { event: p.event ?? "", wabaId, detail: p.detail ?? {} });
      // a conta do cliente deixou de ser nossa: desliga os números dela e avisa a agência
      const lost = ACCESS_LOST_EVENTS[p.event ?? ""];
      if (!lost) continue;
      // PARTNER_REMOVED traz o motivo e quem iniciou: aparece no Diagnóstico do número
      const extra = disconnectionDetail(p.detail?.disconnection_info);
      const reason = extra ? `${lost} (${extra})` : lost;
      for (const wabaId of wabaIds) await markDisconnected(db, { column: "waba_id", value: wabaId }, reason);
    } else if (p?.type === "status") {
      if (p.status.status === "failed") {
        console.warn("whatsapp: mensagem não entregue", p.phoneNumberId, p.status.errors?.[0]);
        // a recusa por pagamento às vezes só chega aqui, no status da mensagem
        if (p.status.errors?.some((err) => err.code === PAYMENT_ISSUE_CODE)) await markPaymentIssue(db, { column: "phone_number_id", value: p.phoneNumberId });
      }
      // o contato bloqueou o marketing: entra na supressão de marketing (como um SAIR)
      if (e.bot_id && p.status.recipient_id && p.status.errors?.some((err) => err.code === MARKETING_STOPPED_CODE)) {
        await suppress(db, { channel: "whatsapp", scope: suppressionScope({ wabaId: p.wabaId, botId: e.bot_id }), contact: p.status.recipient_id, kind: "marketing", reason: "meta_131050", source: "meta" });
      }
      // consumo: cada status de mensagem enviada diz se a Meta cobrou e em qual categoria
      if (e.bot_id) await recordUsage(db, e.bot_id, p.phoneNumberId, [p.status]);
    } else if (p?.type === "prefs" && (p.wabaId || e.bot_id)) {
      // preferências do WhatsApp: "stop" suprime o marketing; "resume" é novo opt-in da própria pessoa
      for (const pref of p.prefs) {
        if (!pref.wa_id || !String(pref.category ?? "").startsWith("marketing")) continue;
        const target = { channel: "whatsapp" as const, scope: suppressionScope({ wabaId: p.wabaId, botId: e.bot_id ?? "" }), contact: pref.wa_id };
        if (pref.value === "stop") await suppress(db, { ...target, kind: "marketing", reason: "user_preferences", source: "meta" });
        else if (pref.value === "resume") await revoke(db, { ...target, kind: "marketing", source: "meta:resume" });
      }
    }
  }

  const contact = all.filter((e) => e.payload?.type === "msg" || e.payload?.type === "echo");
  if (!contact.length) return;
  const phoneNumberId = (contact[0].payload as { phoneNumberId: string }).phoneNumberId;
  const channel = await activeWaChannel(db, phoneNumberId);
  if (!channel) return;
  try {
    for (const e of contact) if (e.payload.type === "echo") await handleEcho(db, channel, e.payload.echo, e.key_hash);
    const burst: QueuedMessage[] = contact.flatMap((e) => (e.payload.type === "msg" ? [{ key: e.key_hash, msg: e.payload.msg, profileName: e.payload.profileName, identityKeyHash: e.payload.identityKeyHash ?? null, receivedAt: e.created_at }] : []));
    await handleInboundBurst(db, channel, burst);
  } catch (err) {
    // sem acesso ou sem pagamento: marca o número e conclui (tentar de novo não adianta)
    if (isAccessError(err)) return void (await markDisconnected(db, { column: "phone_number_id", value: phoneNumberId }, TOKEN_REJECTED));
    if (isPaymentError(err)) return void (await markPaymentIssue(db, { column: "phone_number_id", value: phoneNumberId }));
    throw err;
  }
};

/* ------------------------------------------------------------------ Instagram */

const instagramGroup: GroupHandler = async (db, events) => {
  const all = events as InboundEvent<IgPayload>[];
  if (!all.length || !all[0].payload) return;
  const igUserId = all[0].payload.igUserId;
  const { data: ch } = await db.from("instagram_channels").select("bot_id, ig_user_id, access_token_enc, disconnected_at").eq("ig_user_id", igUserId).maybeSingle<IgChannelRow & { disconnected_at: string | null }>();
  if (!ch || ch.disconnected_at) return console.log("instagram: conta sem chatbot ou desconectada, evento ignorado", igUserId);
  try {
    for (const e of all) if (e.payload.type === "echo") await handleInstagramEcho(db, ch, e.payload.ev, e.key_hash);
    await handleInstagramBurst(db, ch, all.flatMap((e) => (e.payload.type === "msg" ? [{ key: e.key_hash, ev: e.payload.ev, receivedAt: e.created_at }] : [])));
    // edição e mensagem desfeita depois das mensagens (a original já está gravada)
    for (const e of all) {
      if (e.payload.type === "edit") await handleInstagramEdit(db, e.payload.ev);
      else if (e.payload.type === "delete") console.log("instagram: mensagem desfeita pelo contato", await handleInstagramDelete(db, e.payload.ev));
    }
  } catch (err) {
    if (isInstagramAccessError(err)) return void (await markInstagramDisconnected(db, { column: "ig_user_id", value: igUserId }, IG_TOKEN_REJECTED));
    throw err;
  }
};

export const inboundHandlers = { whatsapp: whatsappGroup, instagram: instagramGroup };

/**
 * Depois de o webhook responder: trata os contatos que acabaram de chegar (até 8 em paralelo)
 * e varre o que ficou para trás (no Vercel Hobby não há cron por minuto; cada webhook ajuda).
 */
export async function processAfterWebhook(db: SupabaseClient, groups: Group[], hasTime: () => boolean) {
  const unique = [...new Map(groups.map((g) => [`${g.source}:${g.bot_id}:${g.contact_hash}`, g])).values()];
  for (let i = 0; i < unique.length && hasTime(); i += 8) {
    await Promise.all(unique.slice(i, i + 8).map((g) => processGroup(db, g, inboundHandlers[g.source]).catch((e) => console.error("fila: grupo falhou", e))));
  }
  if (hasTime()) await sweepInbound(db, inboundHandlers, hasTime).catch((e) => console.error("fila: varredura falhou", e));
}
