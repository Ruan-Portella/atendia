import type { UIMessage } from "ai";
import { findByChannelId, quoteSnippet, quotedNote } from "../message-links";
import { searchBots } from "../bot-template";
import { activeContext } from "../bot-context";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SYSTEM_AUTHOR, aiDisclosure, conversationHistory, requestHandoff, retrieveContext, runChat, withRiskText, type BotRow, type InstagramChat } from "../chat";
import { deliver } from "../send";
import { deleteMessage, loadMessages } from "../messages";
import { storeOnce } from "../whatsapp-inbound";
import { photosNote, type PhotoReading } from "../photo-note";
import { photoMatchesStep } from "../photo-reading";
import { recordAiUsage } from "../ai-usage";
import { AGE_IGNORED_HOURS, AGE_NO, AGE_SHOW, AGE_YES, getAge, setAge, type AgeStatus } from "./age";
import { LIMITS, carouselClickText, joinShownText, parseComponents, type MessageComponent } from "../components";
import { gateComponent } from "./components";
import { decideEntrance } from "./entrance";
import { checkActionReply, checkExit, exitDecision, replyFallback } from "./exit";
import { regulatedDestination } from "./sales-channel";
import { normalizeGateText } from "./match";
import { REGULATED_WINDOW_MS } from "./payment";
import { botGateExemptions } from "./exceptions";
import { conversationIdMap, idMapCategories, idMapLinks, openIdMap } from "../action-gate";
import { isOrderText, orderWithLabels } from "../order-message";
import { noticeRegulatedWithoutChannel } from "./regulated-notice";
import { openNullable, sealField, scopeOfConversation } from "../field-cipher";
import { activeLinkOf, chatIdentityFromLink, contextSwitchTool, isPairingLink } from "../pairing";
import { conversationChatIdentity, identityPort, identityPreTurn, loadConversationIdentity, markConsentAsked } from "../routine-identity";
import { callerFor, shapeActionResult } from "../action-tools";
import { isConfirmComponent, parseConfirmButton, resolveConfirmClick } from "../action-confirm";
import { setRefStatus } from "../button-refs";
import { deliverActionFiles, type ActionFile } from "../action-files";
import type { OutboundKind } from "../outbound-file";
import { INTERNAL_FALLBACK, stripInternal } from "../internal-guard";
import { CATEGORIES, GATE_TEXTS } from "./rules";
import { logGate } from "./log";
import { applyConfirmedAction, cancelRoutineAction, routinePreTurn } from "../routine-engine";
import { postPriceRuleOf } from "../post-context";

/*
 * Portão nos canais da Meta (WhatsApp e Instagram), entre a fila e a IA: resposta da pergunta de
 * 18+, decisão da entrada (proibido, pergunta de 18+ ou IA com instrução) e a pergunta de 18+
 * pedida pela própria IA. Os dois canais só mudam o jeito de enviar.
 */

/** Respostas digitadas que valem como Sim/Não, só logo depois da pergunta de 18+. */
const TYPED_YES = new Set(["sim", "s", "tenho", "sim tenho", "sou", "sou maior", "sou maior de idade", "tenho sim", "sim sou", "maior"]);
const TYPED_NO = new Set(["nao", "n", "nao tenho", "nao sou", "sou menor", "menor", "sou menor de idade", "tenho nao"]);

export interface PendingAge {
  question: string | null;
  askedAt: string | null;
  /** Reply de ação que esperava o 18+ (sai como veio depois do "Sim"). */
  reply?: string | null;
}

/** Instrução logo depois do "Sim", quando uma ação tinha tirado bebida ou remédio dos dados. */
export const AGE_REFETCH_NOTE = "A pessoa acabou de confirmar ter 18 anos ou mais. Chame de novo a ação que trouxe os dados (com os mesmos parâmetros) para mostrar os itens que tinham ficado de fora por causa da idade; não responda só com o histórico.";

/** Reply guardado vale por 15 minutos: depois disso o dado pode ter mudado, e a IA consulta de novo. */
export const PENDING_REPLY_MS = 15 * 60_000;

/** O reply guardado ainda pode sair? Função pura. */
export const pendingReplyOf = (p: PendingAge | null, now = Date.now()): string | null =>
  p?.reply && p.askedAt && now - Date.parse(p.askedAt) <= PENDING_REPLY_MS ? p.reply : null;

/**
 * Sim/Não à pergunta de 18+: botão (sempre) ou texto curto digitado com a pergunta ainda em aberto
 * (até 24 h, e antes de a conversa seguir: qualquer outra resposta do bot fecha a pergunta).
 */
export function ageAnswer(text: string | null, buttonId: string | null | undefined, pending: PendingAge | null, now = Date.now()): "sim" | "nao" | null {
  if (buttonId === AGE_YES) return "sim";
  if (buttonId === AGE_NO) return "nao";
  if (!text || !pending?.question || !pending.askedAt || now - new Date(pending.askedAt).getTime() > AGE_IGNORED_HOURS * 3_600_000) return null;
  const t = normalizeGateText(text).trim();
  if (TYPED_YES.has(t)) return "sim";
  if (TYPED_NO.has(t)) return "nao";
  return null;
}

