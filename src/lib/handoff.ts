import type { SupabaseClient } from "@supabase/supabase-js";
import { API_PAUSE_CLEAR } from "./api-pause";
import { queueHandoffReturned } from "./message-events";
import { fail, ok, type ActionResult } from "./action-result";
import { OUTSIDE_WINDOW_CODE, WhatsAppError, sendText } from "./whatsapp";
import { TOKEN_REJECTED, isAccessError, isPaymentError, markDisconnected, markPaymentIssue } from "./whatsapp-access";
import { isInstagramAccessError, isOutsideWindow } from "./instagram";
import { IG_TOKEN_REJECTED, markInstagramDisconnected } from "./instagram-channel";
import { send as sendInstagram } from "./instagram-inbound";
import { sendBlockedReason } from "./conversation-mode";
import { deliver, type SendRecord } from "./send";
import { saveMessage, touchConversation } from "./messages";
import { attendantAuthor, type Attendant } from "./authors";
import { humanAgentEnabled } from "./presence";
import { renderEntryNotice, type HumanHandoff } from "./handoff-hours";

/**
 * Atendimento humano: as mesmas operações para a agência (painel) e para o cliente final
 * (área do cliente). Quem chama já conferiu a permissão e passa a service role.
 *
 * Um atendente por conversa (leva B1'): "Assumir" é um UPDATE condicional (vence quem gravar
 * primeiro); quem perde vê quem já está atendendo. Só quem está com a conversa responde e
 * devolve para a IA; os outros usam "Assumir no lugar". O anúncio de entrada vira o prefixo da
 * primeira mensagem de quem assumiu (assumir não manda nada ao contato).
 */

export interface Holder {
  takeover_at: string | null;
  handled_at: string | null;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
}

const activeHold = (c: Holder) => Boolean(c.takeover_at) && !c.handled_at;
/** Esta pessoa está com a conversa agora. Pura. */
export const holdsConversation = (c: Holder, whoId: string) => activeHold(c) && c.assigned_to_id === whoId;
/** Outra pessoa está com a conversa agora (atendimento antigo, sem dono, fica livre). Pura. */
export const heldByOther = (c: Holder, whoId: string) => activeHold(c) && Boolean(c.assigned_to_id) && c.assigned_to_id !== whoId;

const HOLDER_COLS = "takeover_at, handled_at, assigned_to_id, assigned_to_name";
const otherName = (c: Holder) => c.assigned_to_name?.trim() || "Outra pessoa da equipe";

export type TakeOverResult = ActionResult & { previous?: string | null };

/** Clicou "Assumir" e já estava com a conversa: nada muda (nem auditoria). */
export const ALREADY_YOURS = "Você já está atendendo esta conversa.";

/**
 * Assume a conversa. Sem `force`, só vence se ninguém estiver atendendo (ou o atendimento
 * anterior foi encerrado, ou é um atendimento antigo sem dono). Com `force` ("Assumir no
 * lugar"), troca quem estava; `previous` diz quem era, para a auditoria.
 */
export async function takeOver(admin: SupabaseClient, conversationId: string, who: Attendant, opts: { force?: boolean } = {}): Promise<TakeOverResult> {
  const { data: before } = await admin.from("conversations").select(HOLDER_COLS).eq("id", conversationId).maybeSingle<Holder>();
  if (!before) return fail("Conversa não encontrada.");
  if (holdsConversation(before, who.id)) return ok(ALREADY_YOURS);
  const now = new Date().toISOString();
  let q = admin
    .from("conversations")
    // quem assume fica com a conversa: a pausa da integração (API) acaba junto
    .update({ takeover_at: now, handled_at: null, needs_human: true, assigned_to_type: who.type, assigned_to_id: who.id, assigned_to_name: who.name, assigned_at: now, announce_pending: true, ...API_PAUSE_CLEAR })
    .eq("id", conversationId);
  if (!opts.force) q = q.or("takeover_at.is.null,handled_at.not.is.null,assigned_to_id.is.null");
  const { data, error } = await q.select("id");
  if (error) return fail("Não foi possível assumir a conversa. Tente de novo.");
  if (!data?.length) {
    const { data: current } = await admin.from("conversations").select(HOLDER_COLS).eq("id", conversationId).maybeSingle<Holder>();
    if (current && holdsConversation(current, who.id)) return ok(ALREADY_YOURS);
    return fail(`${current ? otherName(current) : "Outra pessoa da equipe"} já está atendendo esta conversa.`);
  }
  const previous = heldByOther(before, who.id) ? otherName(before) : null;
  return { ...ok(previous ? `Você assumiu no lugar de ${previous}. A próxima mensagem sai com o anúncio com o seu nome.` : "Você assumiu a conversa. O assistente pausou até você devolver."), previous };
}

