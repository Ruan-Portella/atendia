import type { SupabaseClient } from "@supabase/supabase-js";
import { handoffOrder, handoffStatus, type HandoffState } from "./handoff-status";
import { nextOpening, type BusinessHours } from "./handoff-hours";
import { contactLabels } from "./contacts";
import type { Sector } from "./sectors";

/*
 * Caixa de entrada (parte 3; spec, Peça 11 e Telas seção 6): o atendimento humano aberto, em filas.
 * Minhas (o que é seu, assumido ou entregue pelo rodízio), Não atribuídas, cada setor, Fora do
 * horário (pedidos que chegaram com a equipe fora) e Todas. Quem vê o quê: a conversa sem setor
 * aparece para todos do escopo; a do setor, para as pessoas do setor, para quem está com ela e
 * para quem vê todos os setores (dono, administrador, editor e gestor da área do cliente).
 */

export type Queue = "minhas" | "nao_atribuidas" | "fora" | "todas" | `setor:${string}`;
export const BASE_QUEUES: Array<{ key: Queue; label: string }> = [
  { key: "minhas", label: "Minhas" },
  { key: "nao_atribuidas", label: "Não atribuídas" },
  { key: "fora", label: "Fora do horário" },
  { key: "todas", label: "Todas abertas" },
];

export const isQueue = (v: unknown): v is Queue => typeof v === "string" && (["minhas", "nao_atribuidas", "fora", "todas"].includes(v) || /^setor:[0-9a-f-]{36}$/i.test(v));

export interface InboxBot {
  id: string;
  name: string;
  client_name: string;
  client_id: string | null;
  human_handoff?: { hours?: BusinessHours | null } | null;
  sensitive_mode?: boolean | null;
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
  state: HandoffState;
  urgent: boolean;
  waiting: boolean;
  /** Desde quando espera: o pedido de atendente, ou a última mensagem do contato sem resposta. */
  since: string;
  requestedAt: string | null;
  outsideHours: boolean;
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
}

/** A pessoa vê esta conversa na Caixa de entrada? Pura. */
export function visibleTo(r: Pick<Row, "sector_id" | "assigned_to_id">, o: { meId: string; mySectorIds: string[]; allSectors: boolean }): boolean {
  if (o.allSectors || !r.sector_id || r.assigned_to_id === o.meId) return true;
  return o.mySectorIds.includes(r.sector_id);
}

/** A conversa está nesta fila? Pura. */
export function inQueue(i: InboxItem, q: Queue, meId: string): boolean {
  if (q === "todas") return true;
  if (q === "minhas") return i.assignedId === meId;
  if (q === "nao_atribuidas") return !i.assignedId;
  if (q === "fora") return i.outsideHours;
  return i.sectorId === q.slice("setor:".length);
}

/**
 * As conversas abertas da Caixa de entrada (últimos 30 dias), já com o que cada pessoa vê, em
 * ordem: urgente primeiro, depois quem espera há mais tempo, depois as em atendimento.
 */
export async function loadInbox(db: SupabaseClient, o: { bots: InboxBot[]; sectors: Sector[]; holidays: Map<string, string[]>; meId: string; mySectorIds: string[]; allSectors: boolean; now?: Date }): Promise<InboxItem[]> {
  if (!o.bots.length) return [];
  const now = o.now ?? new Date();
  const { data, error } = await db
    .from("conversations")
    .select("id, bot_id, channel, contact_id, sector_id, assigned_to_id, assigned_to_name, handoff_requested_at, takeover_at, handled_at, handoff_urgent_at, last_contact_at, last_reply_at, last_message_at")
    .in("bot_id", o.bots.map((b) => b.id))
    .or("handoff_requested_at.not.is.null,takeover_at.not.is.null")
    .is("handled_at", null)
    .gte("last_message_at", new Date(now.getTime() - OPEN_DAYS * 86_400_000).toISOString())
    .order("last_message_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(`caixa de entrada: ${error.message}`);
  const rows = ((data ?? []) as Row[]).filter((r) => visibleTo(r, o)).sort((a, b) => handoffOrder(a, b, now.getTime()));
  const bots = new Map(o.bots.map((b) => [b.id, b]));
  const sectors = new Map(o.sectors.map((s) => [s.id, s]));
  const names = await contactLabels(db, rows.map((r) => r.contact_id ?? "")).catch(() => new Map<string, string>());
  return rows.flatMap((r) => {
    const st = handoffStatus(r, now.getTime());
    const bot = bots.get(r.bot_id);
    if (!st || !bot) return [];
    const sector = r.sector_id ? sectors.get(r.sector_id) : undefined;
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
      since: (st.state === "em_atendimento" ? r.takeover_at : r.handoff_requested_at ?? r.last_contact_at) ?? r.last_message_at,
      requestedAt: r.handoff_requested_at,
      outsideHours,
    }];
  });
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
