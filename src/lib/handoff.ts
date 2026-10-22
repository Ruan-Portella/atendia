import type { SupabaseClient } from "@supabase/supabase-js";
import { linkedRecipient } from "./pairing";
import { API_PAUSE_CLEAR } from "./api-pause";
import { queueConversationAssigned, queueHandoffReturned } from "./message-events";
import { fail, ok, type ActionResult } from "./action-result";
import { OUTSIDE_WINDOW_CODE, WhatsAppError, sendReaction, sendText, type WaChannel, type WaRecipient } from "./whatsapp";
import { TOKEN_REJECTED, isAccessError, isPaymentError, markDisconnected, markPaymentIssue } from "./whatsapp-access";
import { isInstagramAccessError, isOutsideWindow, sendInstagramReaction } from "./instagram";
import { IG_TOKEN_REJECTED, markInstagramDisconnected } from "./instagram-channel";
import { send as sendInstagram, type IgChannelRow } from "./instagram-inbound";
import { sendBlockedReason } from "./conversation-mode";
import { deliver, type SendRecord } from "./send";
import { findMessage, saveMessage, touchConversation, updateMessages } from "./messages";
import { agentReactionsFor } from "./message-links";
import { effectiveSignature, isSignatureFormat, signText, startsSequence, type SignatureFormat } from "./signature";
import { learnLater } from "./learning";
import { attendantAuthor, type Attendant } from "./authors";
import { humanAgentEnabled } from "./presence";
import { renderEntryNotice, transferNotice, type HumanHandoff } from "./handoff-hours";
import { endActiveRoutine } from "./routine-engine";
import { leadWaiting } from "./handoff-status";

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
/** O rodízio do setor (ou uma transferência) entregou a conversa a outra pessoa, que ainda não assumiu (Caixa de entrada, partes 2 e 4). Pura. */
export const assignedToOther = (c: Holder, whoId: string) => !c.handled_at && !c.takeover_at && Boolean(c.assigned_to_id) && c.assigned_to_id !== whoId;

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
  const { data: before } = await admin
    .from("conversations")
    .select(`${HOLDER_COLS}, assigned_to_type, bot_id, handoff_requested_at, lead_waiting_at`)
    .eq("id", conversationId)
    .maybeSingle<Holder & { assigned_to_type: string | null; bot_id: string; handoff_requested_at: string | null; lead_waiting_at: string | null }>();
  if (!before) return fail("Conversa não encontrada.");
  if (holdsConversation(before, who.id)) return ok(ALREADY_YOURS);
  const now = new Date().toISOString();
  let q = admin
    .from("conversations")
    // quem assume fica com a conversa: a pausa da integração (API) acaba junto
    .update({ takeover_at: now, handled_at: null, needs_human: true, assigned_to_type: who.type, assigned_to_id: who.id, assigned_to_name: who.name, assigned_at: now, announce_pending: true, snoozed_until: null, snoozed_at: null, ...API_PAUSE_CLEAR })
    .eq("id", conversationId);
  // sem force: só se ninguém tem a conversa (nem pelo rodízio), ou ela já é de quem assume
  if (!opts.force) q = q.or(`handled_at.not.is.null,assigned_to_id.is.null,assigned_to_id.eq.${who.id}`);
  const { data, error } = await q.select("id");
  if (error) return fail("Não foi possível assumir a conversa. Tente de novo.");
  if (!data?.length) {
    const { data: current } = await admin.from("conversations").select(HOLDER_COLS).eq("id", conversationId).maybeSingle<Holder>();
    if (current && holdsConversation(current, who.id)) return ok(ALREADY_YOURS);
    if (current && assignedToOther(current, who.id)) return fail(`Esta conversa foi passada para ${otherName(current)}. Para atender, use “Assumir no lugar”.`);
    return fail(`${current ? otherName(current) : "Outra pessoa da equipe"} já está atendendo esta conversa.`);
  }
  // o tempo até a equipe assumir, para a Evolução: só o primeiro a assumir um pedido de atendente
  // em aberto (o pedido deixado não conta, nem trocar quem atende); a medida não segura o atendimento
  if (before.handoff_requested_at && !before.takeover_at && !before.handled_at && !leadWaiting(before)) {
    await Promise.resolve(admin.from("handoff_waits").insert({ bot_id: before.bot_id, requested_at: before.handoff_requested_at, assumed_at: now })).catch(() => undefined);
  }
  // roteiro em andamento acaba: a equipe assumiu (B2')
  await endActiveRoutine(admin, conversationId, "handoff");
  // chamado do site (parte 7c): aberto passa a em andamento
  await import("./ticket-follow").then((m) => m.markTicketInProgress(admin, conversationId)).catch(() => undefined);
  const previous = heldByOther(before, who.id) || assignedToOther(before, who.id) ? otherName(before) : null;
  // webhooks: conversation.assigned (quem estava, quando foi "Assumir no lugar")
  await queueConversationAssigned(admin, conversationId, { agent: who, by: "agent", previous: previous && before.assigned_to_id ? { type: before.assigned_to_type ?? "agency_member", id: before.assigned_to_id, name: previous } : null, at: now });
  return { ...ok(previous ? `Você assumiu no lugar de ${previous}. A próxima mensagem sai com o anúncio com o seu nome.` : "Você assumiu a conversa. O assistente pausou até você devolver."), previous };
}

