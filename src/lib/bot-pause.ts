import type { SupabaseClient } from "@supabase/supabase-js";
import { queueBotPauseEvent } from "./platform-events";
import { endBotRoutineRuns } from "./routine-engine";

/*
 * Pausa do dono (o "Pausar no BoaVoz" do botão de emergência), pelo painel ou pela API
 * (POST /v1/bots/{id}/pause e /resume, D' parte 4b): a IA para em todos os canais, os canais
 * continuam conectados e as mensagens continuam gravadas para a equipe responder. Com notify, o
 * contato recebe o texto fixo de indisponível uma vez por conversa. Medidas do BoaVoz e ordens da
 * Meta são outra coisa (enforcement_actions): retomar não mexe nelas.
 *
 * `db` grava a pausa (no painel, o cliente da sessão, com o escopo da pessoa); `admin` emite o
 * webhook e encerra os roteiros em andamento.
 */

export interface PauseResult {
  pausedAt: string;
  /** Já estava pausado: o paused_at é o da pausa que já valia. */
  already: boolean;
}

/** Pausa o chatbot; já pausado devolve a pausa que vale. Chatbot não encontrado: null. */
export async function pauseBotNow(
  db: SupabaseClient,
  admin: SupabaseClient,
  botId: string,
  o: { by: "panel" | "api"; byLabel: string; reason: string | null; notify: boolean },
): Promise<PauseResult | null> {
  const pausedAt = new Date().toISOString();
  const { data, error } = await db.from("bots").update({ paused_at: pausedAt, paused_by: o.byLabel, pause_reason: o.reason, pause_notify: o.notify }).eq("id", botId).is("paused_at", null).select("id");
  if (error) throw new Error(`pausa não gravada: ${error.message}`);
  if (!data?.length) {
    const { data: cur } = await db.from("bots").select("paused_at").eq("id", botId).maybeSingle();
    return cur?.paused_at ? { pausedAt: String(cur.paused_at), already: true } : null;
  }
  // webhooks: bot.paused (o motivo vai como o dono escreveu)
  await queueBotPauseEvent(admin, botId, { paused: true, pausedAt, at: pausedAt, by: o.by, reason: o.reason });
  // roteiros em andamento acabam: a IA parou (B2')
  await endBotRoutineRuns(admin, botId, "handoff");
  return { pausedAt, already: false };
}

/** Tira a pausa do dono. Devolve se estava pausado (e emite bot.resumed só nesse caso). */
export async function resumeBotNow(db: SupabaseClient, admin: SupabaseClient, botId: string, by: "panel" | "api"): Promise<boolean> {
  const { data: before } = await db.from("bots").select("paused_at").eq("id", botId).maybeSingle();
  const { data: resumed, error } = await db.from("bots").update({ paused_at: null, paused_by: null, pause_reason: null, pause_notify: false }).eq("id", botId).not("paused_at", "is", null).select("id");
  if (error) throw new Error(`pausa não tirada: ${error.message}`);
  // a chave do evento é a pausa que terminou
  if (resumed?.length && before?.paused_at) await queueBotPauseEvent(admin, botId, { paused: false, pausedAt: String(before.paused_at), at: new Date().toISOString(), by });
  return Boolean(resumed?.length);
}
