import { canonicalPhone } from "./phone";
import { headerKey, parseCsv, parseSheetDate } from "./contact-import";
import { localInputToIso } from "./timezone";

/*
 * Planilha de lembretes de utilidade (leva B3, parte 5; spec Peça 7): uma linha = um envio, com o
 * telefone, a data e a hora (lidas no fuso do cliente) e as variáveis do modelo. A mesma pessoa
 * pode ter dois lembretes em horários diferentes. Linha fora de 8h a 20h recebe aviso, sem
 * bloquear. Tudo aqui é puro: o navegador mostra a prévia, e o servidor confere de novo.
 */

export const REMINDER_MAX_ROWS = 2000;
/** Até quantos dias à frente dá para agendar. */
export const REMINDER_MAX_DAYS = 90;

export interface RawReminderRow {
  line: number;
  phone: string;
  name: string;
  date: string;
  time: string;
  vars: string[];
}

const FIELDS: Record<string, "phone" | "name" | "date" | "time"> = {
  telefone: "phone",
  celular: "phone",
  whatsapp: "phone",
  fone: "phone",
  numero: "phone",
  nome: "name",
  data: "date",
  dia: "date",
  data_do_lembrete: "date",
  hora: "time",
  horario: "time",
  hora_do_lembrete: "time",
};

/** variavel1, variavel_1, var1, v1, {{1}} → 1. */
function varIndex(key: string): number | null {
  const m = /^(?:variavel|var|v)_?(\d{1,2})$/.exec(key) ?? /^(\d{1,2})$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** Linhas da planilha pelo cabeçalho (a linha conta como na planilha: o cabeçalho é a 1). Pura. */
export function reminderRowsFromCsv(text: string): { rows: RawReminderRow[]; hasPhone: boolean; hasDate: boolean; unknown: string[] } {
  const [head = [], ...body] = parseCsv(text);
  const keys = head.map((h) => headerKey(h.replace(/[{}]/g, "")));
  const unknown = head.filter((h, i) => h.trim() && !FIELDS[keys[i]] && varIndex(keys[i]) === null).map((h) => h.trim());
  const rows = body.map((cells, i) => {
    const r: RawReminderRow = { line: i + 2, phone: "", name: "", date: "", time: "", vars: [] };
    keys.forEach((k, j) => {
      const value = (cells[j] ?? "").trim();
      const field = FIELDS[k];
      if (field && !r[field]) r[field] = value;
      const n = varIndex(k);
      if (n) r.vars[n - 1] = value;
    });
    r.vars = Array.from({ length: r.vars.length }, (_, j) => r.vars[j] ?? "");
    return r;
  });
  return { rows, hasPhone: keys.some((k) => FIELDS[k] === "phone"), hasDate: keys.some((k) => FIELDS[k] === "date"), unknown };
}

/** "14:30", "9:05", "14h30", "14h", "1430" → [14, 30]. Pura. */
export function parseSheetTime(raw: string): [number, number] | null {
  const m = /^(\d{1,2})(?:[:hH.]?(\d{2}))?\s*(?:h|hs|min)?$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  return h <= 23 && min <= 59 ? [h, min] : null;
}

export interface ReminderRow {
  line: number;
  /** canônico */
  phone: string;
  name: string | null;
  sendAt: string;
  /** "dd/mm/aaaa hh:mm" no fuso do cliente */
  local: string;
  /** fora de 8h a 20h no fuso do cliente (aviso, sem bloquear) */
  offHours: boolean;
  variables: string[];
}

export interface ReminderError {
  line: number;
  message: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Confere as linhas: telefone, data e hora no fuso do cliente, no futuro, e as variáveis do modelo. Pura. */
export function validateReminderRows(rows: RawReminderRow[], o: { vars: number; tz: string; now?: Date }): { valid: ReminderRow[]; errors: ReminderError[] } {
  const now = (o.now ?? new Date()).getTime();
  const valid: ReminderRow[] = [];
  const errors: ReminderError[] = [];
  for (const r of rows) {
    const fail = (message: string) => errors.push({ line: r.line, message });
    const phone = canonicalPhone(r.phone, { typed: true });
    if (!phone) {
      fail(r.phone ? `telefone inválido (${r.phone})` : "sem telefone");
      continue;
    }
    const day = parseSheetDate(r.date);
    if (!day) {
      fail(r.date ? `data inválida (${r.date}); use dd/mm/aaaa` : "sem data");
      continue;
    }
    const time = parseSheetTime(r.time);
    if (!time) {
      fail(r.time ? `hora inválida (${r.time}); use hh:mm` : "sem hora");
      continue;
    }
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const sendAt = localInputToIso(`${y}-${pad(m)}-${pad(d)}T${pad(time[0])}:${pad(time[1])}`, o.tz);
    if (!sendAt) {
      fail("data ou hora inválida");
      continue;
    }
    const at = Date.parse(sendAt);
    if (at < now - 5 * 60_000) {
      fail(`${pad(d)}/${pad(m)}/${y} ${pad(time[0])}:${pad(time[1])} já passou`);
      continue;
    }
    if (at > now + REMINDER_MAX_DAYS * 86_400_000) {
      fail(`agende para no máximo ${REMINDER_MAX_DAYS} dias à frente`);
      continue;
    }
    const variables = Array.from({ length: o.vars }, (_, j) => (r.vars[j] ?? "").trim());
    const empty = variables.findIndex((v) => !v);
    if (empty >= 0) {
      fail(`falta a variável ${empty + 1} (coluna variavel${empty + 1})`);
      continue;
    }
    const bad = variables.findIndex((v) => v.length > 200 || /[\n\t]| {5,}/.test(v));
    if (bad >= 0) {
      fail(`variável ${bad + 1}: até 200 caracteres, sem quebra de linha`);
      continue;
    }
    valid.push({ line: r.line, phone, name: r.name.trim() || null, sendAt, local: `${pad(d)}/${pad(m)}/${y} ${pad(time[0])}:${pad(time[1])}`, offHours: time[0] < 8 || time[0] >= 20, variables });
  }
  return { valid, errors };
}

/** Quantos envios caem em cada dia (no fuso do cliente), para comparar com o limite de 24 h. Pura. */
export function busiestDay(rows: Array<Pick<ReminderRow, "local">>): { day: string; count: number } | null {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = r.local.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  let best: { day: string; count: number } | null = null;
  for (const [day, count] of byDay) if (!best || count > best.count) best = { day, count };
  return best;
}
