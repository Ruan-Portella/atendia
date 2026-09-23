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
