/*
 * Situação do atendimento humano numa conversa, para as listas do painel e do portal (L1, tela
 * Conversa): aguardando (pediu atendente), em atendimento (alguém assumiu), "assumida, sem
 * resposta" (assumida, e a última fala do contato está sem resposta há mais de 1 hora: volta para
 * aguardando, sem devolver para a IA) e o destaque de urgência (risco à vida). Função pura.
 */

export interface HandoffFields {
  handoff_requested_at?: string | null;
  takeover_at?: string | null;
  handled_at?: string | null;
  handoff_urgent_at?: string | null;
  last_contact_at?: string | null;
  last_reply_at?: string | null;
}

export type HandoffState = "aguardando" | "sem_resposta" | "em_atendimento";

/** Assumida e sem resposta por mais que isso: volta para "aguardando". */
export const STALE_TAKEOVER_MS = 60 * 60_000;

export interface HandoffStatus {
  state: HandoffState;
  /** Pedido por risco à vida neste episódio (destacado em vermelho). */
  urgent: boolean;
  /** Esperando a equipe (aparece em "aguardando" e no aviso do painel). */
  waiting: boolean;
}

export function handoffStatus(c: HandoffFields, now = Date.now()): HandoffStatus | null {
  if (c.handled_at) return null;
  if (!c.handoff_requested_at && !c.takeover_at) return null;
  // urgência do pedido atual (um pedido comum depois não herda a marca de um antigo)
  const urgent = Boolean(c.handoff_urgent_at && (!c.handoff_requested_at || c.handoff_urgent_at >= c.handoff_requested_at));
  if (!c.takeover_at) return { state: "aguardando", urgent, waiting: true };
  const unanswered = Boolean(c.last_contact_at && (!c.last_reply_at || c.last_contact_at > c.last_reply_at));
  const stale = unanswered && now - Date.parse(c.last_contact_at!) > STALE_TAKEOVER_MS;
  return stale ? { state: "sem_resposta", urgent, waiting: true } : { state: "em_atendimento", urgent, waiting: false };
}

export const HANDOFF_LABEL: Record<HandoffState, string> = {
  aguardando: "esperando atendente",
  sem_resposta: "assumida, sem resposta",
  em_atendimento: "em atendimento",
};

/** Ordem das listas: urgente primeiro, depois quem espera (o pedido mais antigo antes), depois em atendimento. */
export function handoffOrder(a: HandoffFields, b: HandoffFields, now = Date.now()): number {
  const sa = handoffStatus(a, now);
  const sb = handoffStatus(b, now);
  const rank = (s: HandoffStatus | null) => (!s ? 3 : s.urgent ? 0 : s.waiting ? 1 : 2);
  const diff = rank(sa) - rank(sb);
  if (diff) return diff;
  return (a.handoff_requested_at ?? a.takeover_at ?? "").localeCompare(b.handoff_requested_at ?? b.takeover_at ?? "");
}
