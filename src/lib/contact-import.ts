import { canonicalPhone } from "./phone";
import { normalizeTags } from "./tags";
import { DEFAULT_TIMEZONE, localInputToIso } from "./timezone";

/*
 * Planilha de contatos (leva B3, parte 2b; spec "Cliente → Contatos": importar com consentimento,
 * origem e data obrigatórias, e a idade informada pela empresa com a origem). Tudo aqui é puro: o
 * navegador lê a planilha e mostra a prévia, e o servidor confere de novo antes de gravar. Da data
 * de nascimento, o ano só serve para calcular o sim ou não do 18+ e não é guardado; o dia e o mês
 * ficam como o aniversário do contato.
 * As datas das réguas (leva Réguas, parte 1): o aniversário, a última visita ou compra e o próximo
 * horário marcado (lido no fuso do cliente).
 */

export const IMPORT_MAX_ROWS = 2000;

/** O horário marcado vale até um ano à frente. */
export const APPOINTMENT_MAX_DAYS = 366;

export type ImportField = "phone" | "name" | "tags" | "consentOrigin" | "consentDate" | "consentText" | "age" | "ageOrigin" | "birth" | "birthday" | "lastVisit" | "appointment";

/** Nomes de coluna aceitos (sem acento, minúsculas, espaço vira _). */
const HEADERS: Record<string, ImportField> = {
  telefone: "phone",
  celular: "phone",
  whatsapp: "phone",
  fone: "phone",
  numero: "phone",
  phone: "phone",
  nome: "name",
  name: "name",
  etiquetas: "tags",
  etiqueta: "tags",
  tags: "tags",
  aceite_origem: "consentOrigin",
  origem_aceite: "consentOrigin",
  origem_do_aceite: "consentOrigin",
  aceite_data: "consentDate",
  data_aceite: "consentDate",
  data_do_aceite: "consentDate",
  aceite_texto: "consentText",
  texto_aceite: "consentText",
  texto_do_aceite: "consentText",
  idade: "age",
  maior_de_idade: "age",
  maior_18: "age",
  "18": "age",
  idade_origem: "ageOrigin",
  origem_idade: "ageOrigin",
  origem_da_idade: "ageOrigin",
  nascimento: "birth",
  data_nascimento: "birth",
  data_de_nascimento: "birth",
  aniversario: "birthday",
  data_aniversario: "birthday",
  data_do_aniversario: "birthday",
  ultima_visita: "lastVisit",
  ultima_compra: "lastVisit",
  data_da_ultima_visita: "lastVisit",
  data_ultima_visita: "lastVisit",
  agendamento: "appointment",
  horario_marcado: "appointment",
  proximo_horario: "appointment",
  data_do_horario: "appointment",
  data_agendamento: "appointment",
};

export const headerKey = (h: string) =>
  h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/**
 * CSV de planilha: separador ";" (Excel em português) ou ",", detectado no cabeçalho; aspas duplas
 * protegem separador e quebra de linha ("" vira "). Pura.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) && firstLine.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type RawImportRow = { line: number } & Record<ImportField, string> & {
  /** as datas novas (régua personalizada), pela chave da coluna: { renovacao_do_plano: "10/03/2027" } */
  custom?: Record<string, string>;
};

/** Linhas da planilha pelo cabeçalho. A linha conta como na planilha (o cabeçalho é a 1). Pura. */
export function rowsFromCsv(text: string, customKeys: string[] = []): { rows: RawImportRow[]; hasPhone: boolean; unknown: string[] } {
  const [head = [], ...body] = parseCsv(text);
  const fields = head.map((h) => HEADERS[headerKey(h)] ?? null);
  // as colunas das datas novas (régua personalizada): o nome da coluna é a chave da data
  const custom = head.map((h, i) => (!fields[i] && customKeys.includes(headerKey(h)) ? headerKey(h) : null));
  const unknown = head.filter((h, i) => h.trim() && !fields[i] && !custom[i]).map((h) => h.trim());
  const empty: Record<ImportField, string> = { phone: "", name: "", tags: "", consentOrigin: "", consentDate: "", consentText: "", age: "", ageOrigin: "", birth: "", birthday: "", lastVisit: "", appointment: "" };
  const rows = body.map((cells, i) => {
    const r: RawImportRow = { line: i + 2, ...empty };
    fields.forEach((f, j) => {
      if (f && !r[f]) r[f] = (cells[j] ?? "").trim();
    });
    custom.forEach((k, j) => {
      const v = (cells[j] ?? "").trim();
      if (k && v) r.custom = { ...r.custom, [k]: v };
    });
    return r;
  });
  return { rows, hasPhone: fields.includes("phone"), unknown };
}

