import type { UIMessage } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SYSTEM_AUTHOR, aiDisclosure, conversationHistory, retrieveContext, runChat, withRiskText, type BotRow } from "../chat";
import { deliver } from "../send";
import { deleteMessage } from "../messages";
import { storeOnce } from "../whatsapp-inbound";
import { recordAiUsage } from "../ai-usage";
import { AGE_IGNORED_HOURS, AGE_NO, AGE_SHOW, AGE_YES, getAge, setAge, type AgeStatus } from "./age";
import { decideEntrance } from "./entrance";
import { checkActionReply, checkExit, exitDecision, replyFallback } from "./exit";
import { regulatedDestination } from "./sales-channel";
import { normalizeGateText } from "./match";
import { REGULATED_WINDOW_MS } from "./payment";
import { botGateExemptions } from "./exceptions";
import { idMapCategories, idMapLinks, openIdMap } from "../action-gate";
import { openNullable, sealField, scopeOfConversation } from "../field-cipher";
import { activeLinkOf, chatIdentityFromLink, contextSwitchTool } from "../pairing";
import { INTERNAL_FALLBACK, stripInternal } from "../internal-guard";
import { CATEGORIES, GATE_TEXTS } from "./rules";
import { logGate } from "./log";

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
   * de 18+) ou "adulto" ("Ver opções 18+", na resposta refeita sem os itens 18+).
   */
  send: (text: string, buttons?: GateButtons) => Promise<string | null>;
  /** Dados do contato para o runChat (nome do perfil no WhatsApp). */
  chat: { whatsapp?: { waId: string; profileName?: string | null }; instagram?: { igsid: string } };
  historySize: number;
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
}

