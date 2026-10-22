import type { SupabaseClient } from "@supabase/supabase-js";
import { handoffOrder, handoffStatus, type HandoffState } from "./handoff-status";
import { nextOpening, type BusinessHours } from "./handoff-hours";
import { contactLabels } from "./contacts";
import { lastMessagesOf, type LastMessage } from "./messages";
import type { Sector } from "./sectors";
import { isSnoozed } from "./snooze";
import { apiPauseActive } from "./presence";

/*
 * Caixa de entrada (parte 3; spec, Peça 11 e Telas seção 6): o atendimento humano aberto, em filas.
 * Minhas (o que é seu, assumido ou entregue pelo rodízio), Não atribuídas, cada setor, Fora do
 * horário (pedidos que chegaram com a equipe fora), Adiadas (parte 4: saem das outras filas até a
 * data, ou até o contato escrever) e Todas. Quem vê o quê: a conversa sem setor aparece para todos do
 * escopo; a do setor, para as pessoas do setor e para quem está com ela. Quem configura (dono,
 * administrador, editor e gestor da área do cliente) vê todos os setores só com a opção ligada na
 * aba Setores do cliente (clients.managers_see_all_sectors, decisão do usuário em 21/10/2026).
 */

/**
 * Os clientes em que a pessoa vê todos os setores: quem configura, nos clientes com a opção ligada.
 * Pura.
 */
export function seeAllSectorsIn(canConfigure: boolean, clients: Array<{ id: string; managers_see_all_sectors?: boolean | null }>): Set<string> {
  return new Set(canConfigure ? clients.filter((c) => c.managers_see_all_sectors).map((c) => c.id) : []);
}

/** As filas de setor que a pessoa vê: os setores dela e os dos clientes em que vê todos. Pura. */
export const visibleSectors = (sectors: Sector[], o: { mySectorIds: string[]; seeAllSectors: Set<string> }): Sector[] => sectors.filter((s) => o.seeAllSectors.has(s.clientId) || o.mySectorIds.includes(s.id));

export type Queue = "minhas" | "nao_atribuidas" | "fora" | "adiadas" | "chamados" | "todas" | "com_ia" | `setor:${string}`;
export const BASE_QUEUES: Array<{ key: Queue; label: string }> = [
  { key: "minhas", label: "Minhas" },
  { key: "nao_atribuidas", label: "Não atribuídas" },
  { key: "fora", label: "Fora do horário" },
  { key: "adiadas", label: "Adiadas" },
  { key: "chamados", label: "Chamados" },
  { key: "todas", label: "Todas abertas" },
  { key: "com_ia", label: "Com a IA" },
];

export const isQueue = (v: unknown): v is Queue => typeof v === "string" && (["minhas", "nao_atribuidas", "fora", "adiadas", "chamados", "todas", "com_ia"].includes(v) || /^setor:[0-9a-f-]{36}$/i.test(v));

/** Com a IA: o contato escreveu nas últimas 24 horas e ninguém da equipe está com a conversa. */
export const AI_QUEUE_HOURS = 24;

export interface InboxBot {
  id: string;
  name: string;
  client_name: string;
  client_id: string | null;
  human_handoff?: { hours?: BusinessHours | null } | null;
  sensitive_mode?: boolean | null;
  /** a cor e o rosto do chatbot (na lista) */
  appearance?: { color?: string | null } | null;
  face?: unknown;
}

export interface InboxItem {
  id: string;
  botId: string;
  botName: string;
  clientName: string;
  clientId: string | null;
  channel: string;
  contactId: string | null;
  contact: string | null;
  sectorId: string | null;
  sectorName: string | null;
  assignedId: string | null;
  assignedName: string | null;
  /** com_ia: a IA está respondendo (fila Com a IA, fora das outras). */
  state: HandoffState | "com_ia";
  /** Com a IA, mas pausada pela integração (API) até agora. */
  aiPaused?: boolean;
  /** Chamado do chat do site (parte 7a): o protocolo e o status. */
  ticketProtocol?: string | null;
  ticketStatus?: string | null;
  urgent: boolean;
  waiting: boolean;
  /** Desde quando espera: o pedido de atendente, ou a última mensagem do contato sem resposta. */
  since: string;
  requestedAt: string | null;
  outsideHours: boolean;
  /** Adiada agora: até quando (fila Adiadas). */
  snoozedUntil: string | null;
  /** O adiamento acabou (a data passou ou o contato escreveu) e ninguém mexeu ainda. */
  snoozeEnded: boolean;
  /** A cor do chatbot (redesenho: o rosto ao lado do contato). */
  botColor?: string | null;
  botFace?: unknown;
  /** O começo da última mensagem (fora do modo sensível, que pede o segundo fator). */
  last?: LastMessage | null;
}

