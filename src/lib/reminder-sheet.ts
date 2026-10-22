import { canonicalPhone } from "./phone";
import { headerKey, parseCsv, parseSheetDate, parseSheetTime } from "./contact-import";
import { localInputToIso } from "./timezone";

export { parseSheetTime };

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
      fail(`falta o campo ${empty + 1} do modelo`);
      continue;
    }
    const bad = variables.findIndex((v) => v.length > 200 || /[\n\t]| {5,}/.test(v));
    if (bad >= 0) {
      fail(`campo ${bad + 1} do modelo: até 200 caracteres, sem quebra de linha`);
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

/*
 * A lista de lembretes na tela (redesenho, etapa 5, a pedido do usuário em 22/10: sem a planilha
 * obrigatória). Cada linha é uma pessoa, com o horário marcado (opcional); cada campo do modelo vem do
 * primeiro nome, do dia ou da hora marcados, de um texto fixo ou de uma coluna da lista. O envio é o
 * mesmo para todos, um tempo antes do horário marcado ou um para cada linha. Vira as mesmas linhas da
 * planilha: o servidor confere igual.
 */

export type ReminderSlotSource = "name" | "date" | "time" | "fixed" | "row";

/** Um campo do modelo: de onde vem; `value` é o texto fixo ou, no nome, o texto para quem não tem. */
export interface ReminderSlot {
  src: ReminderSlotSource;
  value: string;
}

export interface ReminderTableRow {
  name: string;
  phone: string;
  /** o horário marcado, "aaaa-mm-ddThh:mm" no fuso do cliente (vazio: sem) */
  at: string;
  /** o envio da linha (só no "um para cada"): "aaaa-mm-dd" e "hh:mm" */
  date: string;
  time: string;
  /** os campos "da lista", na posição do campo */
  vars: string[];
}

export const REMINDER_LEADS = [
  ["1h", "1 hora antes"],
  ["2h", "2 horas antes"],
  ["3h", "3 horas antes"],
  ["1d", "1 dia antes, no mesmo horário"],
  ["2d", "2 dias antes, no mesmo horário"],
  ["vespera", "Na véspera, no horário escolhido"],
] as const;
export type ReminderLead = (typeof REMINDER_LEADS)[number][0];

export type ReminderSend = { mode: "same"; date: string; time: string } | { mode: "before"; lead: ReminderLead; at: string } | { mode: "each" };

const wallParts = (at: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) : null;
};
const wallDate = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const wallTime = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** Quando sai o lembrete de quem tem horário marcado (na hora da parede do cliente). Pura. */
export function sendFromAppointment(at: string, lead: ReminderLead, eveTime = "09:00"): { date: string; time: string } | null {
  const t = wallParts(at);
  if (t === null) return null;
  const hour = 3_600_000;
  if (lead === "vespera") return { date: wallDate(t - 24 * hour), time: parseSheetTime(eveTime) ? eveTime : "09:00" };
  const back = { "1h": 1, "2h": 2, "3h": 3, "1d": 24, "2d": 48 }[lead] * hour;
  return { date: wallDate(t - back), time: wallTime(t - back) };
}

/** O dia e a hora marcados como entram no texto: "23/10" e "14h30" (ou "14h"). Pura. */
export function appointmentText(at: string): { date: string; time: string } | null {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
  if (!m) return null;
  return { date: `${m[2]}/${m[1]}`, time: m[4] === "00" ? `${Number(m[3])}h` : `${Number(m[3])}h${m[4]}` };
}

/** A lista vira as linhas da planilha (a linha é a posição na lista, de 1; linha sem nome nem telefone fica fora). Pura. */
export function reminderRowsFromTable(rows: ReminderTableRow[], slots: ReminderSlot[], send: ReminderSend): RawReminderRow[] {
  const out: RawReminderRow[] = [];
  rows.forEach((r, i) => {
    if (!r.phone.trim() && !r.name.trim()) return;
    const when = send.mode === "same" ? { date: send.date, time: send.time } : send.mode === "each" ? { date: r.date, time: r.time } : (sendFromAppointment(r.at, send.lead, send.at) ?? { date: "", time: "" });
    const marked = appointmentText(r.at);
    const first = r.name.trim().split(/\s+/)[0] ?? "";
    const vars = slots.map((s, j) => {
      if (s.src === "name") return first ? first.slice(0, 60) : s.value.trim();
      if (s.src === "date") return marked?.date ?? "";
      if (s.src === "time") return marked?.time ?? "";
      if (s.src === "fixed") return s.value.trim();
      return (r.vars[j] ?? "").trim();
    });
    out.push({ line: i + 1, phone: r.phone.trim(), name: r.name.trim(), date: when.date, time: when.time, vars });
  });
  return out;
}

/** Uma linha da planilha importada na lista (a data e a hora vão para o envio da linha). Pura. */
export function tableRowFromSheet(r: RawReminderRow): ReminderTableRow {
  const day = parseSheetDate(r.date);
  const t = parseSheetTime(r.time);
  return {
    name: r.name,
    phone: r.phone,
    at: "",
    date: day ? `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}` : "",
    time: t ? `${pad(t[0])}:${pad(t[1])}` : "",
    vars: r.vars,
  };
}
