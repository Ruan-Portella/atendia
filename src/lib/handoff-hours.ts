/*
 * Caminho para humano (Peça 10): o pedido de atendente no chat está sempre ligado; o cliente
 * pode informar outros contatos e um horário de atendimento. Fora do horário, o pedido é
 * registrado e o bot diz quando a equipe volta. Nunca promete resposta imediata.
 */

/** Horário por dia da semana (0 = domingo), em Brasília: ["09:00", "18:00"]. Dia ausente = fechado. */
export type BusinessHours = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", [string, string]>>;

export interface HumanHandoff {
  email?: string | null;
  phone?: string | null;
  site?: string | null;
  address?: string | null;
  form_url?: string | null;
  hours?: BusinessHours | null;
}

export const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;

const TZ_OFFSET_MIN = -180; // Brasília, sem horário de verão desde 2019

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Dia da semana e minuto do dia em Brasília. */
function brasilia(now: Date): { day: number; minute: number } {
  const local = new Date(now.getTime() + TZ_OFFSET_MIN * 60_000);
  return { day: local.getUTCDay(), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

export function hasHours(hours: BusinessHours | null | undefined): hours is BusinessHours {
  return Boolean(hours && Object.values(hours).some((h) => h && h[0] && h[1]));
}

/**
 * Quando a equipe volta: null se está no horário agora (ou sem horário configurado); senão,
 * o dia (0 a 6, a partir de hoje) e o horário da próxima abertura.
 */
export function nextOpening(hours: BusinessHours | null | undefined, now = new Date()): { inDays: number; day: number; time: string; until: string } | null {
  if (!hasHours(hours)) return null;
  const { day, minute } = brasilia(now);
  const today = hours[String(day) as keyof BusinessHours];
  if (today && minute >= minutesOf(today[0]) && minute < minutesOf(today[1])) return null;
  for (let inDays = 0; inDays <= 7; inDays++) {
    const d = (day + inDays) % 7;
    const h = hours[String(d) as keyof BusinessHours];
    if (!h) continue;
    if (inDays === 0 && minute >= minutesOf(h[0])) continue; // hoje já abriu (e fechou)
    return { inDays, day: d, time: h[0], until: h[1] };
  }
  return null;
}

/** "09:30" vira "9h30"; "09:00" vira "9h". */
const hourLabel = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h}h${m ? String(m).padStart(2, "0") : ""}`;
};

/**
 * "hoje, das 14h às 18h", "amanhã, das 9h às 18h", "segunda, das 9h30 às 12h"; o mesmo dia da
 * semana que vem vira "na próxima quinta" (só "quinta", numa quinta, pareceria hoje).
 */
export function whenLabel(o: { inDays: number; day: number; time: string; until: string }): string {
  const day = o.inDays === 0 ? "hoje" : o.inDays === 1 ? "amanhã" : o.inDays === 7 ? `${o.day === 0 || o.day === 6 ? "no próximo" : "na próxima"} ${WEEKDAYS[o.day]}` : WEEKDAYS[o.day];
  return `${day}, das ${hourLabel(o.time)} às ${hourLabel(o.until)}`;
}

/** Texto que o bot usa ao registrar o pedido de atendente (padrão editável no documento). */
export function handoffNotice(hours: BusinessHours | null | undefined, now = new Date()): string {
  const next = nextOpening(hours, now);
  return next
    ? `Nossa equipe volta ${whenLabel(next)}. Deixei seu pedido registrado e respondemos assim que possível.`
    : "Deixei seu pedido registrado e nossa equipe responde assim que possível.";
}

/** Os outros contatos, para o prompt ("ofereça quando pedirem para falar com alguém"). */
export function contactLines(h: HumanHandoff | null | undefined): string[] {
  if (!h) return [];
  return [
    h.phone && `telefone ${h.phone}`,
    h.email && `e-mail ${h.email}`,
    h.site && `site ${h.site}`,
    h.form_url && `formulário de atendimento ${h.form_url}`,
    h.address && `atendimento presencial em ${h.address}`,
  ].filter(Boolean) as string[];
}

/** Horário em texto, para o prompt ("segunda a sexta, 9h às 18h" vira uma linha por dia). */
export function hoursLines(hours: BusinessHours | null | undefined): string[] {
  if (!hasHours(hours)) return [];
  return WEEKDAYS.map((name, d) => {
    const h = hours[String(d) as keyof BusinessHours];
    return h ? `${name}: ${h[0]} às ${h[1]}` : `${name}: fechado`;
  });
}
