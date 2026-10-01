import type { UIMessage } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SYSTEM_AUTHOR, aiDisclosure, conversationHistory, retrieveContext, runChat, withRiskText, type BotRow } from "../chat";
import { storeOnce } from "../whatsapp-inbound";
import { AGE_IGNORED_HOURS, AGE_NO, AGE_YES, getAge, setAge, type AgeStatus } from "./age";
import { decideEntrance } from "./entrance";
import { normalizeGateText } from "./match";
import { GATE_TEXTS, RULES_VERSION, type GateCategory } from "./rules";

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
}

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
export async function logGate(db: SupabaseClient, row: { botId: string; conversationId: string | null; stage: "entrada" | "saida"; decision: string; categories: GateCategory[] }) {
  const { error } = await db.from("gate_detections").insert({ bot_id: row.botId, conversation_id: row.conversationId, stage: row.stage, decision: row.decision, categories: row.categories, rules_version: RULES_VERSION });
  if (error) console.error("portão: registro não gravado", error.message);
}

export interface GateIO {
  db: SupabaseClient;
  bot: BotRow;
  channel: "whatsapp" | "instagram";
  /** Telefone (WhatsApp) ou IGSID (Instagram). */
  contact: string;
  conversationId: string;
  /** Envia ao contato; com ageButtons, vai com os botões Sim e Não. Devolve o id da mensagem no canal. */
  send: (text: string, ageButtons?: boolean) => Promise<string | null>;
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

  /** Texto fixo do sistema: vai ao contato e fica no painel (o aviso de IA não conta esse). */
  const sendFixed = async (text: string, ageButtons = false) => {
    const mid = await io.send(text, ageButtons);
    await db.from("messages").insert({ conversation_id: convId, role: "assistant", content: text, author: SYSTEM_AUTHOR, channel_msg_id: mid ?? "enviada" });
  };
  const askAge = async (question: string) => {
    await sendFixed(GATE_TEXTS.ageQuestion, true);
    const now = new Date().toISOString();
    await db.from("conversations").update({ age_pending_question: question.slice(0, 2000), age_asked_at: now, regulated_at: now }).eq("id", convId);
  };

  // 1. resposta da pergunta de 18+
  const { data: pendingRow } = await db.from("conversations").select("age_pending_question, age_asked_at").eq("id", convId).maybeSingle();
  const pending: PendingAge | null = pendingRow ? { question: (pendingRow.age_pending_question as string | null) ?? null, askedAt: (pendingRow.age_asked_at as string | null) ?? null } : null;
  const answered = ageAnswer(q.text, q.button, pending);
  let question = q.text;
  let storeQuestion = true;
  let history: UIMessage[];
  if (answered) {
    await storeOnce(db, convId, q.text, q.key);
    await setAge(db, who, answered, "chat");
    if (answered === "nao") {
      await db.from("conversations").update({ age_pending_question: null }).eq("id", convId);
      await sendFixed(GATE_TEXTS.ageDenied);
      await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: "nao_18", categories: [] });
      return;
    }
    storeQuestion = false;
    history = await conversationHistory(db, convId, io.historySize);
    // "Sim": a IA responde agora à pergunta que ficou esperando (sem pergunta guardada, ao "Sim")
    if (pending?.question) {
      question = pending.question;
      history = historyUpTo(history, question);
    }
  } else {
    history = await conversationHistory(db, convId, io.historySize);
    // no reprocesso a pergunta já está no banco, então já vem no histórico
    if (!q.stored) history.push({ id: q.msgId, role: "user", parts: [{ type: "text", text: q.text }] });
  }

  // 2. portão da entrada (o "Não" sempre vence: a idade é lida de novo depois do setAge)
  const age: AgeStatus = await getAge(db, who);
  const retrieval = await retrieveContext(db, bot.id, question);
  const entrance = await decideEntrance({ text: question, channel, contactPhone, age, context: retrieval.context, companyName: bot.client_name });
  if (entrance.kind === "proibido") {
    await storeOnce(db, convId, q.text, q.key);
    await sendFixed(GATE_TEXTS.prohibited);
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

  // 3. IA (aviso de IA calculado antes de a resposta nova entrar na conversa)
  const disclosure = await aiDisclosure(db, bot, convId);
  const { result, saved, urgent, askAge: aiAskedAge } = await runChat({
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
    gate: { age, instruction: entrance.instruction, remind: entrance.regulated.length > 0 || entrance.prohibited.length > 0 },
  });
  const raw = await result.text;
  const answerId = await saved;
  // a IA pediu a confirmação de 18+: a pergunta fixa com botões vai no lugar da resposta
  // (risco à vida vem antes: aí a resposta com os telefones sai de qualquer jeito)
  if (aiAskedAge() && age === null && !urgent()) {
    if (answerId) await db.from("messages").delete().eq("id", answerId);
    await askAge(question);
    await logGate(db, { botId: bot.id, conversationId: convId, stage: "entrada", decision: "pede_18", categories: entrance.regulated });
    return;
  }
  let answer = withRiskText(raw, urgent()).trim();
  if (answer) {
    // item proibido junto com outro assunto: o aviso fixo vai antes, na mesma mensagem
    if (entrance.prefix) answer = `${entrance.prefix}\n\n${answer}`;
    const out = disclosure ? `${disclosure}\n\n${answer}` : answer;
    const mid = await io.send(out);
    if (answerId) await db.from("messages").update({ channel_msg_id: mid ?? "enviada", ...(out !== raw ? { content: out } : {}) }).eq("id", answerId);
  }
  // a conversa seguiu: a pergunta de 18+ fecha (só depois do envio; no reprocesso ela ainda vale)
  if (pending?.question) await db.from("conversations").update({ age_pending_question: null }).eq("id", convId);
}
