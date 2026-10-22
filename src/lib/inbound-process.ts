import type { SupabaseClient } from "@supabase/supabase-js";
import { applyContactReaction, linkInbound, reactionEmoji } from "./message-links";
import { IDENTITY_MISMATCH_CODE } from "./whatsapp";
import { PRIMARY_INACTIVITY_TEXT, queueTemplateEvent } from "./platform-events";
import { expectInbound, igInboundExtra, queueStatusEvent, releaseInbound, waInboundExtra } from "./message-events";
import { API_SEND_REF, reconcileUncertain } from "./messages";
import { channelMsgHash } from "./hash";
import { PAYMENT_ISSUE_CODE } from "./whatsapp";
import { handleEcho, handleInboundBurst, type ChannelRow, type EchoMessage, type InboundMessage, type QueuedMessage } from "./whatsapp-inbound";
import { recordUsage, type MessageStatus } from "./whatsapp-usage";
import { ACCESS_LOST_EVENTS, TOKEN_REJECTED, isAccessError, isPaymentError, markDisconnected, markPaymentIssue, markReconnected } from "./whatsapp-access";
import { handleInstagramBurst, handleInstagramEcho, type IgChannelRow, type IgMessagingEvent } from "./instagram-inbound";
import { isInstagramAccessError } from "./instagram";
import { handleInstagramDelete, handleInstagramEdit } from "./instagram-edits";
import { handleInstagramComment, type IgComment } from "./instagram-comments";
import { IG_TOKEN_REJECTED, markInstagramDisconnected } from "./instagram-channel";
import { captureInstagramMedia, captureWhatsAppMedia } from "./media-capture";
import { processGroup, sweepInbound, type Group, type GroupHandler, type InboundEvent } from "./inbound-queue";
import { revoke, suppress, suppressionScope } from "./suppression";
import { recordMetaEnforcement, type MetaAccountDetail } from "./meta-enforcement";
import { disconnectionDetail } from "./whatsapp-diagnostics";
import { revokeConsents } from "./marketing-consent";
import { botsOfWaba, handleCampaignNotice, markCampaignContact, reconcileCampaignStatus } from "./campaigns";

/* ------------------------------------------------------------------ o que vai na fila */

export type WaStatus = MessageStatus & { recipient_id?: string; errors?: Array<{ code?: number; title?: string }>; biz_opaque_callback_data?: string };
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
  | { type: "account_update"; entryId?: string; event?: string; wabaId?: string; detail?: MetaAccountDetail }
  // avisos da conta que mexem com campanhas: qualidade do número, situação e categoria do modelo
  | { type: "notice"; wabaId?: string; field: string; value: Record<string, unknown> };

export type IgPayload = { type: "msg" | "echo" | "edit" | "delete" | "reaction"; igUserId: string; ev: IgMessagingEvent } | { type: "comment"; igUserId: string; comment: IgComment };

/* ------------------------------------------------------------------ WhatsApp */

/** Número ligado e com acesso, ou null (sem chatbot, ou desconectado: não dá nem para responder). */
async function activeWaChannel(db: SupabaseClient, phoneNumberId: string) {
  const { data: channel } = await db.from("whatsapp_channels").select("bot_id, phone_number_id, waba_id, access_token_enc, coexistence, disconnected_at, payment_issue_at, identity_check_at").eq("phone_number_id", phoneNumberId).maybeSingle<ChannelRow & { disconnected_at: string | null }>();
  if (!channel) console.warn("whatsapp: número sem chatbot ligado", phoneNumberId);
  return channel && !channel.disconnected_at ? channel : null;
}

/**
 * Erro 137000 (o hash de identidade mandado no envio não bate): os vínculos do contato caem e,
 * dentro da janela de 24 horas, ele recebe uma vez o pedido de conectar de novo (sem o hash: é para
 * quem está com o número agora, e o texto não leva dado da conta).
 */