const OPEN_DAYS = 30;

interface Row {
  id: string;
  bot_id: string;
  channel: string | null;
  contact_id: string | null;
  sector_id: string | null;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  handoff_requested_at: string | null;
  takeover_at: string | null;
  handled_at: string | null;
  handoff_urgent_at: string | null;
  last_contact_at: string | null;
  last_reply_at: string | null;
  last_message_at: string;
  ai_paused_until?: string | null;
  ticket_protocol?: string | null;
  ticket_status?: string | null;
  assigned_at?: string | null;
  snoozed_until?: string | null;
  snoozed_at?: string | null;
}

/** A pessoa vê esta conversa na Caixa de entrada? Pura. */
export function visibleTo(r: Pick<Row, "sector_id" | "assigned_to_id">, o: { meId: string; mySectorIds: string[]; allSectors: boolean }): boolean {
  if (o.allSectors || !r.sector_id || r.assigned_to_id === o.meId) return true;
  return o.mySectorIds.includes(r.sector_id);
}

/** A conversa está nesta fila? Pura. */
export function inQueue(i: InboxItem, q: Queue, meId: string): boolean {
  // com a IA: só na fila Com a IA (fora das contagens do atendimento)
  if (q === "com_ia" || i.state === "com_ia") return q === "com_ia" && i.state === "com_ia";
  // adiada: só na fila Adiadas, até voltar
  if (q === "adiadas" || i.snoozedUntil) return q === "adiadas" && Boolean(i.snoozedUntil);
  if (q === "todas") return true;
  if (q === "chamados") return Boolean(i.ticketProtocol);
  if (q === "minhas") return i.assignedId === meId;
  if (q === "nao_atribuidas") return !i.assignedId;
  if (q === "fora") return i.outsideHours;
  return i.sectorId === q.slice("setor:".length);
}

/**
 * As conversas abertas da Caixa de entrada (últimos 30 dias), já com o que cada pessoa vê, em
 * ordem: urgente primeiro, depois quem espera há mais tempo, depois as em atendimento. No fim, as da
 * fila Com a IA (o contato escreveu nas últimas 24 horas e ninguém da equipe está com a conversa), da
 * mais recente para a mais antiga; elas não entram nas outras filas.
 */
