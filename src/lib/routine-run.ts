import { normalizeKeyword, DATA_KIND_LABEL, type DataKind, type Destination, type RoutineStep } from "./routines";
import type { MessageComponent, OptionItem } from "./components";
import type { PhotoReading } from "./photo-note";

/*
 * Roteiros na conversa (leva B2', parte 2a), a parte pura: validação e extração dos dados
 * (dígito verificador do CPF e do CNPJ, também o CNPJ alfanumérico de 07/2026), número de cartão
 * apagado antes de gravar, botões do passo e o texto que a IA recebe a cada vez. O CPF e os outros
 * dados que a pessoa manda ficam como vieram, no painel e para a IA (decisão de 19/10/2026: a loja
 * pode precisar do CPF para conferir a conta). O estado no banco e as ferramentas ficam em
 * routine-engine.ts.
 */

/** 24 horas sem mensagem do contato: o roteiro acaba (timeout). */
export const ROUTINE_TIMEOUT_MS = 24 * 3_600_000;
/** Tentativas de um dado antes de oferecer equipe ou cancelar. */
export const MAX_ATTEMPTS = 3;
/** Mensagens seguidas do contato sem o roteiro andar: na próxima, o roteiro acaba (idle). */
export const MAX_IDLE_TURNS = 4;

export const END_REASONS = ["handoff", "timeout", "routine_changed", "step_unavailable", "context_changed", "cancelled", "replaced", "idle"] as const;
export type EndReason = (typeof END_REASONS)[number];
/** Para a faixa da conversa: "Roteiro encerrado no passo 3 (assumido)". */
export const END_REASON_LABEL: Record<EndReason, string> = {
  handoff: "assumido",
  timeout: "sem resposta em 24 horas",
  routine_changed: "roteiro alterado",
  step_unavailable: "ação indisponível",
  context_changed: "conta trocada",
  cancelled: "cancelado pelo contato",
  replaced: "trocado por outro roteiro",
  idle: "parado (a conversa seguiu outro assunto)",
};

/** Valor guardado de uma variável do roteiro (o tipo decide a máscara). */
export interface RoutineValue {
  /** foto: a descrição que a IA leu da foto do passo (parte 2d). */
  kind: DataKind | "escolha" | "foto";
  value: string;
}

/** Tamanho da descrição guardada da foto do passo (vai para a IA e para as ações). */
export const PHOTO_VALUE_MAX = 600;

/**
 * O que fica guardado da foto do passo: a descrição e o texto de cada foto descrita da rajada
 * (comprovante, documento e ilegível ficam de fora). null sem foto descrita. Pura.
 */
export function photoValue(readings: PhotoReading[] | null | undefined): string | null {
  const seen = (readings ?? []).filter((r) => r.kind === "comum" && r.description);
  if (!seen.length) return null;
  const one = (r: PhotoReading) => `${r.description}${r.text ? ` Texto na foto: "${r.text}".` : ""}`;
  const out = seen.length === 1 ? one(seen[0]) : seen.map((r, i) => `Foto ${i + 1}: ${one(r)}`).join(" ");
  return out.slice(0, PHOTO_VALUE_MAX);
}
export type RoutineVariables = Record<string, RoutineValue>;

/* ------------------------------------------------------------------ validação */

const onlyDigits = (s: string) => s.replace(/\D/g, "");

/** CPF com os dois dígitos verificadores (sem a sequência de um número só). Pura. */
export function isCpf(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/**
 * CNPJ com os dois dígitos verificadores, numérico ou alfanumérico (Receita Federal, a partir de
 * 07/2026: os 12 primeiros podem ter letras; cada caractere vale o código ASCII menos 48). Pura.
 */
export function isCnpj(raw: string): boolean {
  const c = raw.toUpperCase();
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const val = (ch: string) => ch.charCodeAt(0) - 48;
  const dv = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += val(c[i]) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

/** DDDs em uso no Brasil. */
const DDDS = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99]);