/** Data da planilha: dd/mm/aaaa, dd/mm/aa ou aaaa-mm-dd (meio-dia em São Paulo). Pura. */
export function parseSheetDate(raw: string): Date | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (match) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
    if (y < 100) y += y > 50 ? 1900 : 2000;
  } else if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else return null;
  const date = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T12:00:00-03:00`);
  // 31/02 vira março: confere que o dia é o mesmo
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== d || date.getUTCMonth() + 1 !== m) return null;
  return date;
}

/** A data nova da planilha (dd/mm/aaaa, dd/mm/aa ou aaaa-mm-dd) como "AAAA-MM-DD". Pura. */
export function customDateFromSheet(raw: string): string | null {
  const d = parseSheetDate(raw);
  if (!d) return null;
  const y = d.getUTCFullYear();
  if (y < 1900 || y > 2100) return null;
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** "14:30", "9:05", "14h30", "14h", "1430" → [14, 30]. Pura. */
export function parseSheetTime(raw: string): [number, number] | null {
  const m = /^(\d{1,2})(?:[:hH.]?(\d{2}))?\s*(?:h|hs|min)?$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  return h <= 23 && min <= 59 ? [h, min] : null;
}

/** Dias de cada mês num ano bissexto (o aniversário em 29/02 vale). */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "MM-DD" de um mês e um dia que existem (29/02 vale), ou null. Pura. */
export const monthDay = (month: number, day: number): string | null => (month >= 1 && month <= 12 && day >= 1 && day <= MONTH_DAYS[month - 1] ? `${pad2(month)}-${pad2(day)}` : null);

/** "MM-DD" para mostrar ("21/10"). Pura. */
export const birthdayLabel = (birthday: string | null | undefined): string => (birthday ? `${birthday.slice(3, 5)}/${birthday.slice(0, 2)}` : "");

/** Aniversário da planilha: dd/mm, dd/mm/aaaa (ou com - e .) ou aaaa-mm-dd, como "MM-DD" (o ano não fica). Pura. */
export function birthdayFromSheet(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (m) return monthDay(Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? monthDay(Number(m[2]), Number(m[3])) : null;
}

/**
 * Horário marcado da planilha: "dd/mm/aaaa hh:mm" (ou "às 14h30"), "aaaa-mm-dd hh:mm" e o que os
 * sistemas exportam ("2026-10-21T14:30:00"), lido no fuso do cliente, em ISO. Pura.
 */
export function appointmentFromSheet(raw: string, tz: string): string | null {
  const s = raw.trim().replace(/^(\d{4}-\d{1,2}-\d{1,2})T/, "$1 ");
  const m = s.match(/^(\S+)\s+(?:(?:às|as)\s+)?(\d{1,2}(?:[:hH.]\d{2}|\d{2})?)(?::\d{2})?\s*(?:h|hs)?$/i);
  if (!m) return null;
  const day = parseSheetDate(m[1]);
  const time = parseSheetTime(m[2]);
  if (!day || !time) return null;
  return localInputToIso(`${day.getUTCFullYear()}-${pad2(day.getUTCMonth() + 1)}-${pad2(day.getUTCDate())}T${pad2(time[0])}:${pad2(time[1])}`, tz);
}

const YES = new Set(["sim", "s", "yes", "y", "1", "18", "18+", "maior", "maior de idade", "adulto", "x"]);
const NO = new Set(["nao", "n", "no", "0", "menor", "menor de idade"]);
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Tem 18 anos ou mais na data de hoje? Pura. */
export function isAdultOn(birth: Date, today: Date): boolean {
  const limit = new Date(birth.getTime());
  limit.setUTCFullYear(limit.getUTCFullYear() + 18);
  return limit.getTime() <= today.getTime();
}

export interface ImportRow {
  line: number;
  /** Canônico (só dígitos, com o 55 e o 9). */
  phone: string;
  name: string | null;
  tags: string[];
  consent: { origin: string; date: string; text: string | null } | null;
  age: { adult: boolean; origin: string } | null;
  /** "MM-DD" (a coluna aniversario, ou o dia e o mês do nascimento). */
  birthday: string | null;
  /** A última visita ou compra (ISO). */
  lastVisitAt: string | null;
  /** O próximo horário marcado (ISO). */
  appointmentAt: string | null;
  /** As datas novas (régua personalizada): { chave: "AAAA-MM-DD" }. */
  customDates: Record<string, string>;
}

export interface ImportError {
  line: number;
  reason: string;
}

/**
 * As datas da ficha do contato no painel: o aniversário ("21/10"), a última visita (campo de data)
 * e o próximo horário (campo de data e hora, lido no fuso do cliente). Campo vazio apaga. Pura.
 */
export function contactDatesFromForm(raw: { birthday: string; lastVisit: string; appointment: string }, tz: string, now = Date.now()): { birthday: string | null; last_visit_at: string | null; appointment_at: string | null } | { error: string } {
  const birthday = raw.birthday.trim() ? birthdayFromSheet(raw.birthday) : null;
  if (raw.birthday.trim() && !birthday) return { error: "Aniversário inválido: use dia e mês, como 21/10." };
  const visit = raw.lastVisit.trim() ? parseSheetDate(raw.lastVisit) : null;
  if (raw.lastVisit.trim() && !visit) return { error: "Data da última visita inválida." };
  if (visit && visit.getTime() > now + 86_400_000) return { error: "A última visita não pode ser no futuro." };
  const appointment = raw.appointment.trim() ? localInputToIso(raw.appointment, tz) : null;
  if (raw.appointment.trim() && !appointment) return { error: "Horário marcado inválido." };
  if (appointment && Date.parse(appointment) < now - 5 * 60_000) return { error: "O horário marcado já passou." };
  if (appointment && Date.parse(appointment) > now + APPOINTMENT_MAX_DAYS * 86_400_000) return { error: "O horário marcado vale até um ano à frente." };
  return { birthday, last_visit_at: visit ? visit.toISOString() : null, appointment_at: appointment };
}

/**
 * Confere as linhas. Linha com problema fica inteira de fora e entra na lista de erros. tz: o fuso
 * do cliente, em que o horário marcado é lido. Pura.
 */
export function validateImportRows(rows: RawImportRow[], today = new Date(), tz: string = DEFAULT_TIMEZONE): { valid: ImportRow[]; errors: ImportError[] } {
  const valid: ImportRow[] = [];
  const errors: ImportError[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const fail = (reason: string) => errors.push({ line: r.line, reason });
    const phone = canonicalPhone(r.phone, { typed: true });
    if (!phone) {
      fail(r.phone ? "telefone inválido (use DDD e número)" : "sem telefone");
      continue;
    }
    if (seen.has(phone)) {
      fail("telefone repetido na planilha (vale a primeira linha)");
      continue;
    }

    let consent: ImportRow["consent"] = null;
    if (r.consentOrigin || r.consentDate || r.consentText) {
      const date = parseSheetDate(r.consentDate);
      if (r.consentOrigin.length < 3) {
        fail("aceite sem a origem (aceite_origem)");
        continue;
      }
      if (!date) {
        fail("aceite sem data válida (aceite_data, ex.: 10/09/2026)");
        continue;
      }
      if (date.getTime() > today.getTime()) {
        fail("data do aceite no futuro");
        continue;
      }
      consent = { origin: r.consentOrigin.slice(0, 200), date: date.toISOString(), text: r.consentText ? r.consentText.slice(0, 600) : null };
    }

    const birth = r.birth ? parseSheetDate(r.birth) : null;
    if (r.birth && !birth) {
      fail("data de nascimento inválida (use dd/mm/aaaa)");
      continue;
    }
    // a idade vem da coluna idade ou do nascimento, sempre com a origem; o nascimento sozinho só dá o aniversário
    let age: ImportRow["age"] = null;
    if (r.age || r.ageOrigin) {
      let adult: boolean | null = null;
      const a = fold(r.age);
      if (a) adult = YES.has(a) ? true : NO.has(a) ? false : null;
      else if (birth) adult = isAdultOn(birth, today);
      if (adult === null) {
        fail("idade: use sim ou não, ou a data de nascimento");
        continue;
      }
      if (r.ageOrigin.length < 3) {
        fail("idade sem a origem (idade_origem)");
        continue;
      }
      age = { adult, origin: r.ageOrigin.slice(0, 200) };
    }

    const birthday = r.birthday ? birthdayFromSheet(r.birthday) : birth ? monthDay(birth.getUTCMonth() + 1, birth.getUTCDate()) : null;
    if (r.birthday && !birthday) {
      fail("aniversário inválido (use dd/mm, ex.: 21/10)");
      continue;
    }
    const visit = r.lastVisit ? parseSheetDate(r.lastVisit) : null;
    if (r.lastVisit && !visit) {
      fail("última visita inválida (use dd/mm/aaaa)");
      continue;
    }
    if (visit && visit.getTime() > today.getTime() + 86_400_000) {
      fail("última visita no futuro");
      continue;
    }
    const appointmentAt = r.appointment ? appointmentFromSheet(r.appointment, tz) : null;
    if (r.appointment && !appointmentAt) {
      fail("horário marcado inválido (use dd/mm/aaaa hh:mm, ex.: 21/10/2026 14:30)");
      continue;
    }
    if (appointmentAt && Date.parse(appointmentAt) < today.getTime() - 5 * 60_000) {
      fail("horário marcado já passou");
      continue;
    }
    if (appointmentAt && Date.parse(appointmentAt) > today.getTime() + APPOINTMENT_MAX_DAYS * 86_400_000) {
      fail("horário marcado para mais de um ano à frente");
      continue;
    }

    // as datas novas: cada uma no formato da planilha (a chave já veio do cabeçalho)
    const customDates: Record<string, string> = {};
    const badCustom = Object.entries(r.custom ?? {}).find(([k, v]) => {
      const ymd = customDateFromSheet(v);
      if (ymd) customDates[k] = ymd;
      return !ymd;
    });
    if (badCustom) {
      fail(`${badCustom[0]} inválida (use dd/mm/aaaa)`);
      continue;
    }

    seen.add(phone);
    valid.push({ line: r.line, phone, name: r.name ? r.name.replace(/\s+/g, " ").slice(0, 80) : null, tags: normalizeTags(r.tags), consent, age, birthday, lastVisitAt: visit ? visit.toISOString() : null, appointmentAt, customDates });
  }
  return { valid, errors };
}
