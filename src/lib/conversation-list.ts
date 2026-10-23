import type { SupabaseClient } from "@supabase/supabase-js";
import { handoffStatus } from "./handoff-status";
import { contactLabels, contactPhotoUrl, contactPhotoVersions } from "./contacts";
import { lastMessagesOf, type LastMessage } from "./messages";
import type { InboxBot } from "./inbox";

/*
 * A lista de conversas das abas Conversas do cliente e do chatbot (23/10/2026, a pedido do usuário:
 * "um layout parecido com o da Caixa de entrada"): todas as conversas, não só as do atendimento,
 * com a pessoa, o começo da última mensagem e a situação, da mais recente para a mais antiga.
 */

export type ConversationFilter = "todas" | "esperando" | "whatsapp" | "instagram" | "widget";
export const CONVERSATION_FILTERS: Array<{ key: ConversationFilter; label: string }> = [
  { key: "todas", label: "Todas" },
  { key: "esperando", label: "Com a equipe" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "instagram", label: "Instagram" },
  { key: "widget", label: "Site" },
];
export const isConversationFilter = (v: unknown): v is ConversationFilter => typeof v === "string" && CONVERSATION_FILTERS.some((f) => f.key === v);

export interface ConversationListItem {
  id: string;
  botId: string;
  botName: string;
  botColor: string | null;
  botFace: unknown;
  channel: string;
  contactId: string | null;
  contact: string | null;
  photo: string | null;
  last: LastMessage | null;
  lastAt: string;
  messages: number;
  status: { label: string; tone: "danger" | "amber" | "info" | "brand" | "neutral"; pulse?: boolean };
}

const RECENT_MS = 24 * 3_600_000;

interface Row {
  id: string;
  bot_id: string;
  channel: string | null;
  contact_id: string | null;
  last_message_at: string;
  last_contact_at: string | null;
  message_count: number | null;
  handoff_requested_at: string | null;
  takeover_at: string | null;
  handled_at: string | null;
  handoff_urgent_at: string | null;
  last_reply_at: string | null;
  assigned_to_name: string | null;
}

/** A situação da conversa na lista: o atendimento aberto, a IA (o contato escreveu nas últimas 24 h) ou encerrada. Pura. */
export function listStatus(r: Pick<Row, "handoff_requested_at" | "takeover_at" | "handled_at" | "handoff_urgent_at" | "last_contact_at" | "last_reply_at" | "last_message_at" | "assigned_to_name">, now = Date.now()): ConversationListItem["status"] {
  const st = handoffStatus(r, now);
  if (st?.urgent) return { label: "Urgente", tone: "danger", pulse: true };
  if (st?.state === "aguardando") return { label: "Esperando a equipe", tone: "amber", pulse: true };
  if (st?.state === "sem_resposta") return { label: "Sem resposta há 1 h", tone: "amber" };
  if (st?.state === "em_atendimento") return { label: r.assigned_to_name ? `Com ${r.assigned_to_name}` : "Em atendimento", tone: "info" };
  if (r.last_contact_at && now - Date.parse(r.last_contact_at) < RECENT_MS) return { label: "Com a IA", tone: "brand" };
  return { label: "Encerrada", tone: "neutral" };
}

/** As conversas dos chatbots (o escopo vem de quem consulta: a RLS no painel), com o filtro e, no cliente, o setor. */
export async function loadConversationList(db: SupabaseClient, o: { bots: InboxBot[]; filter: ConversationFilter; limit: number; sectorId?: string | null }): Promise<{ items: ConversationListItem[]; more: boolean }> {
  if (!o.bots.length) return { items: [], more: false };
  const bots = new Map(o.bots.map((b) => [b.id, b]));
  let q = db
    .from("conversations")
    .select("id, bot_id, channel, contact_id, last_message_at, last_contact_at, message_count, handoff_requested_at, takeover_at, handled_at, handoff_urgent_at, last_reply_at, assigned_to_name")
    .in("bot_id", o.bots.map((b) => b.id))
    .gt("message_count", 0);
  if (o.filter === "esperando") q = q.or("handoff_requested_at.not.is.null,takeover_at.not.is.null").is("handled_at", null);
  else if (o.filter !== "todas") q = q.eq("channel", o.filter);
  if (o.sectorId) q = q.eq("sector_id", o.sectorId);
  const { data, error } = await q.order("last_message_at", { ascending: false }).limit(o.limit + 1);
  if (error) throw new Error(`conversas: ${error.message}`);
  const rows = ((data ?? []) as Row[]).slice(0, o.limit);
  const now = Date.now();
  // o texto da última mensagem fica de fora no modo sensível (só na conversa, depois do segundo fator)
  const open = rows.filter((r) => !bots.get(r.bot_id)?.sensitive_mode).map((r) => r.id);
  const [names, last, photos] = await Promise.all([
    contactLabels(db, rows.map((r) => r.contact_id ?? "")).catch(() => new Map<string, string>()),
    lastMessagesOf(db, open).catch(() => new Map<string, LastMessage>()),
    contactPhotoVersions(db, rows.map((r) => r.contact_id ?? "")).catch(() => new Map<string, string>()),
  ]);
  const items = rows.map((r) => {
    const bot = bots.get(r.bot_id);
    return {
      id: r.id,
      botId: r.bot_id,
      botName: bot?.name ?? "",
      botColor: bot?.appearance?.color ?? null,
      botFace: bot?.face ?? null,
      channel: r.channel ?? "widget",
      contactId: r.contact_id,
      contact: r.contact_id ? (names.get(r.contact_id) ?? null) : null,
      photo: r.contact_id ? contactPhotoUrl(r.contact_id, photos.get(r.contact_id)) : null,
      last: last.get(r.id) ?? null,
      lastAt: r.last_message_at,
      messages: r.message_count ?? 0,
      status: listStatus(r, now),
    };
  });
  return { items, more: (data ?? []).length > o.limit };
}