export async function postAgentMessage(admin: SupabaseClient, conversationId: string, rawContent: string, who: Attendant, opts: { replyToId?: number | null } = {}): Promise<ActionResult> {
  const content = rawContent.trim();
  if (!content) return fail("Escreva uma mensagem.");
  if (content.length > 2000) return fail("Mensagem muito longa (até 2.000 caracteres).");
  const { data: conv } = await admin.from("conversations").select(`${HOLDER_COLS}, channel, transfer_from_name, bots(client_name, human_handoff), sectors(name)`).eq("id", conversationId).maybeSingle();
  if (!conv) return fail("Conversa não encontrada.");
  // só quem está com a conversa responde
  if (heldByOther(conv as Holder, who.id)) return fail(`${otherName(conv as Holder)} está atendendo esta conversa. Para responder, use “Assumir no lugar”.`);
  // citação (Conversa mais natural): a mensagem citada é desta conversa e tem o id do canal
  const replyTo = opts.replyToId ? await linkableMessage(admin, conversationId, opts.replyToId) : null;
  if (opts.replyToId && !replyTo) return fail("A mensagem citada não está mais disponível. Tire a citação e envie de novo.");
  // responder já assume a conversa (o assistente não fala por cima)
  if (!holdsConversation(conv as Holder, who.id)) {
    const t = await takeOver(admin, conversationId, who);
    if (!t.ok) return t;
  }
  // anúncio de entrada: só na primeira mensagem de quem assumiu (a marca sai antes do envio, para
  // duas mensagens seguidas não saírem as duas com o anúncio; volta se o envio falhar)
  const { data: claimed } = await admin.from("conversations").update({ announce_pending: false, transfer_from_name: null }).eq("id", conversationId).eq("announce_pending", true).eq("assigned_to_id", who.id).select("id");
  const bot = (Array.isArray(conv.bots) ? conv.bots[0] : conv.bots) as { client_name: string; human_handoff: HumanHandoff | null } | null;
  // transferida (Caixa de entrada, parte 4): o anúncio diz quem passou, no lugar do de entrada
  const passedBy = (conv.transfer_from_name as string | null)?.trim() || null;
  const sector = (Array.isArray(conv.sectors) ? conv.sectors[0] : conv.sectors) as { name: string } | null;
  const announce = !claimed?.length ? null : passedBy && passedBy !== who.name ? transferNotice(passedBy, who.name, sector?.name) : renderEntryNotice(bot?.human_handoff?.entry_notice, { attendant: who.name, company: bot?.client_name ?? "" });
  // assinatura (Caixa de entrada, parte 5): não vai junto do anúncio, que já diz o nome
  const hh = bot?.human_handoff ?? null;
  const format = effectiveSignature(hh, await memberSignature(admin, who));
  let signed = { text: content, prefixChars: 0 };
  if (!announce && format !== "nenhuma") {
    const smart = hh?.signature_smart !== false;
    const last = smart ? await findMessage(admin, { conversationId, roles: ["user", "agent", "assistant"], newestFirst: true }, ["role", "author_id"] as const) : null;
    if (!smart || startsSequence(last, who.id)) signed = signText(content, { format, name: who.name, sector: hh?.signature_sector ? sector?.name : null, channel: conv.channel as string | null });
  }
  const text = announce ? `${announce}\n\n${content}` : signed.text;
  const record = { role: "agent" as const, content: text, ...attendantAuthor(who), announce_chars: announce ? announce.length + 2 : signed.prefixChars || null, ...(replyTo ? { reply_to_id: replyTo.id } : {}) };
  const restoreAnnounce = async () => {
    if (announce) await admin.from("conversations").update({ announce_pending: true, transfer_from_name: passedBy }).eq("id", conversationId).eq("assigned_to_id", who.id);
  };
  const sent = await deliverOutside(admin, conversationId, { insert: record }, {
    noun: "mensagem",
    whatsapp: async (channel, to) => (await sendText(channel, to, text, { replyTo: replyTo?.ref })).messages?.[0]?.id ?? null,
    instagram: (ch, igsid, humanAgent) => sendInstagram(admin, ch, igsid, text, undefined, { replyTo: replyTo?.ref, ...(humanAgent ? { humanAgent: true } : {}) }),
  });
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
  // aprendizado (D', parte 6): no WhatsApp e no Instagram, a camada de envio já cuidou
  if (sent === "widget") learnLater(admin, { conversationId, text: content, author: who.name });
  // chamado do site (parte 7c): a resposta vai por e-mail e o chamado fica aguardando o cliente
  if (sent === "widget") await import("./ticket-follow").then((m) => m.afterTicketReply(admin, conversationId, content, who)).catch((e) => console.error("chamado: depois da resposta", (e as Error).message));
  return ok("Enviada. O visitante vê em alguns segundos.");
}