/**
 * Histórico para responder à pergunta de antes do 18+: até a última fala do contato igual a ela
 * (a pergunta de 18+ e o "Sim" ficam de fora). Sem achar, a pergunta entra no fim.
 */
export function historyUpTo(history: UIMessage[], question: string): UIMessage[] {
  const textOf = (m: UIMessage) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  for (let i = history.length - 1; i >= 0; i--) if (history[i].role === "user" && textOf(history[i]).trim() === question.trim()) return history.slice(0, i + 1);
  return [...history, { id: "pergunta-18", role: "user", parts: [{ type: "text", text: question }] }];
}

/** Troca o texto da última fala do contato (a IA responde à versão sem os itens barrados). */
export function withLastUserText(history: UIMessage[], text: string): UIMessage[] {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return [...history.slice(0, i), { ...history[i], parts: [{ type: "text", text }] }, ...history.slice(i + 1)];
  }
  return [...history, { id: "pergunta-sem-item", role: "user", parts: [{ type: "text", text }] }];
}

/** Registro do portão (conformidade): só o que acusou, nunca o texto da conversa. */
export { logGate };

export type GateButtons = "idade" | "adulto";

/** Botões do portão (WhatsApp: botões de resposta; Instagram: respostas rápidas). */
export function gateButtons(kind: GateButtons): Array<{ id: string; title: string }> {
  return kind === "idade"
    ? [
        { id: AGE_YES, title: GATE_TEXTS.ageYes },
        { id: AGE_NO, title: GATE_TEXTS.ageNo },
      ]
    : [{ id: AGE_SHOW, title: GATE_TEXTS.showAdultOptions }];
}

export interface GateIO {
  db: SupabaseClient;
  bot: BotRow;
  channel: "whatsapp" | "instagram";
  /** Telefone (WhatsApp) ou IGSID (Instagram). */
  contact: string;
  conversationId: string;
  /**
   * Transporte do canal: envia ao contato e devolve o id da mensagem na Meta. Quem chama é a
   * camada única de envio (regra de estado e registro). Botões: "idade" (Sim e Não, da pergunta
   * de 18+) ou "adulto" ("Ver opções 18+", na resposta refeita sem os itens 18+). Componente:
   * botões, lista ou link da IA (mostrar_opcoes / mostrar_link), já conferidos pelo portão.
   */
  send: (text: string, buttons?: GateButtons, component?: MessageComponent | null) => Promise<string | null>;
  /** Anexo devolvido por uma ação (imagem ou documento pela URL): devolve o id da mensagem na Meta. */
  sendFile: (f: { kind: OutboundKind; url: string; filename: string | null }) => Promise<string | null>;
  /** Dados do contato para o runChat (nome do perfil no WhatsApp). */
  chat: { whatsapp?: { waId: string; profileName?: string | null }; instagram?: InstagramChat };
  historySize: number;
  /** Depois de lembrar o número pelo roteiro (no WhatsApp, liga a checagem de identidade da Meta). */
  onLinked?: () => Promise<void>;
  /** As fotos são lidas agora (leitura ligada, IA respondendo): o passo de foto do roteiro vale. */
  photosOn?: boolean;
  /** O que a IA sabe de quem escreve, de fora da conversa (o assistente da BoaVoz: a pessoa da equipe e a conta). */
  contextNote?: string | null;
}

export interface GateQuestion {
  text: string;
  /** Chave do evento da fila (grava uma vez só). */
  key: string;
  /** Id para o histórico quando a pergunta ainda não está no banco. */
  msgId: string;
  /** Reprocesso: a pergunta já está gravada. */
  stored: boolean;
  /** Botão tocado (id), quando houver. */
  button?: string | null;
  /** Só esta mensagem com texto no lote (o atalho "sim" do Confirmar só vale sozinho). */
  alone?: boolean;
  /**
   * Fotos da mensagem lidas pela IA (leva de leitura de fotos): a IA e o portão leem a descrição
   * junto do texto; a mensagem gravada fica só com o texto (rótulo e legenda) e a leitura à parte.
   */
  photos?: PhotoReading[] | null;
  /** Os textos da rajada, na ordem (roteiro: o dado pode ter vindo numa mensagem anterior). */
  texts?: string[];
  /** As fotos lidas de toda a rajada (roteiro: a foto do passo pode ter vindo antes do texto). */
  photoReadings?: PhotoReading[] | null;
  /** A mensagem citada pelo contato (Conversa mais natural): a IA lê o trecho junto da pergunta. */
  quoted?: { channel: "whatsapp" | "instagram"; id: string } | null;
}

/**
 * O contato vinculado pelo pareamento: nível usuario e o contexto ativo. O número lembrado pelo
 * roteiro fica de fora: ele só vale na conversa depois do "Sim, sou eu" (routine-identity.ts).
 */
async function linkIdentity(db: SupabaseClient, contactId: string | null) {
  const found = contactId ? await activeLinkOf(db, contactId) : null;
  const all = found?.all.filter(isPairingLink) ?? [];
  const active = found?.active && isPairingLink(found.active) ? found.active : null;
  const identity = active ? await chatIdentityFromLink(active, all) : null;
  return { links: found ? { active, all } : null, identity };
}

