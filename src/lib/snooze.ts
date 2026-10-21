import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type ActionResult } from "./action-result";
import type { Attendant } from "./authors";
import { DEFAULT_TIMEZONE, atLocal, formatInZone, localInputToIso, wallClock } from "./timezone";

/*
 * Adiar (Caixa de entrada, parte 4): quem está com a conversa tira ela das filas até uma data
 * (fila Adiadas). Volta sozinha na data, ou antes, se o contato escrever. O assistente continua
 * pausado no atendimento em andamento: adiar não devolve para a IA.
 */

export const SNOOZE_MAX_DAYS = 30;
export const SNOOZE_CHOICES = [
  { value: "1h", label: "1 hora" },
  { value: "3h", label: "3 horas" },
  { value: "amanha", label: "Amanhã às 9h" },
  { value: "data", label: "Escolher data e hora" },
] as const;

export interface Snoozable {
  snoozed_until?: string | null;
  snoozed_at?: string | null;
  last_contact_at?: string | null;
}

/** Adiada agora: a data não passou e o contato não escreveu depois de adiar. Pura. */
export function isSnoozed(c: Snoozable, now = Date.now()): boolean {
  if (!c.snoozed_until || Date.parse(c.snoozed_until) <= now) return false;
  return !(c.last_contact_at && c.snoozed_at && Date.parse(c.last_contact_at) > Date.parse(c.snoozed_at));
}

/** A data do formulário (fuso de Brasília): 1 hora, 3 horas, amanhã às 9h ou a data escolhida. Pura. */
export function snoozeTarget(choice: unknown, custom: unknown, now = new Date()): Date | { error: string } {
  let at: number | null = null;
  if (choice === "1h") at = now.getTime() + 3_600_000;
  else if (choice === "3h") at = now.getTime() + 3 * 3_600_000;
  else if (choice === "amanha") {
    const w = wallClock(DEFAULT_TIMEZONE, now);
    at = atLocal(DEFAULT_TIMEZONE, w.year, w.month, w.day + 1, 9);
  } else if (choice === "data") {
    const iso = typeof custom === "string" ? localInputToIso(custom, DEFAULT_TIMEZONE) : null;
    if (!iso) return { error: "Escolha a data e a hora." };
    at = Date.parse(iso);
  } else return { error: "Escolha até quando adiar." };
  if (at < now.getTime() + 5 * 60_000) return { error: "Escolha uma data pelo menos 5 minutos à frente." };
  if (at > now.getTime() + SNOOZE_MAX_DAYS * 86_400_000) return { error: `Dá para adiar até ${SNOOZE_MAX_DAYS} dias.` };
  return new Date(at);
}

const HOLD_COLS = "takeover_at, handled_at, assigned_to_id, assigned_to_name, handoff_requested_at";

/** Adia a conversa: só quem está com ela (ou quem a recebeu e ainda não assumiu). */
export async function snoozeConversation(db: SupabaseClient, conversationId: string, who: Attendant, until: Date, now = new Date()): Promise<ActionResult> {
  const { data: conv } = await db.from("conversations").select(HOLD_COLS).eq("id", conversationId).maybeSingle();
  if (!conv) return fail("Conversa não encontrada.");
  if (conv.handled_at || !(conv.takeover_at || conv.handoff_requested_at)) return fail("Só dá para adiar um atendimento aberto.");
  if (conv.assigned_to_id !== who.id) return fail("Só quem está com a conversa adia. Assuma antes.");
  const { error } = await db.from("conversations").update({ snoozed_until: until.toISOString(), snoozed_at: now.toISOString() }).eq("id", conversationId).eq("assigned_to_id", who.id);
  if (error) return fail("Não foi possível adiar. Tente de novo.");
  return ok(`Adiada até ${formatInZone(until.toISOString(), DEFAULT_TIMEZONE)}. Volta antes se o contato escrever.`);
}

/** Tira do adiamento agora. */
export async function unsnoozeConversation(db: SupabaseClient, conversationId: string, who: Attendant): Promise<ActionResult> {
  const { data, error } = await db.from("conversations").update({ snoozed_until: null, snoozed_at: null }).eq("id", conversationId).eq("assigned_to_id", who.id).select("id");
  if (error) return fail("Não foi possível. Tente de novo.");
  if (!data?.length) return fail("Só quem está com a conversa tira do adiamento.");
  return ok("A conversa voltou para as filas.");
}
