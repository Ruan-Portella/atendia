import { canonicalPhone } from "./phone";
import { normalizeTags } from "./tags";

/*
 * Planilha de contatos (leva B3, parte 2b; spec "Cliente → Contatos": importar com consentimento,
 * origem e data obrigatórias, e a idade informada pela empresa com a origem). Tudo aqui é puro: o
 * navegador lê a planilha e mostra a prévia, e o servidor confere de novo antes de gravar. A data
 * de nascimento só serve para calcular o sim ou não do 18+ e não é guardada.
 */

export const IMPORT_MAX_ROWS = 2000;

export type ImportField = "phone" | "name" | "tags" | "consentOrigin" | "consentDate" | "consentText" | "age" | "ageOrigin" | "birth";

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
};

const headerKey = (h: string) =>
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

export type RawImportRow = { line: number } & Record<ImportField, string>;

/** Linhas da planilha pelo cabeçalho. A linha conta como na planilha (o cabeçalho é a 1). Pura. */
export function rowsFromCsv(text: string): { rows: RawImportRow[]; hasPhone: boolean; unknown: string[] } {
  const [head = [], ...body] = parseCsv(text);
  const fields = head.map((h) => HEADERS[headerKey(h)] ?? null);
  const unknown = head.filter((h, i) => h.trim() && !fields[i]).map((h) => h.trim());
  const empty: Record<ImportField, string> = { phone: "", name: "", tags: "", consentOrigin: "", consentDate: "", consentText: "", age: "", ageOrigin: "", birth: "" };
  const rows = body.map((cells, i) => {
    const r: RawImportRow = { line: i + 2, ...empty };
    fields.forEach((f, j) => {
      if (f && !r[f]) r[f] = (cells[j] ?? "").trim();
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
}

export interface ImportError {
  line: number;
  reason: string;
}

/** Confere as linhas. Linha com problema fica inteira de fora e entra na lista de erros. Pura. */
export function validateImportRows(rows: RawImportRow[], today = new Date()): { valid: ImportRow[]; errors: ImportError[] } {
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

    let age: ImportRow["age"] = null;
    if (r.age || r.birth || r.ageOrigin) {
      let adult: boolean | null = null;
      const a = fold(r.age);
      if (a) adult = YES.has(a) ? true : NO.has(a) ? false : null;
      else if (r.birth) {
        const birth = parseSheetDate(r.birth);
        adult = birth ? isAdultOn(birth, today) : null;
      }
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

    seen.add(phone);
    valid.push({ line: r.line, phone, name: r.name ? r.name.replace(/\s+/g, " ").slice(0, 80) : null, tags: normalizeTags(r.tags), consent, age });
  }
  return { valid, errors };
}