/** Responde à pergunta passando pelo portão. Erro sobe para o canal (acesso, pagamento, cota). */
/** O que aconteceu na vez da IA (undefined: a IA não respondeu, ex.: pergunta de 18+ ou envio bloqueado). */
export interface GateAnswer {
  /** A IA gravou um lead nesta resposta. */
  leadSaved: boolean;
}

export async function answerWithGate(io: GateIO, q: GateQuestion): Promise<GateAnswer | undefined> {
  const { db, bot, channel, contact, conversationId: convId } = io;
  const who = { botId: bot.id, channel, contact };
  const contactPhone = channel === "whatsapp" ? contact : null;
  // foto lida: a pergunta que a IA e o portão leem leva a descrição automática junto
  const note = photosNote(q.photos);
  const asked = note ? `${q.text}\n${note}` : q.text;

  /**
   * Texto fixo da vez do assistente: vai ao contato pela camada única de envio e fica no painel
   * (o aviso de IA não conta esse). Devolve se saiu (alguém pode ter assumido no meio-tempo).
   */
  const sendFixed = async (text: string, buttons?: GateButtons, component: MessageComponent | null = null) => {
    const r = await deliver(db, { botId: bot.id, channel, conversationId: convId, kind: "ia", record: { insert: { role: "assistant", content: text, author: SYSTEM_AUTHOR, ...(component ? { components: component } : {}) } }, transport: () => io.send(text, buttons, component) });
    return r.status === "sent";
  };
  /** reply: resposta exata de uma ação que só esperava o 18+ (sai depois do "Sim", sem chamar de novo). */
  const askAge = async (question: string, reply: string | null = null) => {
    if (!(await sendFixed(GATE_TEXTS.ageQuestion, "idade"))) return;
    const now = new Date().toISOString();
    const scope = await scopeOfConversation(convId);
    await db.from("conversations").update({ age_pending_question: await sealField("conversations.age_pending_question", question.slice(0, 2000), scope), age_pending_reply_enc: reply ? await sealField("conversations.age_pending_reply_enc", reply, scope) : null, age_asked_at: now, regulated_at: now }).eq("id", convId);
  };

  // 0. Confirmar, Cancelar ou "Tentar de novo" de uma ação "executa" (C pública, parte 5a): o
  // clique é resolvido pelo id do botão (ou pelo atalho "sim" logo depois do resumo), sem IA
  const waPhone = channel === "whatsapp" && /^\d+$/.test(contact) ? contact : null;
  const destinationOf = () => regulatedDestination(bot.regulated_channel, bot.human_handoff?.address);
  const callerNow = async () => {
    const { data: row } = await db.from("conversations").select("contact_id").eq("id", convId).maybeSingle();
    const { identity } = await linkIdentity(db, (row?.contact_id as string | null | undefined) ?? null);
    // sem pareamento, a identidade que o roteiro deu a esta conversa (parte 2c)
    return callerFor(db, { bot, conversationId: convId, channel, waPhone, age: await getAge(db, who), contactKey: contact, identity: identity ?? (await conversationChatIdentity(db, convId)) });
  };
  /** Anexos das ações, logo depois do texto (barrado ou falho: o aviso fixo). */
  const sendFiles = (files: ActionFile[]) => deliverActionFiles(db, files, { bot, conversationId: convId, channel, destination: destinationOf(), sendFile: io.sendFile, sendText: (t) => io.send(t) });
  const click = await resolveConfirmClick(db, { bot, conversationId: convId, buttonId: q.button ?? null, text: q.text, alone: q.alone !== false, key: q.key, caller: callerNow });
  let confirmed: Parameters<typeof runChat>[0]["confirmed"];
  // roteiro (B2'): o Confirmar de uma ação do passo anda o roteiro pelo resultado; o Cancelar encerra
  let routineNote: string | null = null;
  let routineHandoff: string | null = null;
  if (click.kind !== "none") {
    await storeOnce(db, convId, q.text, q.key, q.photos);
    if (click.kind === "fixed") {
      if (click.canceledActionId) await cancelRoutineAction(db, convId, click.canceledActionId);
      return void (await sendFixed(click.text, undefined, click.component ?? null));
    }
    if (click.kind === "handoff") return void (await sendFixed(await requestHandoff(db, bot, convId, "Pedido sem confirmação: o contato pediu para falar com alguém")));
    ({ note: routineNote, handoff: routineHandoff } = await applyConfirmedAction(db, { conversationId: convId, action: click.action.name, status: click.call.status, outcome: click.call.outcome ?? null, declared: click.action.outcomes, waPhone }));
    const [age, exempt] = await Promise.all([getAge(db, who), botGateExemptions(db, bot.id)]);
    const clickRegulatedAt = click.caller.regulatedAt ?? null;
    const shaped = await shapeActionResult(db, { bot, conversationId: convId, gateChannel: channel, waPhone, age, exempt, destination: destinationOf(), regulatedAt: clickRegulatedAt }, click.call, { execute: true });
    if (shaped.reply) {
      // reply exato da ação: sai como veio (ou o texto fixo, se o portão barrar), sem IA, com os botões que ela devolveu
      const regulatedConversation = clickRegulatedAt !== null && Date.now() - Date.parse(clickRegulatedAt) < REGULATED_WINDOW_MS;
      const rc = checkActionReply({ text: shaped.reply, channel, contactPhone, age, regulatedConversation, exempt });
      if (!rc.ok) await logGate(db, { botId: bot.id, conversationId: convId, stage: "saida", decision: "reply_descartado", categories: [...rc.prohibited, ...rc.regulated] });
      const text = rc.ok ? shaped.reply : replyFallback(rc, destinationOf());
      const buttons = rc.ok ? gateComponent(shaped.component, { channel, contactPhone, age, regulatedConversation, exempt }).component : null;
      const disclosure = await aiDisclosure(db, bot, convId);
      const out = disclosure ? `${disclosure}\n\n${text}` : text;
      const sentReply = await deliver(db, { botId: bot.id, channel, conversationId: convId, kind: "ia", record: { insert: { role: "assistant", content: out, author: null, announce_chars: disclosure ? disclosure.length + 2 : null, ...(buttons ? { components: buttons } : {}) } }, transport: () => io.send(out, undefined, buttons) });
      if (sentReply.status === "sent") await sendFiles(shaped.files);
      // o roteiro manda para a equipe depois desta ação: o aviso vai logo depois do reply
      if (routineHandoff) await sendFixed(await requestHandoff(db, bot, convId, routineHandoff));
      return;
    }
    // sem reply: a IA escreve a partir do resultado (o clique já está gravado)
    confirmed = { action: click.action.name, params: click.params, output: click.call.status === "ok" ? { ...shaped.output, confirmada: true } : shaped.output, internal: shaped.internal, component: shaped.component, files: shaped.files, via: click.via };
  }

  // 1. resposta da pergunta de 18+ (ou toque em "Ver opções 18+")
  const { data: pendingRow } = await db.from("conversations").select("age_pending_question, age_pending_reply_enc, age_asked_at, regulated_at, gate_id_map_enc, gate_id_map_expires_at, contact_id, context_since").eq("id", convId).maybeSingle();
  // a pergunta e a resposta guardadas até o "Sim" e o mapa de ids vão cifrados com a chave do cliente
  const pendingQuestion = await openNullable("conversations.age_pending_question", pendingRow?.age_pending_question);
  const pendingReply = await openNullable("conversations.age_pending_reply_enc", pendingRow?.age_pending_reply_enc);
  const idMap = await openIdMap(pendingRow);
  const pending: PendingAge | null = pendingRow
    ? { question: pendingQuestion, askedAt: (pendingRow.age_asked_at as string | null) ?? null, reply: pendingReply }
    : null;
  const regulatedAt = (pendingRow?.regulated_at as string | null | undefined) ?? null;
  // contexto da conversa (pareamento, P2): a IA só lê o trecho depois da última troca
  const since = (pendingRow?.context_since as string | null | undefined) ?? null;
  if (q.button === AGE_SHOW) {
    // "Ver opções 18+": pergunta a idade (e depois do "Sim" responde de novo à pergunta de antes)
    const current = await getAge(db, who);
    if (current !== "sim") {
      await storeOnce(db, convId, q.text, q.key, q.photos);
      if (current === "nao") await sendFixed(GATE_TEXTS.under18);
      else await askAge(pending?.question ?? asked);
      await logGate(db, { botId: bot.id, conversationId: convId, stage: "saida", decision: current === "nao" ? "nao_18" : "pede_18", categories: [] });
      return;
    }
  }
  // já confirmou e tocou em "Ver opções 18+": segue como um "Sim" (o "sim" do Confirmar nunca é resposta de 18+)
  const answered = confirmed ? null : (ageAnswer(q.text, q.button, pending) ?? (q.button === AGE_SHOW ? "sim" : null));
  // o carrinho da Meta: os códigos que as ações já mostraram ganham o nome (bebida no carrinho é pedido misto)
  let question = isOrderText(asked) ? orderWithLabels(asked, await conversationIdMap(db, convId)) : asked;
  let storeQuestion = !confirmed;
  let history: UIMessage[];
  if (answered) {
    await storeOnce(db, convId, q.text, q.key, q.photos);
    await setAge(db, who, answered, "chat");
    if (answered === "nao") {
      await clearAgePending(db, convId);
      await sendFixed(GATE_TEXTS.ageDenied);
      await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: "nao_18", categories: [] });
      return;
    }
    storeQuestion = false;
    // "Sim" logo depois de um reply de ação barrado só pelo 18+: ele sai como veio, sem a IA e sem
    // chamar a ação de novo (o "Não" vence: a idade é lida de novo)
    const held = pendingReplyOf(pending);
    if (held && (await getAge(db, who)) === "sim") {
      const exempt = await botGateExemptions(db, bot.id);
      const rc = checkActionReply({ text: held, channel, contactPhone, age: "sim", regulatedConversation: true, exempt });
      if (!rc.ok) await logGate(db, { botId: bot.id, conversationId: convId, stage: "saida", decision: "reply_descartado", categories: [...rc.prohibited, ...rc.regulated] });
      const text = rc.ok ? held : replyFallback(rc, regulatedDestination(bot.regulated_channel, bot.human_handoff?.address));
      const disclosure = await aiDisclosure(db, bot, convId);
      const out = disclosure ? `${disclosure}\n\n${text}` : text;
      await deliver(db, { botId: bot.id, channel, conversationId: convId, kind: "ia", record: { insert: { role: "assistant", content: out, author: null, announce_chars: disclosure ? disclosure.length + 2 : null } }, transport: () => io.send(out) });
      await clearAgePending(db, convId);
      return;
    }
    history = await conversationHistory(db, convId, io.historySize, undefined, since);
    // "Sim": a IA responde agora à pergunta que ficou esperando (sem pergunta guardada, ao "Sim")
    if (pending?.question) {
      question = pending.question;
      history = historyUpTo(history, question);
    }
  } else {
    history = await conversationHistory(db, convId, io.historySize, undefined, since);
    // botão de um card do carrossel: a IA recebe o nome do card junto ("Pedir esta: Pizza Calabresa")
    if (q.button && !confirmed) question = (await carouselClick(db, convId, q.button)) ?? question;
    // no reprocesso a pergunta já está no banco, então já vem no histórico (o Confirmar foi gravado acima)
    // o contato respondeu em cima de uma mensagem: o trecho citado vai junto (o resto da conversa lê pelo reply_to_id)
    const quoted = q.quoted && !q.stored ? await findByChannelId(db, q.quoted.channel, q.quoted.id).catch(() => null) : null;
    const asked = quoted && quoted.conversation_id === convId ? `${quotedNote(quoteSnippet(quoted.content))}\n${question}` : question;
    if (!q.stored && !confirmed) history.push({ id: q.msgId, role: "user", parts: [{ type: "text", text: asked }] });
  }

  // identificação pelo roteiro (B2', parte 2c): a escolha da conta, a licença para lembrar o número e
  // o "Estou falando com...?" (a mensagem de um número lembrado espera a resposta), antes do roteiro
  const contactId = (pendingRow?.contact_id as string | null | undefined) ?? null;
  const { links, identity: pairingIdentity } = await linkIdentity(db, contactId);
  let turnTexts = q.texts?.length ? q.texts : [q.text];
  let routineButton = q.button ?? null;
  const offerRemember = bot.offer_remember_number !== false;
  const idTurn = await identityPreTurn(db, { bot, channel, conversationId: convId, contactId, buttonId: q.button ?? null, text: q.text, texts: turnTexts, consume: !confirmed && !answered, external: Boolean(pairingIdentity?.externalId), onLinked: io.onLinked, offerRemember });
  if (idTurn.kind === "fixed") {
    await storeOnce(db, convId, q.text, q.key, q.photos);
    await sendFixed(idTurn.text, undefined, idTurn.component);
    return;
  }
  if (idTurn.kind === "resume") {
    // a resposta fica gravada; a IA responde agora à mensagem que esperava (o portão confere ela)
    await storeOnce(db, convId, q.text, q.key, q.photos);
    storeQuestion = false;
    question = idTurn.text;
    history = historyUpTo(await conversationHistory(db, convId, io.historySize, undefined, since), idTurn.text);
    turnTexts = idTurn.texts.length ? idTurn.texts : [idTurn.text];
    routineButton = null;
  }
  const port = identityPort(db, { conversationId: convId, botId: bot.id, contactId, channel, initial: await loadConversationIdentity(db, convId), external: pairingIdentity, offerRemember });

  // roteiros (B2'): botão do passo, escolha digitada, dado conferido, palavra-chave e fim por prazo,
  // antes da IA; depois do Confirmar ou da resposta de 18+, a mensagem já foi usada (só o estado vale)
  // depois do Confirmar, a equipe entra pelo roteiro: o aviso vai junto da resposta da IA
  if (routineHandoff) routineNote = `${routineNote ?? ""} Diga à pessoa, junto do resultado: ${await requestHandoff(db, bot, convId, routineHandoff)}`.trim();
  const consumed = idTurn.kind === "none" && idTurn.consumed;
  const routineTurn = await routinePreTurn(db, {
    bot,
    conversationId: convId,
    texts: turnTexts,
    buttonId: routineButton,
    waPhone,
    consume: !confirmed && !answered && !consumed,
    note: routineNote,
    identity: { identified: port.identified(), choosing: port.choosing() },
    // passo de foto (parte 2d): a mensagem que esperava o "Sim, sou eu" não traz as fotos dela
    photos: idTurn.kind === "resume" ? null : (q.photoReadings ?? q.photos ?? null),
    canPhotos: Boolean(io.photosOn),
    // a foto mostra o que o passo pede? O BoaVoz confere (classificação), não a IA da resposta
    checkPhoto: (asked, seen) => photoMatchesStep(asked, seen, { onUsage: (u) => void recordAiUsage(db, { agencyId: bot.agency_id, botId: bot.id, conversationId: convId, kind: "classificacao", channel, ...u }) }),
  });
  if (routineTurn.fixed) {
    await storeOnce(db, convId, q.text, q.key, q.photos);
    await sendFixed(routineTurn.fixed.kind === "handoff" ? await requestHandoff(db, bot, convId, routineTurn.fixed.reason) : routineTurn.fixed.text);
    return;
  }

  // 2. portão da entrada (o "Não" sempre vence: a idade é lida de novo depois do setAge)
  const age: AgeStatus = await getAge(db, who);
  // o contexto ativo (o pareamento ou o roteiro, com o fixo do chatbot por cima) escolhe as fontes com etiqueta
  const search = searchBots(bot);
  const [retrieval, exempt] = await Promise.all([retrieveContext(db, search.botId, question, activeContext(bot, pairingIdentity ?? port.current()), search.alsoBotId, postPriceRuleOf(bot)), botGateExemptions(db, bot.id)]);
  const entrance = await decideEntrance({
    text: question,
    channel,
    contactPhone,
    age,
    exempt,
    context: retrieval.context,
    // a base e o que saiu dos dados das ações nesta conversa (pedido com cerveja: "e a cerveja?" pede o 18+)
    contextCategories: [...retrieval.hits.flatMap((h) => h.gate_categories ?? []), ...idMapCategories(idMap)],
    companyName: bot.client_name,
    onUsage: (u) => void recordAiUsage(db, { agencyId: bot.agency_id, botId: bot.id, conversationId: convId, kind: "classificacao", channel, ...u }),
  });
  if (entrance.kind === "proibido") {
    await storeOnce(db, convId, q.text, q.key, q.photos);
    // o item veio do pedido da própria pessoa ("e o cigarro?"): o texto fixo diz onde ver o pedido completo
    const fromOrder = entrance.categories.some((c) => idMapCategories(idMap).includes(c));
    const where = fromOrder ? (idMapLinks(idMap)[0] ?? regulatedDestination(bot.regulated_channel, bot.human_handoff?.address)?.destino ?? null) : null;
    await sendFixed(where ? GATE_TEXTS.prohibitedSeeElsewhere(where) : GATE_TEXTS.prohibited);
    await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: "proibido", categories: entrance.categories });
    return;
  }
  if (entrance.kind === "nao_18") {
    await storeOnce(db, convId, q.text, q.key, q.photos);
    await sendFixed(GATE_TEXTS.under18);
    await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: "nao_18", categories: entrance.categories });
    return;
  }
  if (entrance.kind === "pede_18") {
    await storeOnce(db, convId, q.text, q.key, q.photos);
    await askAge(question);
    await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: "pede_18", categories: entrance.categories });
    return;
  }
  if (entrance.prohibited.length) await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: "proibido_misto", categories: entrance.prohibited });
  if (entrance.regulated.length) {
    await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: age === "nao" ? "nao_18" : "regulamentado", categories: entrance.regulated });
    await db.from("conversations").update({ regulated_at: new Date().toISOString() }).eq("id", convId);
    // o primeiro item 18+ num chatbot sem canal para esses pedidos: o dono fica sabendo (uma vez)
    if (!destinationOf()) await noticeRegulatedWithoutChannel(db, bot, entrance.regulated).catch((e) => console.error("portão: aviso de canal 18+", (e as Error).message));
  }

  // item barrado junto com outro assunto: a IA responde à mensagem sem o item (o painel guarda a original)
  if (entrance.question) {
    if (storeQuestion) await storeOnce(db, convId, q.text, q.key, q.photos);
    storeQuestion = false;
    history = withLastUserText(history, entrance.question);
  }

  // acabou de confirmar 18+ e uma ação tinha tirado bebida ou remédio dos dados: a IA consulta de novo
  const refetch = answered === "sim" && age === "sim" && idMapCategories(idMap).some((c) => CATEGORIES[c].level === "regulamentado") ? AGE_REFETCH_NOTE : null;
  // qual consulta: a mais recente que devolveu itens fora por idade (a IA é obrigada a chamá-la primeiro)
  const refetchTool = refetch ? await hiddenByAgeTool(db, convId) : null;

  // contato vinculado (pareamento) ou identificado pelo roteiro: nível usuario e a conta ativa; com 2
  // contas ou mais, a IA pode trocar
  const identity = pairingIdentity ?? port.current();
  const extraTools = pairingIdentity && contactId && links ? contextSwitchTool(db, { contactId, conversationId: convId, links: links.all, activeId: links.active?.id ?? null }) : port.switchTool();

  // 3. IA (aviso de IA calculado antes de a resposta nova entrar na conversa)
  const disclosure = await aiDisclosure(db, bot, convId);
  const { result, saved, leadSaved, urgent, askAge: aiAskedAge, actionReply, internalTerms, components: shownComponent, files: actionFiles, shownText, listText, confirmShown, links: linkGuard } = await runChat({
    db,
    bot,
    messages: history,
    conversationId: convId,
    visitorId: null,
    channel,
    ...io.chat,
    questionKey: q.key,
    storeQuestion,
    questionContent: q.text,
    photos: q.photos ?? null,
    retrieval,
    identity,
    extraTools,
    gate: { age, instruction: [entrance.instruction, refetch].filter(Boolean).join(" ") || undefined, remind: entrance.regulated.length > 0 || entrance.prohibited.length > 0 || Boolean(refetch), exempt, onlyMentioned: entrance.onlyMentioned, noHits: entrance.kind === "ia" && entrance.noHits, ...(refetchTool ? { refetchTool } : {}) },
    confirmed,
    routine: routineTurn,
    turnTexts,
    identityPort: port,
    identityNote: [idTurn.note, io.contextNote].filter(Boolean).join("\n\n") || null,
  });
  // botões, lista ou link: o texto da ferramenta entra na mensagem (como o runChat gravou)
  // resumo do Confirmar: só o que o BoaVoz montou (como o runChat gravou)
  const savedRaw = confirmShown() && shownText() ? shownText()! : joinShownText(await result.text, shownText());
  const answerId = await saved;
  // a IA escreveu as alternativas em lista: elas vão como botões e o texto vai sem a lista
  const raw = listText() ?? savedRaw;
  // a IA pediu a confirmação de 18+: a pergunta fixa com botões vai no lugar da resposta
  // (risco à vida vem antes: aí a resposta com os telefones sai de qualquer jeito)
  if (aiAskedAge() && age === null && !urgent()) {
    if (answerId) await deleteMessage(db, answerId);
    await askAge(question);
    await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: "pede_18", categories: entrance.regulated });
    return;
  }
  const regulatedConversation = entrance.regulated.length > 0 || (regulatedAt !== null && Date.now() - Date.parse(regulatedAt) < REGULATED_WINDOW_MS);
  const destination = regulatedDestination(bot.regulated_channel, bot.human_handoff?.address);
  // 4. ação com reply (Integrações): o texto exato vai no lugar do da IA, inteiro ou não vai. Barrado,
  // vai um texto fixo (o que a IA escreveu junto é só um "vou verificar"); 18+ sem resposta de idade
  // vira a pergunta. Com risco à vida, segue a resposta da IA com os telefones
  let text = raw;
  const reply = urgent() ? null : actionReply();
  if (reply) {
    const rc = checkActionReply({ text: reply, channel, contactPhone, age, regulatedConversation, exempt });
    if (rc.ok) text = reply;
    else {
      await logGate(db, { botId: bot.id, conversationId: convId, stage: "saida", decision: "reply_descartado", categories: [...rc.prohibited, ...rc.regulated] });
      if (!rc.prohibited.length && rc.regulated.length && age === null) {
        if (answerId) await deleteMessage(db, answerId);
        // o reply fica guardado: depois do "Sim" ele sai como veio, sem chamar a ação de novo
        await askAge(question, reply);
        return;
      }
      text = replyFallback(rc, destination);
    }
  }
  // link, e-mail, Pix ou conta escrito pela IA sem fonte confiável vira "[link removido]" (o reply
  // é texto do dev e sai como veio; o resumo do Confirmar é do BoaVoz)
  const aiText = text === raw;
  if (aiText && !confirmShown()) text = (await linkGuard.guard(text)).text;
  // valor interno de uma ação escrito pela IA (o reply é texto do dev e sai como veio)
  if (aiText && internalTerms().length) {
    const s = stripInternal(text, internalTerms());
    if (s.leaked) {
      await logGate(db, { botId: bot.id, conversationId: convId, stage: "saida", decision: "interno_removido", categories: [] });
      text = s.text || INTERNAL_FALLBACK;
    }
  }
  // 5. portão na saída: item proibido, item 18+ sem o "Sim" e pagamento numa conversa com esses itens
  const exit = checkExit({ text, channel, contactPhone, age, regulatedConversation, exempt, destination });
  if (exit.prohibited.length || exit.regulated.length || exit.payment) {
    await logGate(db, { botId: bot.id, conversationId: convId, stage: "saida", decision: exitDecision(exit), categories: [...exit.prohibited, ...exit.regulated] });
  }
  if (exit.emptied && exit.regulated.length && age === null && !urgent()) {
    // não sobrou nada além do item 18+: a pergunta de idade vai no lugar
    if (answerId) await deleteMessage(db, answerId);
    await askAge(question);
    return;
  }
  const safe = exit.emptied ? (exit.prohibited.length ? GATE_TEXTS.prohibited : GATE_TEXTS.under18) : exit.text;
  // portão nos botões, lista e link (como no texto); com reply de ação, só os botões que a ação devolveu
  const gated = gateComponent(shownComponent(), { channel, contactPhone, age, regulatedConversation, exempt });
  if (gated.prohibited.length || gated.regulated.length) await logGate(db, { botId: bot.id, conversationId: convId, stage: "saida", decision: "componente", categories: [...gated.prohibited, ...gated.regulated] });
  let component = gated.component;
  // o portão mexeu no resumo de um Confirmar: os botões não saem (valeriam por um texto que a pessoa não viu)
  if (isConfirmComponent(component) && (exit.emptied || exit.text !== raw)) {
    const ref = component?.type === "options" ? parseConfirmButton(component.options[0]?.id) : null;
    if (ref) await setRefStatus(db, ref.refId, "superseded");
    component = null;
  }
  // 18+ sem o "Sim": "Ver opções 18+" vira mais uma opção; sem opções, vai como botão do portão
  const adultOffer = (exit.offerAdult && !exit.emptied) || gated.offerAdult;
  if (adultOffer && component?.type === "options" && !isConfirmComponent(component) && component.options.length < LIMITS.list) component = { ...component, options: [...component.options, { id: AGE_SHOW, title: GATE_TEXTS.showAdultOptions }] };
  const adultButton = adultOffer && component?.type !== "options";
  let answer = withRiskText(safe, urgent()).trim();
  if (answer) {
    // item proibido junto com outro assunto: o aviso fixo vai antes, na mesma mensagem
    if (entrance.prefix) answer = `${entrance.prefix}\n\n${answer}`;
    const out = disclosure ? `${disclosure}\n\n${answer}` : answer;
    // camada única de envio: se alguém assumiu ou pausou durante a resposta, ela não sai (fica "Não enviada" no painel)
    // com reply, o gravado (texto da IA + reply) sempre troca pelo que saiu de fato
    // o aviso de IA (ou o "Voltei!") no começo fica marcado como anúncio no painel
    const r = await deliver(db, { botId: bot.id, channel, conversationId: convId, kind: "ia", record: answerId ? { update: answerId, ...(out !== savedRaw || reply ? { content: out } : {}), ...(disclosure ? { announce_chars: disclosure.length + 2 } : {}), ...(shownComponent() || component ? { components: component } : {}) } : null, transport: () => io.send(out, adultButton && !component ? "adulto" : undefined, component) });
    if (r.status === "blocked") return;
    // carrossel sem os cards 18+: o "Ver opções 18+" vai logo depois, numa mensagem própria (os
    // cards levam botões de um tipo só)
    if (adultButton && component?.type === "carousel") await sendFixed(GATE_TEXTS.showAdultPrompt, "adulto");
    // anexos devolvidos pelas ações: logo depois do texto
    await sendFiles(actionFiles());
    // identificação pelo roteiro: a licença para lembrar o número, logo depois da primeira resposta
    // sem botões (os da licença nunca disputam com os de um passo)
    if (!component && !adultButton) {
      const ask = port.consentPrompt();
      if (ask && (await sendFixed(ask.text, undefined, ask.component))) await markConsentAsked(db, { conversationId: convId, botId: bot.id, contactId });
    }
  }
  // a conversa seguiu: a pergunta de 18+ fecha (só depois do envio; no reprocesso ela ainda vale).
  // Com o botão "Ver opções 18+", esta pergunta fica guardada para depois do "Sim" (a idade ainda
  // não foi perguntada, então "sim" digitado não conta)
  if (adultButton) await db.from("conversations").update({ age_pending_question: await sealField("conversations.age_pending_question", question.slice(0, 2000), await scopeOfConversation(convId)), age_pending_reply_enc: null, age_asked_at: null, regulated_at: new Date().toISOString() }).eq("id", convId);
  else if (pending?.question) await clearAgePending(db, convId);
  return { leadSaved: leadSaved() };
}

