/**
 * Presença do visitante e estado da conversa, calculados na hora (nada de job para "encerrar").
 *
 *  - online: o widget deu sinal nos últimos ONLINE_SECONDS (ele manda a cada ~30 s com o
 *    chat aberto no site);
 *  - encerrada: sem mensagem há mais de IDLE_MINUTES. Se o visitante voltar e escrever,
 *    a mesma conversa volta a ficar ativa (ela continua depois do F5 por RESUME_HOURS).
 */
export const ONLINE_SECONDS = 75;
export const IDLE_MINUTES = 30;
/** Até quando o widget retoma a conversa depois de recarregar a página. */
export const RESUME_HOURS = 6;

export interface PresenceInput {
  last_message_at: string;
  visitor_seen_at?: string | null;
  channel?: string | null;
  /**
   * Última mensagem do próprio contato: é dela que o WhatsApp conta a janela de 24 h.
   * null = ele nunca escreveu (conversa aberta por nós com modelo); ausente = não sabemos.
   */
  last_user_at?: string | null;
}

export type ConversationState = "online" | "active" | "closed";

export function conversationState(c: PresenceInput, now = Date.now()): ConversationState {
  if (c.visitor_seen_at && now - new Date(c.visitor_seen_at).getTime() < ONLINE_SECONDS * 1000) return "online";
  if (now - new Date(c.last_message_at).getTime() < IDLE_MINUTES * 60_000) return "active";
  return "closed";
}

/** A conversa ainda pode ser retomada pelo widget (F5, voltar ao site)? */
export function isResumable(lastMessageAt: string, now = Date.now()): boolean {
  return now - new Date(lastMessageAt).getTime() < RESUME_HOURS * 3_600_000;
}

/** Última vez que o visitante esteve por lá (sinal do widget ou última mensagem). */
export function lastSeen(c: PresenceInput): string {
  if (!c.visitor_seen_at) return c.last_message_at;
  return new Date(c.visitor_seen_at) > new Date(c.last_message_at) ? c.visitor_seen_at : c.last_message_at;
}

/** No WhatsApp a Meta deixa responder até 24 h depois da última mensagem do cliente. */
export const WHATSAPP_WINDOW_HOURS = 24;

/**
 * Dá para assumir (de novo, inclusive depois de encerrar) enquanto a pessoa ainda pode ver a
 * resposta: no site, online agora ou falou há menos de IDLE_MINUTES; no WhatsApp, dentro das 24 h.
 */
export function canTakeOver(c: PresenceInput, now = Date.now()): boolean {
  if (c.channel === "whatsapp") return whatsappWindowOpen(c, now);
  const idle = (now - new Date(c.last_message_at).getTime()) / 60_000;
  return conversationState(c, now) === "online" || idle < IDLE_MINUTES;
}

/** Ainda dá para mandar texto livre no WhatsApp? (senão, só modelo aprovado) */
export function whatsappWindowOpen(c: PresenceInput, now = Date.now()): boolean {
  if (c.last_user_at === null) return false;
  const from = c.last_user_at ?? c.last_message_at;
  return now - new Date(from).getTime() < WHATSAPP_WINDOW_HOURS * 3_600_000;
}