/** Responde à pergunta passando pelo portão. Erro sobe para o canal (acesso, pagamento, cota). */
export async function answerWithGate(io: GateIO, q: GateQuestion) {
  const { db, bot, channel, contact, conversationId: convId } = io;
  const who = { botId: bot.id, channel, contact };
  const contactPhone = channel === "whatsapp" ? contact : null;

  /**
   * Texto fixo da vez do assistente: vai ao contato pela camada única de envio e fica no painel
   * (o aviso de IA não conta esse). Devolve se saiu (alguém pode ter assumido no meio-tempo).
   */
  const sendFixed = async (text: string, buttons?: GateButtons) => {
    const r = await deliver(db, { botId: bot.id, channel, conversationId: convId, kind: "ia", record: { insert: { role: "assistant", content: text, author: SYSTEM_AUTHOR } }, transport: () => io.send(text, buttons) });
    return r.status === "sent";
  };
  /** reply: resposta exata de uma ação que só esperava o 18+ (sai depois do "Sim", sem chamar de novo). */
  const askAge = async (question: string, reply: string | null = null) => {
    if (!(await sendFixed(GATE_TEXTS.ageQuestion, "idade"))) return;
    const now = new Date().toISOString();
    await db.from("conversations").update({ age_pending_question: question.slice(0, 2000), age_pending_reply_enc: reply ? await sealField("conversations.age_pending_reply_enc", reply, await scopeOfConversation(convId)) : null, age_asked_at: now, regulated_at: now }).eq("id", convId);
  };

  // 1. resposta da pergunta de 18+ (ou toque em "Ver opções 18+")
  const { data: pendingRow } = await db.from("conversations").select("age_pending_question, age_pending_reply_enc, age_asked_at, regulated_at, gate_id_map_enc, gate_id_map_expires_at, contact_id, context_since").eq("id", convId).maybeSingle();
  // a resposta guardada até o "Sim" e o mapa de ids vão cifrados com a chave do cliente
  const pendingReply = await openNullable("conversations.age_pending_reply_enc", pendingRow?.age_pending_reply_enc);
  const idMap = await openIdMap(pendingRow);
  const pending: PendingAge | null = pendingRow
    ? { question: (pendingRow.age_pending_question as string | null) ?? null, askedAt: (pendingRow.age_asked_at as string | null) ?? null, reply: pendingReply }
    : null;
  const regulatedAt = (pendingRow?.regulated_at as string | null | undefined) ?? null;
  // contexto da conversa (pareamento, P2): a IA só lê o trecho depois da última troca
  const since = (pendingRow?.context_since as string | null | undefined) ?? null;
  if (q.button === AGE_SHOW) {
    // "Ver opções 18+": pergunta a idade (e depois do "Sim" responde de novo à pergunta de antes)
    const current = await getAge(db, who);
    if (current !== "sim") {
      await storeOnce(db, convId, q.text, q.key);
      if (current === "nao") await sendFixed(GATE_TEXTS.under18);
      else await askAge(pending?.question ?? q.text);
      await logGate(db, { botId: bot.id, conversationId: convId, stage: "saida", decision: current === "nao" ? "nao_18" : "pede_18", categories: [] });
      return;
    }
  }
  // já confirmou e tocou em "Ver opções 18+": segue como um "Sim"
  const answered = ageAnswer(q.text, q.button, pending) ?? (q.button === AGE_SHOW ? "sim" : null);
  let question = q.text;
  let storeQuestion = true;
  let history: UIMessage[];
  if (answered) {
    await storeOnce(db, convId, q.text, q.key);
    await setAge(db, who, answered, "chat");
    if (answered === "nao") {
      await db.from("conversations").update({ age_pending_question: null, age_pending_reply_enc: null }).eq("id", convId);
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
      await deliver(db, { botId: bot.id, channel, conversationId: convId, kind: "ia", record: { insert: { role: "assistant", content: out, author: null } }, transport: () => io.send(out) });
      await db.from("conversations").update({ age_pending_question: null, age_pending_reply_enc: null }).eq("id", convId);
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
    // no reprocesso a pergunta já está no banco, então já vem no histórico
    if (!q.stored) history.push({ id: q.msgId, role: "user", parts: [{ type: "text", text: q.text }] });
  }

  // 2. portão da entrada (o "Não" sempre vence: a idade é lida de novo depois do setAge)
  const age: AgeStatus = await getAge(db, who);
  const [retrieval, exempt] = await Promise.all([retrieveContext(db, bot.id, question), botGateExemptions(db, bot.id)]);
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
    await storeOnce(db, convId, q.text, q.key);
    // o item veio do pedido da própria pessoa ("e o cigarro?"): o texto fixo diz onde ver o pedido completo
    const fromOrder = entrance.categories.some((c) => idMapCategories(idMap).includes(c));
    const where = fromOrder ? (idMapLinks(idMap)[0] ?? regulatedDestination(bot.regulated_channel, bot.human_handoff?.address)?.destino ?? null) : null;
    await sendFixed(where ? GATE_TEXTS.prohibitedSeeElsewhere(where) : GATE_TEXTS.prohibited);
    await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: "proibido", categories: entrance.categories });
    return;
  }
  if (entrance.kind === "nao_18") {
    await storeOnce(db, convId, q.text, q.key);
    await sendFixed(GATE_TEXTS.under18);
    await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: "nao_18", categories: entrance.categories });
    return;
  }
  if (entrance.kind === "pede_18") {
    await storeOnce(db, convId, q.text, q.key);
    await askAge(question);
    await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: "pede_18", categories: entrance.categories });
    return;
  }
  if (entrance.prohibited.length) await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: "proibido_misto", categories: entrance.prohibited });
  if (entrance.regulated.length) {
    await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: age === "nao" ? "nao_18" : "regulamentado", categories: entrance.regulated });
    await db.from("conversations").update({ regulated_at: new Date().toISOString() }).eq("id", convId);
  }

  // item barrado junto com outro assunto: a IA responde à mensagem sem o item (o painel guarda a original)
  if (entrance.question) {
    if (storeQuestion) await storeOnce(db, convId, q.text, q.key);
    storeQuestion = false;
    history = withLastUserText(history, entrance.question);
  }

  // acabou de confirmar 18+ e uma ação tinha tirado bebida ou remédio dos dados: a IA consulta de novo
  const refetch = answered === "sim" && age === "sim" && idMapCategories(idMap).some((c) => CATEGORIES[c].level === "regulamentado") ? AGE_REFETCH_NOTE : null;

  // contato vinculado (pareamento): nível usuario e o contexto ativo; com 2 contas ou mais, a IA pode trocar
  const contactId = (pendingRow?.contact_id as string | null | undefined) ?? null;
  const links = contactId ? await activeLinkOf(db, contactId) : null;
  const identity = links?.active ? await chatIdentityFromLink(links.active, links.all) : null;
  const extraTools = contactId && links ? contextSwitchTool(db, { contactId, conversationId: convId, links: links.all, activeId: links.active?.id ?? null }) : {};

  // 3. IA (aviso de IA calculado antes de a resposta nova entrar na conversa)
  const disclosure = await aiDisclosure(db, bot, convId);
  const { result, saved, urgent, askAge: aiAskedAge, actionReply, internalTerms } = await runChat({
    db,
    bot,
    messages: history,
    conversationId: convId,
    visitorId: null,
    channel,
    ...io.chat,
    questionKey: q.key,
    storeQuestion,
    retrieval,
    identity,
    extraTools,
    gate: { age, instruction: [entrance.instruction, refetch].filter(Boolean).join(" ") || undefined, remind: entrance.regulated.length > 0 || entrance.prohibited.length > 0 || Boolean(refetch), exempt },
  });
  const raw = await result.text;
  const answerId = await saved;
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
  // valor interno de uma ação escrito pela IA (o reply é texto do dev e sai como veio)
  if (text === raw && internalTerms().length) {
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
  const adultButton = exit.offerAdult && !exit.emptied;
  let answer = withRiskText(safe, urgent()).trim();
  if (answer) {
    // item proibido junto com outro assunto: o aviso fixo vai antes, na mesma mensagem
    if (entrance.prefix) answer = `${entrance.prefix}\n\n${answer}`;
    const out = disclosure ? `${disclosure}\n\n${answer}` : answer;
    // camada única de envio: se alguém assumiu ou pausou durante a resposta, ela não sai (fica "Não enviada" no painel)
    // com reply, o gravado (texto da IA + reply) sempre troca pelo que saiu de fato
    const r = await deliver(db, { botId: bot.id, channel, conversationId: convId, kind: "ia", record: answerId ? { update: answerId, ...(out !== raw || reply ? { content: out } : {}) } : null, transport: () => io.send(out, adultButton ? "adulto" : undefined) });
    if (r.status === "blocked") return;
  }
  // a conversa seguiu: a pergunta de 18+ fecha (só depois do envio; no reprocesso ela ainda vale).
  // Com o botão "Ver opções 18+", esta pergunta fica guardada para depois do "Sim" (a idade ainda
  // não foi perguntada, então "sim" digitado não conta)
  if (adultButton) await db.from("conversations").update({ age_pending_question: question.slice(0, 2000), age_pending_reply_enc: null, age_asked_at: null, regulated_at: new Date().toISOString() }).eq("id", convId);
  else if (pending?.question) await db.from("conversations").update({ age_pending_question: null, age_pending_reply_enc: null }).eq("id", convId);
}

/** Conversa com bebida ou remédio: vale enquanto a janela de 24 h da Meta estiver aberta. */