async function identityMismatch(db: SupabaseClient, phoneNumberId: string, msgHash: string): Promise<void> {
  const { IDENTITY_CHANGED_TEXT, handleIdentityMismatch } = await import("./pairing");
  const r = await handleIdentityMismatch(db, msgHash);
  if (!r.unlinked || !r.conversationId) return;
  const { data: conv } = await db.from("conversations").select("bot_id, wa_id, last_contact_at").eq("id", r.conversationId).maybeSingle();
  if (!conv?.wa_id || !conv.last_contact_at || Date.parse(conv.last_contact_at as string) < Date.now() - 23 * 3_600_000) return;
  const channel = await activeWaChannel(db, phoneNumberId);
  if (!channel) return;
  const { deliver } = await import("./send");
  const { sendText } = await import("./whatsapp");
  const { SYSTEM_AUTHOR } = await import("./chat");
  await deliver(db, {
    botId: conv.bot_id as string,
    channel: "whatsapp",
    conversationId: r.conversationId,
    kind: "sistema",
    record: { insert: { role: "assistant", content: IDENTITY_CHANGED_TEXT, author: SYSTEM_AUTHOR } },
    transport: async () => (await sendText(channel, conv.wa_id as string, IDENTITY_CHANGED_TEXT)).messages?.[0]?.id ?? null,
  });
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
      // a conta voltou (a inatividade da coexistência acabou): o número volta ao normal sozinho
      if (p.event === "ACCOUNT_RECONNECTED") {
        for (const wabaId of wabaIds) await markReconnected(db, wabaId);
        continue;
      }
      const lost = ACCESS_LOST_EVENTS[p.event ?? ""];
      if (!lost) continue;
      // PARTNER_REMOVED traz o motivo e quem iniciou: aparece no Diagnóstico do número; na
      // inatividade da coexistência, o texto diz o que fazer (abrir o app do celular e conectar de novo)
      const metaReason = p.detail?.disconnection_info?.reason?.toUpperCase() ?? null;
      const extra = disconnectionDetail(p.detail?.disconnection_info);
      const reason = metaReason === "PRIMARY_INACTIVITY" ? PRIMARY_INACTIVITY_TEXT : extra ? `${lost} (${extra})` : lost;
      // webhooks: o código é o motivo da Meta quando vem (ex.: PRIMARY_INACTIVITY), senão o evento
      for (const wabaId of wabaIds) await markDisconnected(db, { column: "waba_id", value: wabaId }, reason, metaReason ?? p.event ?? "access_lost", { keepToken: metaReason === "PRIMARY_INACTIVITY" });
    } else if (p?.type === "status") {
      if (p.status.status === "failed") {
        console.warn("whatsapp: mensagem não entregue", p.phoneNumberId, p.status.errors?.[0]);
        // a recusa por pagamento às vezes só chega aqui, no status da mensagem
        if (p.status.errors?.some((err) => err.code === PAYMENT_ISSUE_CODE)) await markPaymentIssue(db, { column: "phone_number_id", value: p.phoneNumberId });
      }
      // o hash de identidade não bate mais (número reciclado ou aparelho novo): o vínculo cai
      if (p.status.id && p.status.errors?.some((err) => err.code === IDENTITY_MISMATCH_CODE)) {
        await identityMismatch(db, p.phoneNumberId, channelMsgHash("whatsapp", p.status.id)).catch((err) => console.error("whatsapp: 137000", (err as Error).message));
      }
      // o contato bloqueou o marketing: entra na supressão de marketing (como um SAIR)
      if (e.bot_id && p.status.recipient_id && p.status.errors?.some((err) => err.code === MARKETING_STOPPED_CODE)) {
        await suppress(db, { channel: "whatsapp", scope: suppressionScope({ wabaId: p.wabaId, botId: e.bot_id }), contact: p.status.recipient_id, kind: "marketing", reason: "meta_131050", source: "meta" });
        await revokeConsents(db, { scope: suppressionScope({ wabaId: p.wabaId, botId: e.bot_id }), contact: p.status.recipient_id }, "meta:131050");
      }
      const ref = p.status.biz_opaque_callback_data;
      // envio incerto pela API ("am:<ref>"): a mensagem gravada sem o id da Meta ganha o id de verdade
      if (ref?.startsWith(API_SEND_REF) && p.status.id) await reconcileUncertain(db, channelMsgHash("whatsapp", ref), channelMsgHash("whatsapp", p.status.id));
      // webhooks: message.status (entregue, lida) e message.failed, só quando o status avança
      if (p.status.id && p.status.status) await queueStatusEvent(db, channelMsgHash("whatsapp", p.status.id), p.status.status, { errorCode: p.status.errors?.[0]?.code ?? null, at: p.status.timestamp ? new Date(Number(p.status.timestamp) * 1000).toISOString() : null });
      // envio de campanha ("cs:<id>"): o status concilia a linha (enviado, entregue, lido ou falhou)
      if (ref?.startsWith("cs:") && p.status.status) await reconcileCampaignStatus(db, ref, p.status.status, p.status.errors?.[0]?.code, p.status.pricing?.category);
      // consumo: cada status de mensagem enviada diz se a Meta cobrou e em qual categoria
      if (e.bot_id) await recordUsage(db, e.bot_id, p.phoneNumberId, [p.status]);
    } else if (p?.type === "notice" && p.wabaId) {
      await handleCampaignNotice(db, p.wabaId, p.field, p.value);
      // webhooks: template.status_changed (aprovado, recusado, pausado…)
      if (p.field === "message_template_status_update") await queueTemplateEvent(db, p.wabaId, p.value);
    } else if (p?.type === "prefs" && (p.wabaId || e.bot_id)) {
      // preferências do WhatsApp: "stop" suprime o marketing; "resume" é novo opt-in da própria pessoa
      for (const pref of p.prefs) {
        if (!pref.wa_id || !String(pref.category ?? "").startsWith("marketing")) continue;
        const target = { channel: "whatsapp" as const, scope: suppressionScope({ wabaId: p.wabaId, botId: e.bot_id ?? "" }), contact: pref.wa_id };
        if (pref.value === "stop") {
          await suppress(db, { ...target, kind: "marketing", reason: "user_preferences", source: "meta" });
          // o "resume" não devolve o sim de novidades (só um novo sim da pessoa)
          await revokeConsents(db, { scope: target.scope, contact: target.contact }, "meta:user_preferences");
          // descadastro pelo próprio WhatsApp depois de uma campanha: conta no relatório dela
          const bots = p.wabaId ? await botsOfWaba(db, p.wabaId) : e.bot_id ? [e.bot_id] : [];
          await markCampaignContact(db, bots, pref.wa_id, "opt_out", "whatsapp");
        }
        else if (pref.value === "resume") await revoke(db, { ...target, kind: "marketing", source: "meta:resume" });
      }
    }
  }

  const contact = all.filter((e) => e.payload?.type === "msg" || e.payload?.type === "echo");
  if (!contact.length) return;
  const phoneNumberId = (contact[0].payload as { phoneNumberId: string }).phoneNumberId;
  const channel = await activeWaChannel(db, phoneNumberId);
  if (!channel) return;
  const burst: QueuedMessage[] = contact.flatMap((e) => (e.payload.type === "msg" ? [{ key: e.key_hash, msg: e.payload.msg, profileName: e.payload.profileName, identityKeyHash: e.payload.identityKeyHash ?? null, receivedAt: e.created_at }] : []));
  // webhooks: o clique e o arquivo de cada mensagem (message.received com arquivo sai depois da captura)
  const keys = expectInbound(burst.map((q) => ({ key: q.key, ...waInboundExtra(q.msg as unknown as Parameters<typeof waInboundExtra>[0]) })));
  // resposta a status do WhatsApp (teste de 12/10/2026): só os nomes dos campos do context, sem valores
  for (const q of burst) {
    const context = (q.msg as { context?: Record<string, unknown> }).context;
    if (context) console.log("whatsapp: mensagem com contexto", q.msg.type, contextShape(context));
  }
  try {
    for (const e of contact) if (e.payload.type === "echo") await handleEcho(db, channel, e.payload.echo, e.key_hash);
    // reação do contato (sem resposta da IA): o emoji fica na mensagem reagida
    for (const q of burst) if (q.msg.type === "reaction" && q.msg.reaction?.message_id) await applyContactReaction(db, "whatsapp", q.msg.reaction.message_id, q.msg.reaction.emoji?.trim() || null);
    await handleInboundBurst(db, channel, burst);
    // a citação e o id original de cada mensagem gravada (a equipe cita e reage pelo painel)
    await linkInbound(db, "whatsapp", burst.filter((q) => q.msg.type !== "reaction").map((q) => ({ key: q.key, channelId: q.msg.id, quotedId: q.msg.context?.id ?? null }))).catch((e) => console.error("whatsapp: citação", (e as Error).message));
    // mídia recebida: guardada cifrada depois da resposta (falha aqui não refaz a conversa)
    await captureWhatsAppMedia(db, channel, burst).catch((e) => console.error("whatsapp: mídia", (e as Error).message));
  } catch (err) {
    // sem acesso ou sem pagamento: marca o número e conclui (tentar de novo não adianta)
    if (isAccessError(err)) return void (await markDisconnected(db, { column: "phone_number_id", value: phoneNumberId }, TOKEN_REJECTED));
    if (isPaymentError(err)) return void (await markPaymentIssue(db, { column: "phone_number_id", value: phoneNumberId }));
    throw err;
  } finally {
    await releaseInbound(db, keys);
  }
};