/** O formato de assinatura que a pessoa escolheu no perfil (null = o do chatbot). */
async function memberSignature(admin: SupabaseClient, who: Attendant): Promise<SignatureFormat | null> {
  const { data } = await admin.from(who.type === "client_member" ? "client_members" : "agency_members").select("signature").eq("id", who.id).maybeSingle();
  return isSignatureFormat(data?.signature) ? data.signature : null;
}

/** A mensagem que a equipe pode citar ou reagir: desta conversa, não apagada e com o id do canal. */
async function linkableMessage(admin: SupabaseClient, conversationId: string, id: number): Promise<{ id: number; role: string; ref: string; agentReaction: string | null } | null> {
  const m = await findMessage(admin, { id, conversationId }, ["id", "role", "channel_msg_ref_enc", "deleted_at", "agent_reaction"] as const);
  return m && !m.deleted_at && m.channel_msg_ref_enc ? { id: m.id, role: m.role, ref: m.channel_msg_ref_enc, agentReaction: m.agent_reaction } : null;
}

/** O que a equipe manda pelo canal: a mensagem (com ou sem citação) ou a reação. */
interface OutsideSend {
  noun: "mensagem" | "reação";
  whatsapp: (channel: WaChannel, to: WaRecipient) => Promise<string | null>;
  /** humanAgent: a segunda tentativa, passadas as 24 h, com a tag human_agent */
  instagram: (ch: IgChannelRow, igsid: string, humanAgent: boolean) => Promise<string | null>;
  /** sem a segunda tentativa com a tag (a reação não vai com ela) */
  noHumanAgent?: boolean;
}

/**
 * Conversa do WhatsApp ou do Instagram: a resposta da equipe sai pelo canal ligado ao chatbot,
 * pela camada única de envio (regra de estado na hora, e só gravada se o cliente recebeu).
 * Site: só confere a regra (canal suspenso) e quem chamou grava.
 */