export async function loadInbox(db: SupabaseClient, o: { bots: InboxBot[]; sectors: Sector[]; holidays: Map<string, string[]>; meId: string; mySectorIds: string[]; seeAllSectors: Set<string>; now?: Date }): Promise<InboxItem[]> {
  if (!o.bots.length) return [];
  const now = o.now ?? new Date();
  const cols = "id, bot_id, channel, contact_id, sector_id, assigned_to_id, assigned_to_name, handoff_requested_at, takeover_at, handled_at, handoff_urgent_at, last_contact_at, last_reply_at, last_message_at, assigned_at, snoozed_until, snoozed_at, ai_paused_until, ticket_protocol, ticket_status";
  const botIds = o.bots.map((b) => b.id);
  const [{ data, error }, { data: aiData }] = await Promise.all([
    db
      .from("conversations")
      .select(cols)
      .in("bot_id", botIds)
      .or("handoff_requested_at.not.is.null,takeover_at.not.is.null")
      .is("handled_at", null)
      .gte("last_message_at", new Date(now.getTime() - OPEN_DAYS * 86_400_000).toISOString())
      .order("last_message_at", { ascending: false })
      .limit(300),
    // Com a IA: o contato escreveu nas últimas 24 horas (só os canais de verdade, sem o teste do painel)
    db
      .from("conversations")
      .select(cols)
      .in("bot_id", botIds)
      .in("channel", ["whatsapp", "instagram", "widget"])
      .gte("last_contact_at", new Date(now.getTime() - AI_QUEUE_HOURS * 3_600_000).toISOString())
      .order("last_contact_at", { ascending: false })
      .limit(200),
  ]);
  if (error) throw new Error(`caixa de entrada: ${error.message}`);
  const bots = new Map(o.bots.map((b) => [b.id, b]));
  // quem vê todos os setores é por cliente (a opção da aba Setores)
  const sees = (r: Row) => visibleTo(r, { ...o, allSectors: o.seeAllSectors.has(bots.get(r.bot_id)?.client_id ?? "") });
  const rows = ((data ?? []) as Row[]).filter(sees).sort((a, b) => handoffOrder(a, b, now.getTime()));
  // sem atendimento aberto: a IA é quem responde (o que tem pedido ou alguém da equipe já está na outra lista)
  const aiRows = ((aiData ?? []) as Row[]).filter((r) => (r.handled_at || (!r.handoff_requested_at && !r.takeover_at)) && sees(r));
  const sectors = new Map(o.sectors.map((s) => [s.id, s]));
  const names = await contactLabels(db, [...rows, ...aiRows].map((r) => r.contact_id ?? "")).catch(() => new Map<string, string>());
  const aiItems: InboxItem[] = aiRows.flatMap((r) => {
    const bot = bots.get(r.bot_id);
    if (!bot) return [];
    return [{
      id: r.id,
      botId: r.bot_id,
      botName: bot.name,
      clientName: bot.client_name,
      clientId: bot.client_id,
      channel: r.channel ?? "widget",
      contactId: r.contact_id,
      contact: r.contact_id ? (names.get(r.contact_id) ?? null) : null,
      sectorId: r.sector_id,
      sectorName: r.sector_id ? (sectors.get(r.sector_id)?.name ?? null) : null,
      assignedId: null,
      assignedName: null,
      state: "com_ia" as const,
      aiPaused: apiPauseActive(r.ai_paused_until, now.getTime()),
      urgent: false,
      waiting: false,
      since: r.last_contact_at ?? r.last_message_at,
      requestedAt: null,
      outsideHours: false,
      snoozedUntil: null,
      snoozeEnded: false,
    }];
  });
  const items: InboxItem[] = [...rows.flatMap((r) => {
    const st = handoffStatus(r, now.getTime());
    const bot = bots.get(r.bot_id);
    if (!st || !bot) return [];
    const sector = r.sector_id ? sectors.get(r.sector_id) : undefined;
    const snoozed = isSnoozed(r, now.getTime());
    // fora do horário: o pedido chegou com a equipe fora (horário do setor, senão o do chatbot; feriados do cliente)
    const hours = sector?.hours ?? bot.human_handoff?.hours ?? null;
    const outsideHours = Boolean(r.handoff_requested_at) && !r.takeover_at && nextOpening(hours, new Date(r.handoff_requested_at!), o.holidays.get(bot.client_id ?? "") ?? []) !== null;
    return [{
      id: r.id,
      botId: r.bot_id,
      botName: bot.name,
      clientName: bot.client_name,
      clientId: bot.client_id,
      channel: r.channel ?? "widget",
      contactId: r.contact_id,
      contact: r.contact_id ? (names.get(r.contact_id) ?? null) : null,
      sectorId: r.sector_id,
      sectorName: sector?.name ?? null,
      assignedId: r.assigned_to_id,
      assignedName: r.assigned_to_name,
      state: st.state,
      urgent: st.urgent,
      waiting: st.waiting,
      // em atendimento: desde que chegou a quem está com ela (assumiu ou recebeu na transferência)
      since: (st.state === "em_atendimento" ? (r.assigned_at ?? r.takeover_at) : r.handoff_requested_at ?? r.last_contact_at) ?? r.last_message_at,
      requestedAt: r.handoff_requested_at,
      outsideHours,
      ticketProtocol: r.ticket_protocol ?? null,
      ticketStatus: r.ticket_status ?? null,
      snoozedUntil: snoozed ? r.snoozed_until! : null,
      snoozeEnded: Boolean(r.snoozed_until) && !snoozed,
    }];
  }), ...aiItems];
  // redesenho, etapa 2: o começo da última mensagem e a cor do chatbot; no modo sensível, o texto
  // só aparece depois do segundo fator, na conversa
  const open = items.filter((i) => !bots.get(i.botId)?.sensitive_mode).map((i) => i.id);
  const last = await lastMessagesOf(db, open).catch(() => new Map<string, LastMessage>());
  return items.map((i) => ({ ...i, botColor: bots.get(i.botId)?.appearance?.color ?? null, botFace: bots.get(i.botId)?.face ?? null, last: last.get(i.id) ?? null }));
}

/** Quantas conversas em cada fila (o número ao lado do nome). Pura. */
export function queueCounts(items: InboxItem[], queues: Queue[], meId: string): Record<string, number> {
  return Object.fromEntries(queues.map((q) => [q, items.filter((i) => inQueue(i, q, meId)).length]));
}

/** O tempo de espera curto para a lista: "4 min", "2 h", "3 d". Pura. */
export function waitLabel(since: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(since)) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;
}