/** Telefone do Brasil com DDD: 10 dígitos (fixo) ou 11 (celular, começa com 9); o 55 da frente sai. Devolve só os dígitos, ou null. Pura. */
export function brPhone(raw: string): string | null {
  let d = onlyDigits(raw);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (!DDDS.has(Number(d.slice(0, 2)))) return null;
  if (d.length === 11 && d[2] !== "9") return null;
  if (d.length === 10 && !/[2-5]/.test(d[2])) return null;
  return d;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

const fmtCpf = (d: string) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
const fmtCnpj = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
const fmtPhone = (d: string) => (d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`);

const MONTHS: Record<string, number> = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

/** Data de verdade (dd/mm/aaaa, dd/mm/aa, aaaa-mm-dd ou "15 de março de 2026"), devolvida como dd/mm/aaaa. Pura. */
export function parseDate(raw: string, now = new Date()): string | null {
  const t = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  let d: number, m: number, y: number;
  let x = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
  if (x) {
    d = Number(x[1]);
    m = Number(x[2]);
    y = x[3] ? Number(x[3].length === 2 ? `20${x[3]}` : x[3]) : now.getFullYear();
  } else if ((x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) {
    y = Number(x[1]);
    m = Number(x[2]);
    d = Number(x[3]);
  } else if ((x = /^(\d{1,2})(?:o|º)? de ([a-z]+)(?: de (\d{4}))?$/.exec(t)) && MONTHS[x[2]]) {
    d = Number(x[1]);
    m = MONTHS[x[2]];
    y = x[3] ? Number(x[3]) : now.getFullYear();
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1900 || y > 2100) return null;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** Número (1.234,56 · 1234.56 · 12), devolvido sem separador de milhar e com vírgula nas casas. Pura. */
export function parseNumber(raw: string): string | null {
  const t = raw.trim();
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(t)) return t.replace(/\./g, "");
  if (/^-?\d+(?:,\d+)?$/.test(t)) return t;
  if (/^-?\d+\.\d+$/.test(t)) return t.replace(".", ",");
  return null;
}

/**
 * O valor que a IA informou (data e formato próprio) ou que o BoaVoz achou, conferido e na forma
 * guardada; null = não confere. Pura.
 */
export function validateValue(kind: DataKind, raw: string, pattern?: string | null): string | null {
  const v = raw.trim();
  switch (kind) {
    case "cpf":
      return isCpf(onlyDigits(v)) && onlyDigits(v).length === 11 ? fmtCpf(onlyDigits(v)) : null;
    case "cnpj": {
      const c = v.replace(/[.\-/\s]/g, "").toUpperCase();
      return isCnpj(c) ? fmtCnpj(c) : null;
    }
    case "cpf_cnpj":
      return validateValue("cpf", v) ?? validateValue("cnpj", v);
    case "email":
      return new RegExp(`^${EMAIL_RE.source}$`).test(v) ? v.toLowerCase() : null;
    case "telefone": {
      const d = brPhone(v);
      return d ? fmtPhone(d) : null;
    }
    case "cep": {
      const d = onlyDigits(v);
      return d.length === 8 && v.replace(/[\d.\-\s]/g, "") === "" && d !== "00000000" ? `${d.slice(0, 5)}-${d.slice(5)}` : null;
    }
    case "data":
      return parseDate(v);
    case "numero":
      return parseNumber(v);
    case "regex": {
      if (!pattern) return null;
      try {
        return new RegExp(`^(?:${pattern})$`).test(v) ? v : null;
      } catch {
        return null;
      }
    }
  }
}

/** Tipos que o BoaVoz acha sozinho na mensagem (a IA nunca copia); data e formato próprio vêm da IA. */
export const FIXED_KINDS: ReadonlySet<DataKind> = new Set(["cpf", "cnpj", "cpf_cnpj", "email", "telefone", "cep", "numero"]);

const CANDIDATES: Record<Exclude<DataKind, "data" | "regex">, RegExp> = {
  cpf: /(?<![\dA-Za-z])(?:\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?![\dA-Za-z])/g,
  // numérico, com ou sem pontuação, e o alfanumérico com a pontuação de sempre
  cnpj: /(?<![\dA-Za-z])(?:\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|[0-9A-Za-z]{2}\.[0-9A-Za-z]{3}\.[0-9A-Za-z]{3}\/[0-9A-Za-z]{4}-\d{2})(?![\dA-Za-z])/g,
  cpf_cnpj: /(?<![\dA-Za-z])(?:\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|[0-9A-Za-z]{2}\.[0-9A-Za-z]{3}\.[0-9A-Za-z]{3}\/[0-9A-Za-z]{4}-\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?![\dA-Za-z])/g,
  email: /[^\s@]+@[^\s@]+/g,
  telefone: /(?<!\d)(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)\d{4,5}[\s.-]?\d{4}(?!\d)/g,
  cep: /(?<![\d.])(?:\d{5}-?\d{3}|\d{2}\.\d{3}-\d{3})(?![\d.])/g,
  numero: /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/g,
};

/**
 * Procura o dado nas mensagens desta vez (da última para a primeira). value: o mais recente que
 * confere; invalid: havia candidato, mas nenhum confere (conta como tentativa); null: a pessoa não
 * mandou (perguntou outra coisa; não conta). Só nos tipos fixos. Pura.
 */
export function findValue(kind: DataKind, texts: string[]): { value: string } | { invalid: true } | null {
  if (!FIXED_KINDS.has(kind)) return null;
  const re = CANDIDATES[kind as keyof typeof CANDIDATES];
  let invalid = false;
  for (const t of [...texts].reverse()) {
    const found = [...(t ?? "").matchAll(new RegExp(re.source, re.flags))].map((m) => m[0]).reverse();
    for (const c of found) {
      const v = validateValue(kind, kind === "email" ? c.replace(/[.,;:!?)]+$/, "") : c);
      if (v) return { value: v };
      invalid = true;
    }
  }
  return invalid ? { invalid: true } : null;
}

/* ------------------------------------------------------------------ número de cartão */

/** Lugar do número de cartão apagado (a IA lê isso e avisa a pessoa para não mandar cartão). */
export const CARD_PLACEHOLDER = "[número de cartão apagado por segurança]";

function luhn(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Bandeira pelo começo e pelo tamanho (Visa, Mastercard, Amex, Elo, Hipercard, Diners, Discover). */
function cardBrand(d: string): boolean {
  const n = d.length;
  const p2 = Number(d.slice(0, 2));
  const p4 = Number(d.slice(0, 4));
  const p6 = Number(d.slice(0, 6));
  if (d[0] === "4") return n === 13 || n === 16 || n === 19;
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return n === 16;
  if (p2 === 34 || p2 === 37) return n === 15;
  if (p2 === 36 || p2 === 38 || (p4 >= 3000 && p4 <= 3059)) return n === 14 || n === 16;
  if (p4 === 6011 || p2 === 65) return n >= 16 && n <= 19;
  if (p6 === 606282 || p4 === 3841) return n === 13 || n === 16 || n === 19;
  // Elo (faixas mais comuns)
  if ([401178, 401179, 431274, 438935, 451416, 457393, 457631, 457632, 504175, 627780, 636297, 636368].includes(p6) || (p6 >= 506699 && p6 <= 506778) || (p6 >= 509000 && p6 <= 509999) || (p6 >= 650031 && p6 <= 650979)) return n === 16;
  return false;
}

/**
 * Número de cartão no texto do contato (dígito de Luhn e começo de bandeira, com ou sem espaço e
 * hífen) sai antes de gravar e antes da IA. Telefone não confunde: não tem bandeira nem tamanho de
 * cartão. Pura.
 */
export function maskCardNumbers(text: string): { text: string; found: boolean } {
  let found = false;
  const out = text.replace(/(?<![\d])\d(?:[ -]?\d){12,18}(?![\d])/g, (m) => {
    const d = onlyDigits(m);
    if (d.length < 13 || d.length > 19 || !luhn(d) || !cardBrand(d)) return m;
    found = true;
    return CARD_PLACEHOLDER;
  });
  return { text: out, found };
}

/* ------------------------------------------------------------------ botões e escolhas */

export const ROUTINE_BUTTON_PREFIX = "rt:";
export const FAIL_TEAM = "Falar com a equipe";
export const FAIL_CANCEL = "Cancelar";

/** Os botões do passo: o id leva o roteiro em andamento, o passo e a opção (o toque volta sem a IA). Pura. */
export function stepButtons(runId: string, step: Extract<RoutineStep, { type: "botoes" }>): MessageComponent {
  return { type: "options", options: step.options.map((o, i) => ({ id: `${ROUTINE_BUTTON_PREFIX}${runId}:${step.id}:${i}`, title: o.title })) };
}

/** Depois de 3 tentativas: falar com a equipe ou cancelar. Pura. */
export function failButtons(runId: string): MessageComponent {
  return {
    type: "options",
    options: [
      { id: `${ROUTINE_BUTTON_PREFIX}${runId}:falha:equipe`, title: FAIL_TEAM },
      { id: `${ROUTINE_BUTTON_PREFIX}${runId}:falha:cancelar`, title: FAIL_CANCEL },
    ],
  };
}

export type RoutineClick = { runId: string; stepId: string; index: number } | { runId: string; fail: "equipe" | "cancelar" };

/** O toque é num botão de roteiro? Pura. */
export function parseRoutineButton(id: string | null | undefined): RoutineClick | null {
  if (!id?.startsWith(ROUTINE_BUTTON_PREFIX)) return null;
  const m = /^rt:([0-9a-f-]{36}):([a-z0-9]{6,12}|falha):([0-9]{1,2}|equipe|cancelar)$/.exec(id);
  if (!m) return null;
  if (m[2] === "falha") return m[3] === "equipe" || m[3] === "cancelar" ? { runId: m[1], fail: m[3] } : null;
  return /^\d+$/.test(m[3]) ? { runId: m[1], stepId: m[2], index: Number(m[3]) } : null;
}

/**
 * Escolha digitada com as opções do roteiro na última mensagem: o número da opção ("2") ou o texto
 * dela, sem diferença de maiúsculas e acentos. Pura.
 */
export function typedChoice(text: string, options: OptionItem[]): number | null {
  const t = normalizeKeyword(text);
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= options.length ? n - 1 : null;
  }
  const i = options.findIndex((o) => normalizeKeyword(o.title) === t);
  return i >= 0 ? i : null;
}

/** O roteiro cuja palavra-chave é a mensagem inteira (sem diferença de maiúsculas e acentos), ou null. Pura. */
export function keywordRoutine<T extends { keywords: string[] }>(text: string, routines: T[]): T | null {
  const t = normalizeKeyword(text);
  if (!t) return null;
  return routines.find((r) => r.keywords.includes(t)) ?? null;
}

/* ------------------------------------------------------------------ caminho */

export type NextStep = { kind: "step"; step: RoutineStep } | { kind: "completed" } | { kind: "handoff" };

/** Para onde ir: o passo seguinte (no último, acaba), outro passo, o fim ou a equipe. Pura. */
export function nextFrom(steps: RoutineStep[], fromId: string, d: Destination): NextStep {
  if (d.to === "encerrar") return { kind: "completed" };
  if (d.to === "atendente") return { kind: "handoff" };
  if (d.to === "passo") {
    const s = steps.find((x) => x.id === d.step);
    return s ? { kind: "step", step: s } : { kind: "completed" };
  }
  const i = steps.findIndex((x) => x.id === fromId);
  return i >= 0 && i + 1 < steps.length ? { kind: "step", step: steps[i + 1] } : { kind: "completed" };
}

/* ------------------------------------------------------------------ passo de ação (parte 2b) */

/**
 * O valor como vai para a ação: sem pontuação (CPF, CNPJ, CEP e telefone com DDD), e-mail em
 * minúsculas, data em aaaa-mm-dd e número com ponto (ou número de verdade, se o parâmetro é
 * number ou integer). Pura.
 */
export function actionValue(v: RoutineValue, type?: string): string | number {
  let s: string;
  switch (v.kind) {
    case "cpf":
    case "cnpj":
    case "cpf_cnpj":
      s = v.value.replace(/[.\-/\s]/g, "").toUpperCase();
      break;
    case "cep":
    case "telefone":
      s = v.value.replace(/\D/g, "");
      break;
    case "email":
      s = v.value.toLowerCase();
      break;
    case "data": {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.value);
      s = m ? `${m[3]}-${m[2]}-${m[1]}` : v.value;
      break;
    }
    case "numero":
      s = v.value.replace(",", ".");
      break;
    default:
      s = v.value;
  }
  if (type === "number" || type === "integer") {
    const n = Number(s.replace(",", "."));
    if (Number.isFinite(n)) return type === "integer" ? Math.trunc(n) : n;
  }
  return s;
}

type SchemaLike = { type?: string; properties?: Record<string, { type?: string }>; required?: string[] };

/** Parâmetros da ação que o roteiro já tem (o mesmo nome de uma variável): o BoaVoz preenche com o valor conferido. Pura. */
export function boundParams(schema: SchemaLike, vars: RoutineVariables): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [name, p] of Object.entries(schema.properties ?? {})) {
    const v = vars[name];
    if (v && (p.type === "string" || p.type === "number" || p.type === "integer")) out[name] = actionValue(v, p.type);
  }
  return out;
}

/** O schema sem os parâmetros que o BoaVoz preenche (a IA não pede de novo nem copia). Pura. */
export function schemaWithout<T extends SchemaLike>(schema: T, names: string[]): T {
  if (!names.length) return schema;
  const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([n]) => !names.includes(n)));
  return { ...schema, properties, ...(schema.required ? { required: schema.required.filter((n) => !names.includes(n)) } : {}) };
}

/**
 * A linha da tabela "resultado → destino" que vale para a chamada: o resultado declarado; ok sem
 * resultado; não encontrado; o resto (falha, prazo, incerta, barrada, resultado não declarado)
 * segue o erro. Pura.
 */
export function resultKey(r: { status: string; outcome?: string | null }, declared: string[]): string {
  if (r.status === "not_found") return "nao_encontrado";
  if (r.status !== "ok") return "erro";
  if (!r.outcome) return "ok";
  return declared.includes(r.outcome) ? r.outcome : "erro";
}

/** O destino da linha (sem destino na tabela, o do erro; sem esse, a equipe). Pura. */
export function resultDestination(step: Extract<RoutineStep, { type: "acao" }>, key: string): Destination {
  return step.results[key] ?? step.results.erro ?? { to: "atendente" };
}

/* ------------------------------------------------------------------ o que a IA recebe */

const label = (kind: DataKind) => DATA_KIND_LABEL[kind] === "formato próprio (regex)" ? "dado" : DATA_KIND_LABEL[kind];

/** Os dados já informados ("documento: 529.982.247-25"). Pura. */
export function variablesLine(vars: RoutineVariables): string {
  const parts = Object.entries(vars).map(([k, v]) => `${k}: ${v.value}`);
  return parts.length ? `Dados já informados: ${parts.join("; ")}.` : "";
}

/** O que a IA faz no passo (também volta no resultado das ferramentas, quando o roteiro anda). Pura. */
export function stepInstruction(step: RoutineStep, o: { failing?: boolean; waPhoneKnown?: boolean } = {}): string {
  if (o.failing && step.type === "dado")
    return `Não deu para conferir o ${label(step.kind)} depois de ${MAX_ATTEMPTS} tentativas. Diga isso com gentileza e pergunte se a pessoa prefere falar com a equipe ou cancelar. Os botões (${FAIL_TEAM}, ${FAIL_CANCEL}) vão sozinhos com a sua mensagem: não escreva as opções.`;
  if (o.failing && step.type === "foto")
    return `Não deu para receber a foto pedida depois de ${MAX_ATTEMPTS} tentativas. Diga isso com gentileza e pergunte se a pessoa prefere falar com a equipe ou cancelar. Os botões (${FAIL_TEAM}, ${FAIL_CANCEL}) vão sozinhos com a sua mensagem: não escreva as opções.`;
  switch (step.type) {
    case "instrucao":
      return `${step.text}\nQuando este passo estiver cumprido (se ele pede uma resposta da pessoa, só depois que ela respondeu), chame concluir_passo e siga o que a ferramenta devolver.`;
    case "dado":
      return FIXED_KINDS.has(step.kind)
        ? `${step.text}\nO BoaVoz confere o ${label(step.kind)} quando a pessoa mandar: não confira você e não invente.`
        : `${step.text}\nQuando a pessoa informar, chame informar_dado com o valor${step.kind === "data" ? " no formato dd/mm/aaaa" : " exatamente como ela escreveu"}.`;
    case "botoes":
      return `${step.text}\nOs botões (${step.options.map((x) => x.title).join(", ")}) vão sozinhos com a sua mensagem: escreva só a pergunta, sem listar as opções e sem chamar mostrar_opcoes.`;
    case "acao":
      return `Chame agora a ferramenta acao_${step.action}: os dados já informados no roteiro vão preenchidos pelo BoaVoz (não peça de novo). Com o resultado: ${step.text}`;
    case "foto":
      return `${step.text}\nA pessoa manda a foto por aqui. O BoaVoz confere se ela mostra o que este passo pede: se mostra, o roteiro segue sozinho; se não, você é avisado e pede outra dizendo o que faltou. Não chame concluir_passo neste passo. Nunca peça foto de documento pessoal, cartão ou comprovante de pagamento.`;
  }
}

export interface RunView {
  name: string;
  steps: RoutineStep[];
  stepId: string;
  variables: RoutineVariables;
  failing: boolean;
}

/**
 * O bloco do roteiro em andamento, depois do histórico (pesa mais que ele): o passo atual, os dados
 * já informados, o que aconteceu nesta vez e as regras. Pura.
 */
export function routinePrompt(v: RunView, note: string | null): string {
  const i = v.steps.findIndex((s) => s.id === v.stepId);
  const step = v.steps[i];
  return [
    `ROTEIRO EM ANDAMENTO: "${v.name}", passo ${i + 1} de ${v.steps.length}.`,
    `Passo atual (siga só este): ${stepInstruction(step, { failing: v.failing })}`,
    variablesLine(v.variables),
    note ? `Nesta mensagem: ${note}` : "",
    'Regras: siga o passo atual com naturalidade, sem pular nem inventar passos. Se a pessoa perguntar outra coisa, responda e retome o passo só se ela ainda quiser isso. Se ela mudou de assunto e não quer mais, ou quiser parar, chame cancelar_roteiro (ofereça "cancelar", nunca "sair"). Se o assunto novo é de outro roteiro, chame iniciar_roteiro com ele. Se pedir uma pessoa da equipe, chame chamar_atendente.',
  ]
    .filter(Boolean)
    .join("\n");
}
