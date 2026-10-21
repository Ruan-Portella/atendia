import type { SupabaseClient } from "@supabase/supabase-js";
import { audioDurationSeconds } from "./audio-duration";
import { firstExceeded, noticeOnce } from "./rate-limit";

/*
 * Limites de áudio por contato (spec, Limites por plano; leva Pendências do MVP, parte 1): até
 * cerca de 5 minutos por áudio, conferido antes de transcrever, e até 30 áudios transcritos por dia
 * por contato. Acima disso a mensagem fica como "[áudio longo]" (a equipe ouve no painel) e o bot
 * pede uma vez por dia um resumo em texto ou um áudio mais curto. A conta do preço supõe no máximo
 * 5 minutos de áudio por atendimento.
 */

/** 5 minutos, com uma folga pequena ("cerca de"). */
export const AUDIO_MAX_SECONDS = 310;
export const AUDIOS_PER_DAY = 30;
/** Sem duração legível no arquivo (formato desconhecido): o tamanho decide (5 minutos de áudio de celular cabem em ~3 MB). */
export const AUDIO_UNKNOWN_MAX_BYTES = 5 * 1024 * 1024;
export const LONG_AUDIO_LABEL = "🎤 [áudio longo]";
export const LONG_AUDIO_ASK = "Esse áudio ficou longo demais para eu ouvir por aqui. Pode mandar um resumo por escrito ou um áudio mais curto?";

/** O áudio passa do limite de duração? Função pura. */
export function audioTooLong(data: Uint8Array): boolean {
  const seconds = audioDurationSeconds(data);
  return seconds === null ? data.byteLength > AUDIO_UNKNOWN_MAX_BYTES : seconds > AUDIO_MAX_SECONDS;
}

/**
 * Pode transcrever este áudio? null = sim (e conta um dos 30 do dia); "longo" ou "dia" = não. A
 * chave é do chatbot e do contato (o mesmo contato em dois chatbots conta em cada um).
 */
export async function audioLimit(db: SupabaseClient, key: string, data: Uint8Array): Promise<"longo" | "dia" | null> {
  if (audioTooLong(data)) return "longo";
  const day = await firstExceeded(db, [{ key: `audio:${key}:d`, max: AUDIOS_PER_DAY, windowSeconds: 86_400, message: LONG_AUDIO_ASK }]);
  return day ? "dia" : null;
}

/** O pedido de resumo vai uma vez por dia por contato (depois, o áudio longo só fica no painel). */
export const longAudioAskDue = (db: SupabaseClient, key: string) => noticeOnce(db, { key: `audio:${key}:longo`, max: 1, windowSeconds: 86_400, message: LONG_AUDIO_ASK });