async function deliverOutside(admin: SupabaseClient, conversationId: string, record: SendRecord, how: OutsideSend): Promise<"widget" | "gravada" | ActionResult> {
  const noun = how.noun;
  const { data: conv } = await admin.from("conversations").select("bot_id, channel, wa_id, ig_id, contact_id").eq("id", conversationId).maybeSingle();
  const metaChannel = conv?.channel === "whatsapp" || conv?.channel === "instagram" ? (conv.channel as "whatsapp" | "instagram") : null;
  if (conv && !metaChannel) {
    // regra de estado no site: canal suspenso pela BoaVoz
    const blocked = await sendBlockedReason(admin, conv.bot_id, "widget");
    if (blocked) return fail(`${blocked} A ${noun} não foi enviada.`);
  }
  if (conv?.channel === "instagram" && conv.ig_id) return deliverToInstagram(admin, conv.bot_id, conversationId, conv.ig_id, record, how);
  if (conv?.channel !== "whatsapp" || !conv.wa_id) return "widget";
  const { data: channel } = await admin.from("whatsapp_channels").select("phone_number_id, access_token_enc, disconnected_at").eq("bot_id", conv.bot_id).maybeSingle();
  if (!channel || channel.disconnected_at) return fail(`O WhatsApp deste chatbot foi desconectado. A ${noun} não foi enviada: conecte de novo na aba WhatsApp.`);
  try {
    const r = await deliver(admin, {
      botId: conv.bot_id,
      channel: "whatsapp",
      conversationId,
      kind: "equipe",
      recordFailures: false,
      record,
      // contato com vínculo: o hash de identidade vai junto (número reciclado não recebe)
      transport: async () => how.whatsapp(channel, await linkedRecipient(admin, conv.contact_id as string | null, conv.wa_id!)),
    });
    if (r.status === "blocked") return fail(`${(await sendBlockedReason(admin, conv.bot_id, "whatsapp")) ?? `Envio barrado: ${r.reason}.`} A ${noun} não foi enviada.`);
    return "gravada";
  } catch (e) {
    if (isAccessError(e)) {
      await markDisconnected(admin, { column: "bot_id", value: conv.bot_id }, TOKEN_REJECTED);
      return fail(`O cliente removeu o acesso do Boavoz ao WhatsApp. A ${noun} não foi enviada: conecte de novo na aba WhatsApp.`);
    }
    if (isPaymentError(e)) {
      await markPaymentIssue(admin, { column: "bot_id", value: conv.bot_id });
      return fail(`A Meta recusou a ${noun} por falta de forma de pagamento. O cliente precisa cadastrar o cartão no Gerenciador do WhatsApp.`);
    }
    if (e instanceof WhatsAppError && e.code === OUTSIDE_WINDOW_CODE) {
      return fail("Passaram mais de 24 horas desde a última mensagem do cliente. O WhatsApp só deixa responder dentro desse prazo.");
    }
    console.error(`whatsapp: ${noun} do atendente falhou`, e);
    return fail(`O WhatsApp não aceitou a ${noun}. Tente de novo em instantes.`);
  }
}

async function deliverToInstagram(admin: SupabaseClient, botId: string, conversationId: string, igsid: string, record: SendRecord, how: OutsideSend): Promise<"gravada" | ActionResult> {
  const noun = how.noun;
  const tagged = humanAgentEnabled() && !how.noHumanAgent;
  const { data: ch } = await admin.from("instagram_channels").select("bot_id, ig_user_id, access_token_enc, disconnected_at").eq("bot_id", botId).maybeSingle();
  if (!ch || ch.disconnected_at) return fail(`O Instagram deste chatbot foi desconectado. A ${noun} não foi enviada: conecte de novo na aba Instagram.`);
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
          return await how.instagram(ch, igsid, false);
        } catch (e) {
          if (isOutsideWindow(e) && tagged) return how.instagram(ch, igsid, true);
          throw e;
        }
      },
    });
    if (r.status === "blocked") return fail(`${(await sendBlockedReason(admin, botId, "instagram")) ?? `Envio barrado: ${r.reason}.`} A ${noun} não foi enviada.`);
    return "gravada";
  } catch (e) {
    if (isInstagramAccessError(e)) {
      await markInstagramDisconnected(admin, { column: "bot_id", value: botId }, IG_TOKEN_REJECTED);
      return fail(`O cliente removeu o acesso ao Instagram. A ${noun} não foi enviada: conecte de novo na aba Instagram.`);
    }
    if (isOutsideWindow(e)) return fail(tagged ? "Passaram mais de 7 dias desde a última mensagem do cliente. O Instagram só deixa a equipe responder até 7 dias depois." : "Passaram mais de 24 horas desde a última mensagem do cliente. O Instagram só deixa responder dentro desse prazo.");
    console.error(`instagram: ${noun} do atendente falhou`, e);
    return fail(`O Instagram não aceitou a ${noun}. Tente de novo em instantes.`);
  }
}