export async function postAgentMessage(admin: SupabaseClient, conversationId: string, rawContent: string, who: Attendant): Promise<ActionResult> {
  const content = rawContent.trim();
  if (!content) return fail("Escreva uma mensagem.");
  if (content.length > 2000) return fail("Mensagem muito longa (até 2.000 caracteres).");
  const { data: conv } = await admin.from("conversations").select(`${HOLDER_COLS}, bots(client_name, human_handoff)`).eq("id", conversationId).maybeSingle();
  if (!conv) return fail("Conversa não encontrada.");
  // só quem está com a conversa responde
  if (heldByOther(conv as Holder, who.id)) return fail(`${otherName(conv as Holder)} está atendendo esta conversa. Para responder, use “Assumir no lugar”.`);
  // responder já assume a conversa (o assistente não fala por cima)
  if (!holdsConversation(conv as Holder, who.id)) {
    const t = await takeOver(admin, conversationId, who);
    if (!t.ok) return t;
  }
  // anúncio de entrada: só na primeira mensagem de quem assumiu (a marca sai antes do envio, para
  // duas mensagens seguidas não saírem as duas com o anúncio; volta se o envio falhar)
  const { data: claimed } = await admin.from("conversations").update({ announce_pending: false }).eq("id", conversationId).eq("announce_pending", true).eq("assigned_to_id", who.id).select("id");
  const bot = (Array.isArray(conv.bots) ? conv.bots[0] : conv.bots) as { client_name: string; human_handoff: HumanHandoff | null } | null;
  const announce = claimed?.length ? renderEntryNotice(bot?.human_handoff?.entry_notice, { attendant: who.name, company: bot?.client_name ?? "" }) : null;
  const text = announce ? `${announce}\n\n${content}` : content;
  const record = { role: "agent" as const, content: text, ...attendantAuthor(who), announce_chars: announce ? announce.length + 2 : null };
  const restoreAnnounce = async () => {
    if (announce) await admin.from("conversations").update({ announce_pending: true }).eq("id", conversationId).eq("assigned_to_id", who.id);
  };
  const sent = await deliverOutside(admin, conversationId, text, { insert: record });
  if (sent !== "widget" && sent !== "gravada") {
    await restoreAnnounce();
    return sent;
  }
  // no WhatsApp e no Instagram a camada de envio já gravou (com o hash do id da Meta); no site, grava aqui
  if (sent === "widget") {
    try {
      await saveMessage(admin, { conversation_id: conversationId, ...record });
    } catch {
      await restoreAnnounce();
      return fail("A mensagem não foi enviada. Tente de novo.");
    }
  }
  await touchConversation(admin, conversationId);
  return ok("Enviada. O visitante vê em alguns segundos.");
}

/**
 * Conversa do WhatsApp ou do Instagram: a resposta da equipe sai pelo canal ligado ao chatbot,
 * pela camada única de envio (regra de estado na hora, e só gravada se o cliente recebeu).
 * Site: só confere a regra (canal suspenso) e quem chamou grava.
 */
async function deliverOutside(admin: SupabaseClient, conversationId: string, content: string, record: SendRecord): Promise<"widget" | "gravada" | ActionResult> {
  const { data: conv } = await admin.from("conversations").select("bot_id, channel, wa_id, ig_id").eq("id", conversationId).maybeSingle();
  const metaChannel = conv?.channel === "whatsapp" || conv?.channel === "instagram" ? (conv.channel as "whatsapp" | "instagram") : null;
  if (conv && !metaChannel) {
    // regra de estado no site: canal suspenso pela BoaVoz
    const blocked = await sendBlockedReason(admin, conv.bot_id, "widget");
    if (blocked) return fail(`${blocked} A mensagem não foi enviada.`);
  }
  if (conv?.channel === "instagram" && conv.ig_id) return deliverToInstagram(admin, conv.bot_id, conversationId, conv.ig_id, content, record);
  if (conv?.channel !== "whatsapp" || !conv.wa_id) return "widget";
  const { data: channel } = await admin.from("whatsapp_channels").select("phone_number_id, access_token_enc, disconnected_at").eq("bot_id", conv.bot_id).maybeSingle();
  if (!channel || channel.disconnected_at) return fail("O WhatsApp deste chatbot foi desconectado. A mensagem não foi enviada: conecte de novo na aba WhatsApp.");
  try {
    const r = await deliver(admin, {
      botId: conv.bot_id,
      channel: "whatsapp",
      conversationId,
      kind: "equipe",
      recordFailures: false,
      record,
      transport: async () => (await sendText(channel, conv.wa_id!, content)).messages?.[0]?.id ?? null,
    });
    if (r.status === "blocked") return fail(`${(await sendBlockedReason(admin, conv.bot_id, "whatsapp")) ?? `Envio barrado: ${r.reason}.`} A mensagem não foi enviada.`);
    return "gravada";
  } catch (e) {
    if (isAccessError(e)) {
      await markDisconnected(admin, { column: "bot_id", value: conv.bot_id }, TOKEN_REJECTED);
      return fail("O cliente removeu o acesso do Boavoz ao WhatsApp. A mensagem não foi enviada: conecte de novo na aba WhatsApp.");
    }
    if (isPaymentError(e)) {
      await markPaymentIssue(admin, { column: "bot_id", value: conv.bot_id });
      return fail("A Meta recusou a mensagem por falta de forma de pagamento. O cliente precisa cadastrar o cartão no Gerenciador do WhatsApp.");
    }
    if (e instanceof WhatsAppError && e.code === OUTSIDE_WINDOW_CODE) {
      return fail("Passaram mais de 24 horas desde a última mensagem do cliente. O WhatsApp só deixa responder dentro desse prazo.");
    }
    console.error("whatsapp: resposta do atendente falhou", e);
    return fail("O WhatsApp não aceitou a mensagem. Tente de novo em instantes.");
  }
}