/* ------------------------------------------------------------------ Instagram */

const instagramGroup: GroupHandler = async (db, events) => {
  const all = events as InboundEvent<IgPayload>[];
  if (!all.length || !all[0].payload) return;
  const igUserId = all[0].payload.igUserId;
  const { data: ch } = await db.from("instagram_channels").select("bot_id, ig_user_id, access_token_enc, disconnected_at").eq("ig_user_id", igUserId).maybeSingle<IgChannelRow & { disconnected_at: string | null }>();
  if (!ch || ch.disconnected_at) return console.log("instagram: conta sem chatbot ou desconectada, evento ignorado", igUserId);
  const igBurst = all.flatMap((e) => (e.payload.type === "msg" ? [{ key: e.key_hash, ev: e.payload.ev, receivedAt: e.created_at }] : []));
  // webhooks: o clique e o arquivo de cada mensagem (message.received com arquivo sai depois da captura)
  const keys = expectInbound(igBurst.map((q) => ({ key: q.key, ...igInboundExtra(q.ev) })));
  try {
    for (const e of all) if (e.payload.type === "echo") await handleInstagramEcho(db, ch, e.payload.ev, e.key_hash);
    // reação do contato (sem resposta da IA): o emoji fica na mensagem reagida
    for (const e of all) if (e.payload.type === "reaction" && e.payload.ev.reaction?.mid) await applyContactReaction(db, "instagram", e.payload.ev.reaction.mid, e.payload.ev.reaction.action === "unreact" ? null : reactionEmoji(e.payload.ev.reaction));
    await handleInstagramBurst(db, ch, igBurst);
    // a citação e o id original de cada DM gravada (a equipe cita e reage pelo painel)
    await linkInbound(db, "instagram", igBurst.map((q) => ({ key: q.key, channelId: q.ev.message?.mid ?? null, quotedId: q.ev.message?.reply_to?.mid ?? null }))).catch((e) => console.error("instagram: citação", (e as Error).message));
    // mídia recebida: guardada cifrada depois da resposta (o link do CDN da Meta vence)
    await captureInstagramMedia(db, ch.bot_id, igBurst).catch((e) => console.error("instagram: mídia", (e as Error).message));
    // edição e mensagem desfeita depois das mensagens (a original já está gravada)
    for (const e of all) {
      if (e.payload.type === "edit") await handleInstagramEdit(db, e.payload.ev);
      else if (e.payload.type === "delete") console.log("instagram: mensagem desfeita pelo contato", await handleInstagramDelete(db, e.payload.ev));
    }
    // comentários dos posts (E1, parte 4), depois das mensagens (a resposta do direct não espera)
    for (const e of all) if (e.payload.type === "comment") await handleInstagramComment(db, ch, e.payload.comment);
  } catch (err) {
    if (isInstagramAccessError(err)) return void (await markInstagramDisconnected(db, { column: "ig_user_id", value: igUserId }, IG_TOKEN_REJECTED));
    throw err;
  } finally {
    await releaseInbound(db, keys);
  }
};

export const inboundHandlers = { whatsapp: whatsappGroup, instagram: instagramGroup };

/** Os nomes dos campos (e dos campos de dentro), nunca os valores: "from,id,referred_product{...}". Pura. */
export function contextShape(o: Record<string, unknown>): string {
  return Object.keys(o)
    .sort()
    .map((k) => {
      const v = o[k];
      return v && typeof v === "object" && !Array.isArray(v) ? `${k}{${Object.keys(v as object).sort().join(",")}}` : k;
    })
    .join(",");
}

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
