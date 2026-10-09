/*
 * Fuso do cliente (clients.timezone, migração 0081): a agenda das campanhas e dos lembretes e o
 * aviso de envio entre 20h e 8h. Só as quatro opções do Brasil; o Brasil não tem horário de verão,
 * então o deslocamento de cada uma é fixo. Puro: roda no servidor e no navegador.
 */

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export const CLIENT_TIMEZONES: Array<{ id: string; label: string }> = [
  { id: "America/Sao_Paulo", label: "Brasília" },
  { id: "America/Manaus", label: "Amazonas, MT, MS, RO e RR (-1 h)" },
  { id: "America/Rio_Branco", label: "Acre (-2 h)" },
  { id: "America/Noronha", label: "Fernando de Noronha (+1 h)" },
];

export const isClientTimezone = (tz: unknown): tz is string => CLIENT_TIMEZONES.some((t) => t.id === tz);
const safe = (tz: string | null | undefined) => (isClientTimezone(tz) ? tz : DEFAULT_TIMEZONE);

/** Data e hora de parede num fuso. */
function wall(tz: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: safe(tz), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Diferença do fuso para o UTC naquele instante, em ms (Brasília: -3 h). */
function offsetMs(tz: string, at: Date): number {
  const w = wall(tz, at);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(at.getTime() / 1000) * 1000;
}

/** Hora local (0 a 23) no fuso. */
export const localHour = (tz: string | null | undefined, now = new Date()): number => wall(safe(tz), now).hour;

/** Entre 20h e 8h: "enviar agora" pede confirmação. */
export const isQuietHour = (hour: number): boolean => hour >= 20 || hour < 8;

/** As próximas 8h no fuso (hoje, se ainda não deu 8h; senão, amanhã), em ISO. */
export function nextEightAm(tz: string | null | undefined, now = new Date()): string {
  const zone = safe(tz);
  const w = wall(zone, now);
  const dayShift = w.hour < 8 ? 0 : 1;
  const local = Date.UTC(w.year, w.month - 1, w.day + dayShift, 8, 0, 0);
  return new Date(local - offsetMs(zone, now)).toISOString();
}

/** "2026-10-09T14:30" (campo datetime-local) lido no fuso do cliente, em ISO; null se inválido. */
export function localInputToIso(value: string, tz: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const zone = safe(tz);
  const local = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (Number.isNaN(local)) return null;
  return new Date(local - offsetMs(zone, new Date(local))).toISOString();
}

/** Data e hora para mostrar no fuso do cliente ("09/10/2026 08:00"). */
export const formatInZone = (iso: string, tz: string | null | undefined) => new Date(iso).toLocaleString("pt-BR", { timeZone: safe(tz), dateStyle: "short", timeStyle: "short" });