async function deliverToInstagram(admin: SupabaseClient, botId: string, conversationId: string, igsid: string, content: string, record: SendRecord): Promise<"gravada" | ActionResult> {
  const { data: ch } = await admin.from("instagram_channels").select("bot_id, ig_user_id, access_token_enc, disconnected_at").eq("bot_id", botId).maybeSingle();
  if (!ch || ch.disconnected_at) return fail("O Instagram deste chatbot foi desconectado. A mensagem não foi enviada: conecte de novo na aba Instagram.");
  try {
    const r = await deliver(admin, {
      botId,
      channel: "instagram",
      conversationId,
      kind: "equipe",
      recordFailures: false,
      record,
      // passadas as 24 h: a resposta da equipe vai com a tag human_agent (até 7 dias), quando liberada
      transport: async () => {
        try {
          return await sendInstagram(admin, ch, igsid, content);
        } catch (e) {
          if (isOutsideWindow(e) && humanAgentEnabled()) return sendInstagram(admin, ch, igsid, content, undefined, { humanAgent: true });
          throw e;
        }
      },
    });
    if (r.status === "blocked") return fail(`${(await sendBlockedReason(admin, botId, "instagram")) ?? `Envio barrado: ${r.reason}.`} A mensagem não foi enviada.`);
    return "gravada";
  } catch (e) {
    if (isInstagramAccessError(e)) {
      await markInstagramDisconnected(admin, { column: "bot_id", value: botId }, IG_TOKEN_REJECTED);
      return fail("O cliente removeu o acesso ao Instagram. A mensagem não foi enviada: conecte de novo na aba Instagram.");
    }
    if (isOutsideWindow(e)) return fail(humanAgentEnabled() ? "Passaram mais de 7 dias desde a última mensagem do cliente. O Instagram só deixa a equipe responder até 7 dias depois." : "Passaram mais de 24 horas desde a última mensagem do cliente. O Instagram só deixa responder dentro desse prazo.");
    console.error("instagram: resposta do atendente falhou", e);
    return fail("O Instagram não aceitou a mensagem. Tente de novo em instantes.");
  }
}

/**
 * Devolve a conversa ao assistente (ele volta a responder, sabendo o que foi escrito, e a
 * próxima resposta dele começa com o anúncio de volta). Só quem está com a conversa devolve.
 */
export async function release(admin: SupabaseClient, conversationId: string, who: Attendant): Promise<ActionResult> {
  const { data: conv } = await admin.from("conversations").select(HOLDER_COLS).eq("id", conversationId).maybeSingle<Holder>();
  if (!conv) return fail("Conversa não encontrada.");
  if (heldByOther(conv, who.id)) return fail(`${otherName(conv)} está atendendo esta conversa: só quem atende devolve para a IA. Para encerrar, use “Assumir no lugar” antes.`);
  const at = new Date().toISOString();
  const { error } = await admin
    .from("conversations")
    .update({ takeover_at: null, handled_at: at, assigned_to_type: null, assigned_to_id: null, assigned_to_name: null, assigned_at: null, announce_pending: false })
    .eq("id", conversationId);
  if (error) return fail("Não foi possível encerrar. Tente de novo.");
  // webhooks: handoff.returned com quem devolveu
  await queueHandoffReturned(admin, conversationId, { reason: "agent_resumed", agent: { id: who.id, name: who.name, type: who.type }, at });
  return ok("Atendimento encerrado. O assistente volta a responder esta conversa.");
}
