import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthorType } from "./authors";
import type { MessageComponent } from "./components";
import { decideMode, resolveMode, type Mode, type ModeFacts, type ModeInput } from "./conversation-mode";
import { channelMsgHash } from "./hash";
import { saveMessage, updateMessages, type MessagePatch } from "./messages";

/*
 * Camada única de envio (L1): toda mensagem que sai pelo WhatsApp ou pelo Instagram passa por
 * aqui. Antes de enviar, a regra de estado é calculada de novo, com a conversa, o bot e o canal
 * lidos na hora (a resposta da IA leva segundos: alguém pode ter assumido, pausado o bot ou
 * respondido pelo celular nesse meio-tempo). Depois, a mensagem fica registrada como enviada
 * (com o hash do id do canal, nunca o id em texto), barrada (com o motivo) ou não entregue.
 */

/**
 * Quem está falando:
 *   ia              resposta do assistente e os textos fixos da vez dele (portão, "só entendo texto")
 *   sistema         texto fixo que sai com gente atendendo (risco à vida, opt-out, avisos)
 *   aviso_suspenso  o aviso de canal suspenso (sai uma vez mesmo com o canal suspenso)
 *   equipe          resposta da equipe pelo painel ou pela área do cliente
 *   modelo          modelo aprovado enviado pela equipe
 */
export type SendKind = "ia" | "sistema" | "aviso_suspenso" | "equipe" | "modelo";
export type SendChannel = "whatsapp" | "instagram";

/** Motivo para barrar o envio agora, ou null se pode sair. Função pura. */
export function sendDecision(mode: Pick<Mode, "step" | "canSend" | "aiResponds" | "reason">, facts: ModeFacts, kind: SendKind): string | null {
  if (kind === "aviso_suspenso") return mode.step === 2 || mode.canSend ? null : mode.reason;
  if (!mode.canSend) {
    // a equipe tentar de novo depois da recusa por pagamento é o teste de que o cartão entrou
    if ((kind === "equipe" || kind === "modelo") && facts.metaPaymentIssue && decideMode({ ...facts, metaPaymentIssue: false }).canSend) return null;
    return mode.reason;
  }
  if (kind === "ia" && !mode.aiResponds) return mode.reason;
  return null;
}

/** A regra de estado na hora do envio, com tudo lido de novo do banco. */
export async function sendCheck(db: SupabaseClient, o: { botId: string; channel: SendChannel; conversationId: string | null; kind: SendKind }): Promise<string | null> {
  const [{ data: bot }, { data: conversation }, { data: wa }, { data: ig }] = await Promise.all([
    db.from("bots").select("id, agency_id, paused_at, pause_notify").eq("id", o.botId).maybeSingle(),
    o.conversationId ? db.from("conversations").select("id, takeover_at, handled_at").eq("id", o.conversationId).maybeSingle() : Promise.resolve({ data: null }),
    o.channel === "whatsapp" ? db.from("whatsapp_channels").select("disconnected_at, payment_issue_at, waba_id, coexistence").eq("bot_id", o.botId).maybeSingle() : Promise.resolve({ data: null }),
    o.channel === "instagram" ? db.from("instagram_channels").select("disconnected_at").eq("bot_id", o.botId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!bot) return "chatbot não encontrado";
  const mode = await resolveMode(db, { bot: bot as ModeInput["bot"], channel: o.channel, conversation: conversation as ModeInput["conversation"], wa, ig });
  return sendDecision(mode, mode.facts, o.kind);
}

/** O que gravar na conversa: uma linha nova depois do envio, ou a linha já gravada antes (resposta da IA). */
export type SendRecord =
  | { insert: { role: "assistant" | "agent"; content: string; author: string | null; template_category?: string | null; author_type?: AuthorType | null; author_id?: string | null; author_display_name?: string | null; announce_chars?: number | null; components?: MessageComponent | null } }
  | { update: number; content?: string; announce_chars?: number | null; components?: MessageComponent | null }
  | null;

export type SendOutcome = { status: "sent"; id: string | null } | { status: "blocked"; reason: string };

/** Código do erro do canal, para o painel ("não entregue"). */
const errorCode = (e: unknown) => {
  const code = (e as { code?: unknown })?.code;
  return code !== undefined && code !== null ? String(code) : (e as Error)?.name || "erro";
};

/**
 * Envia pela camada única: confere a regra de estado, chama o canal (`transport`, que devolve o
 * id da mensagem na Meta) e registra o resultado. Barrada: não chama o canal e devolve o motivo.
 * Erro do canal: registra "não entregue" e repassa o erro para quem chamou (acesso, pagamento…).
 * `recordFailures: false` (equipe e modelo): nada é gravado se não sair; quem chamou avisa na tela.
 */
export async function deliver(
  db: SupabaseClient,
  o: { botId: string; channel: SendChannel; conversationId: string | null; kind: SendKind; record: SendRecord; recordFailures?: boolean; transport: () => Promise<string | null> },
): Promise<SendOutcome> {
  const recordFailures = o.recordFailures ?? true;
  const write = async (fields: MessagePatch) => {
    if (!o.record) return;
    try {
      if ("update" in o.record) await updateMessages(db, { id: o.record.update }, { ...fields, ...(o.record.content !== undefined ? { content: o.record.content } : {}), ...(o.record.announce_chars !== undefined ? { announce_chars: o.record.announce_chars } : {}), ...(o.record.components !== undefined ? { components: o.record.components } : {}) });
      else if (o.conversationId) await saveMessage(db, { conversation_id: o.conversationId, ...o.record.insert, ...fields });
    } catch (e) {
      console.error("envio: registro não gravado", (e as Error).message);
    }
  };

  const blocked = await sendCheck(db, o);
  if (blocked) {
    console.warn("envio barrado pela regra de estado", { bot: o.botId, channel: o.channel, kind: o.kind, motivo: blocked });
    if (recordFailures) await write({ blocked_reason: blocked });
    return { status: "blocked", reason: blocked };
  }

  let id: string | null;
  try {
    id = await o.transport();
  } catch (e) {
    if (recordFailures) await write({ failed_at: new Date().toISOString(), error_code: errorCode(e) });
    throw e;
  }
  await write({ channel_msg_id: "enviada", channel_msg_hash: id ? channelMsgHash(o.channel, id) : null });
  return { status: "sent", id };
}