/** A consulta mais recente (acao_<nome>) que tirou itens por idade, nas últimas respostas da IA, ou null. */
async function hiddenByAgeTool(db: SupabaseClient, conversationId: string): Promise<string | null> {
  const recent = await loadMessages(db, { conversationId, roles: ["assistant"], newestFirst: true, limit: 5 }, ["tool_results"] as const);
  for (const m of recent) {
    const results = Array.isArray(m.tool_results) ? (m.tool_results as Array<{ name?: string; output?: { ocultos_por_idade?: unknown } }>) : [];
    const hit = results.find((t) => t.name?.startsWith("acao_") && Array.isArray(t.output?.ocultos_por_idade) && t.output.ocultos_por_idade.length > 0);
    if (hit?.name) return hit.name;
  }
  return null;
}

/** Toque num botão de card do carrossel (das últimas mensagens): "Pedir esta: Pizza Calabresa", ou null. */
async function carouselClick(db: SupabaseClient, conversationId: string, buttonId: string): Promise<string | null> {
  const recent = await loadMessages(db, { conversationId, roles: ["assistant", "agent"], delivered: true, newestFirst: true, limit: 5 }, ["components_enc"] as const);
  for (const m of recent) {
    const named = carouselClickText(parseComponents(m.components_enc ?? null), buttonId);
    if (named) return named;
  }
  return null;
}

/** Fecha a pergunta de 18+ guardada (e a resposta que esperava o "Sim"). A pergunta só é gravada aqui, cifrada. */
export async function clearAgePending(db: SupabaseClient, convId: string): Promise<void> {
  await db.from("conversations").update({ age_pending_question: null, age_pending_reply_enc: null }).eq("id", convId);
}

/** Conversa com bebida ou remédio: vale enquanto a janela de 24 h da Meta estiver aberta. */
