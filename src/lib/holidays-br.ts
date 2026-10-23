/*
 * Os feriados nacionais do Brasil, para sugerir nos Setores do cliente (rodada 2 das telas,
 * 23/10/2026, a pedido do usuário: "só recomendação"). Os de data fixa valem todo ano (dia/mês); a
 * Sexta-feira Santa muda com a Páscoa e entra com o ano. Carnaval e Corpus Christi são ponto
 * facultativo, não feriado nacional, e ficam de fora.
 */

export interface HolidaySuggestion {
  /** 25/12 (todo ano) ou 03/04/2026 (só nesse dia), no formato do campo de feriados */
  date: string;
  name: string;
}

export const FIXED_NATIONAL_HOLIDAYS: HolidaySuggestion[] = [
  { date: "01/01", name: "Confraternização Universal" },
  { date: "21/04", name: "Tiradentes" },
  { date: "01/05", name: "Dia do Trabalho" },
  { date: "07/09", name: "Independência" },
  { date: "12/10", name: "Nossa Senhora Aparecida" },
  { date: "02/11", name: "Finados" },
  { date: "15/11", name: "Proclamação da República" },
  { date: "20/11", name: "Consciência Negra" },
  { date: "25/12", name: "Natal" },
];

/** O domingo de Páscoa do ano (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). Pura. */
export function easterSunday(year: number): { day: number; month: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { day, month };
}

const two = (n: number) => String(n).padStart(2, "0");

/** A próxima Sexta-feira Santa a partir de hoje (a deste ano, ou a do ano que vem se já passou). Pura. */
export function nextGoodFriday(today: Date): HolidaySuggestion {
  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    const { day, month } = easterSunday(year);
    const friday = new Date(year, month - 1, day - 2);
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (friday >= start || year > today.getFullYear()) return { date: `${two(friday.getDate())}/${two(friday.getMonth() + 1)}/${friday.getFullYear()}`, name: "Sexta-feira Santa" };
  }
  throw new Error("inalcançável");
}

/** Os feriados nacionais para sugerir: os de data fixa e a próxima Sexta-feira Santa. Pura. */
export function nationalHolidays(today: Date): HolidaySuggestion[] {
  return [...FIXED_NATIONAL_HOLIDAYS, nextGoodFriday(today)];
}
