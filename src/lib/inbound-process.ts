import type { SupabaseClient } from "@supabase/supabase-js";
import { PAYMENT_ISSUE_CODE } from "./whatsapp";
import { handleEcho, handleInboundBurst, type ChannelRow, type EchoMessage, type InboundMessage, type QueuedMessage } from "./whatsapp-inbound";
import { recordUsage, type MessageStatus } from "./whatsapp-usage";
import { ACCESS_LOST_EVENTS, TOKEN_REJECTED, isAccessError, isPaymentError, markDisconnected, markPaymentIssue } from "./whatsapp-access";
import { handleInstagramBurst, handleInstagramEcho, type IgChannelRow, type IgMessagingEvent } from "./instagram-inbound";
import { isInstagramAccessError } from "./instagram";
import { IG_TOKEN_REJECTED, markInstagramDisconnected } from "./instagram-channel";
import { processGroup, sweepInbound, type Group, type GroupHandler, type InboundEvent } from "./inbound-queue";

/* ------------------------------------------------------------------ o que vai na fila */

export type WaStatus = MessageStatus & { recipient_id?: string; errors?: Array<{ code?: number; title?: string }> };

export type WaPayload =
  | { type: "msg"; phoneNumberId: string; msg: InboundMessage; profileName: string | null }
  | { type: "echo"; phoneNumberId: string; echo: EchoMessage }
  | { type: "status"; phoneNumberId: string; status: WaStatus }
  | { type: "account_update"; entryId?: string; event?: string; wabaId?: string };

export type IgPayload = { type: "msg" | "echo"; igUserId: string; ev: IgMessagingEvent };

/* ------------------------------------------------------------------ WhatsApp */

/** Número ligado e com acesso, ou null (sem chatbot, ou desconectado: não dá nem para responder). */
async function activeWaChannel(db: SupabaseClient, phoneNumberId: string) {
  const { data: channel } = await db.from("whatsapp_channels").select("bot_id, phone_number_id, access_token_enc, disconnected_at").eq("phone_number_id", phoneNumberId).maybeSingle<ChannelRow & { disconnected_at: string | null }>();
  if (!channel) console.warn("whatsapp: número sem chatbot ligado", phoneNumberId);
  return channel && !channel.disconnected_at ? channel : null;
}

const whatsappGroup: GroupHandler = async (db, events) => {
  const all = events as InboundEvent<WaPayload>[];
  for (const e of all) {
    const p = e.payload;
    if (p?.type === "account_update") {
      // a conta do cliente deixou de ser nossa: desliga os números dela e avisa a agência
      const reason = ACCESS_LOST_EVENTS[p.event ?? ""];
      if (!reason) continue;
      for (const wabaId of new Set([p.wabaId, p.entryId].filter(Boolean) as string[])) await markDisconnected(db, { column: "waba_id", value: wabaId }, reason);
    } else if (p?.type === "status") {
      if (p.status.status === "failed") {
        console.warn("whatsapp: mensagem não entregue", p.phoneNumberId, p.status.errors?.[0]);
        // a recusa por pagamento às vezes só chega aqui, no status da mensagem
        if (p.status.errors?.some((err) => err.code === PAYMENT_ISSUE_CODE)) await markPaymentIssue(db, { column: "phone_number_id", value: p.phoneNumberId });
      }
      // consumo: cada status de mensagem enviada diz se a Meta cobrou e em qual categoria
      if (e.bot_id) await recordUsage(db, e.bot_id, p.phoneNumberId, [p.status]);
    }
  }

  const contact = all.filter((e) => e.payload?.type === "msg" || e.payload?.type === "echo");
  if (!contact.length) return;
  const phoneNumberId = (contact[0].payload as { phoneNumberId: string }).phoneNumberId;
  const channel = await activeWaChannel(db, phoneNumberId);
  if (!channel) return;
  try {
    for (const e of contact) if (e.payload.type === "echo") await handleEcho(db, channel, e.payload.echo, e.key_hash);
    const burst: QueuedMessage[] = contact.flatMap((e) => (e.payload.type === "msg" ? [{ key: e.key_hash, msg: e.payload.msg, profileName: e.payload.profileName, receivedAt: e.created_at }] : []));
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