/**
 * A equipe reage a uma mensagem do contato (Conversa mais natural, parte 2): só quem está com a
 * conversa, no WhatsApp (os emojis da paleta) ou no Instagram (só o coração). O mesmo emoji de
 * novo, ou null, tira a reação. Nada entra na conversa: o emoji fica na mensagem reagida.
 */
export async function reactAsAgent(admin: SupabaseClient, conversationId: string, messageId: number, rawEmoji: string | null, who: Attendant): Promise<ActionResult> {
  const { data: conv } = await admin.from("conversations").select(`${HOLDER_COLS}, channel`).eq("id", conversationId).maybeSingle();
  if (!conv) return fail("Conversa não encontrada.");
  if (!holdsConversation(conv as Holder, who.id)) return fail(heldByOther(conv as Holder, who.id) ? `${otherName(conv as Holder)} está atendendo esta conversa. Só quem atende reage.` : "Assuma a conversa para reagir.");
  const allowed: readonly string[] = agentReactionsFor(conv.channel as string | null);
  if (!allowed.length) return fail("Reação só nas conversas do WhatsApp e do Instagram.");
  if (rawEmoji && !allowed.includes(rawEmoji)) return fail("Reação não disponível neste canal.");
  const target = await linkableMessage(admin, conversationId, messageId);
  if (!target || target.role !== "user") return fail("Esta mensagem não aceita reação.");
  // o mesmo emoji de novo tira a reação
  const emoji = rawEmoji && rawEmoji !== target.agentReaction ? rawEmoji : null;
  if (!emoji && !target.agentReaction) return ok("Sem reação.");
  const sent = await deliverOutside(admin, conversationId, null, {
    noun: "reação",
    noHumanAgent: true,
    whatsapp: async (channel, to) => (await sendReaction(channel, to, target.ref, emoji)).messages?.[0]?.id ?? null,
    instagram: async (ch, igsid) => {
      await sendInstagramReaction(ch, igsid, target.ref, Boolean(emoji));
      return null;
    },
  });
  if (sent !== "gravada") return sent === "widget" ? fail("Reação só nas conversas do WhatsApp e do Instagram.") : sent;
  await updateMessages(admin, { id: target.id }, { agent_reaction: emoji, agent_reaction_at: emoji ? new Date().toISOString() : null });
  return ok(emoji ? "Reação enviada." : "Reação retirada.");
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
    .update({ takeover_at: null, handled_at: at, assigned_to_type: null, assigned_to_id: null, assigned_to_name: null, assigned_at: null, announce_pending: false, transfer_from_name: null, snoozed_until: null, snoozed_at: null })
    .eq("id", conversationId);
  if (error) return fail("Não foi possível encerrar. Tente de novo.");
  // webhooks: handoff.returned com quem devolveu
  await queueHandoffReturned(admin, conversationId, { reason: "agent_resumed", agent: { id: who.id, name: who.name, type: who.type }, at });
  // pesquisa de satisfação no fim do atendimento (se ligada no chatbot; nunca segura o encerramento)
  await import("./satisfaction")
    .then(({ sendSatisfactionSurvey }) => sendSatisfactionSurvey(admin, { conversationId, trigger: "equipe" }))
    .catch((e) => console.error("pesquisa de satisfação no fim do atendimento", (e as Error).message));
  return ok("Atendimento encerrado. O assistente volta a responder esta conversa.");
}
