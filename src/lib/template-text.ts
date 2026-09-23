/**
 * Texto dos modelos de mensagem do WhatsApp: tipos, variáveis e validação. Sem nada de servidor,
 * para o formulário de envio (no navegador) usar as mesmas regras.
 */

export const TEMPLATE_LANGUAGE = "pt_BR";
export type TemplateCategory = "UTILITY" | "MARKETING";

export interface Template {
  id: string;
  name: string;
  status: string; // APPROVED, PENDING, REJECTED, PAUSED, DISABLED…
  category: string;
  language: string;
  rejected_reason?: string;
  components?: TemplateComponent[];
}

export interface TemplateComponent {
  type: string; // HEADER, BODY, FOOTER, BUTTONS, CAROUSEL…
  format?: string; // no HEADER: TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION
  text?: string;
  buttons?: Array<{ type: string; url?: string }>;
}

/**
 * Por que o Boavoz ainda não consegue mandar este modelo (null = consegue). O envio só preenche
 * variáveis do texto; mídia no cabeçalho, carrossel e botões com parte variável ficam de fora.
 */
export function unsupportedReason(t: Pick<Template, "components">): string | null {
  const comps = t.components ?? [];
  for (const c of comps) {
    if (c.type === "HEADER" && c.format && c.format !== "TEXT") return "tem imagem, vídeo ou documento no cabeçalho";
    if (c.type === "HEADER" && /\{\{/.test(c.text ?? "")) return "tem variável no cabeçalho";
    if (c.type === "CAROUSEL") return "é um carrossel";
    if (c.type === "BUTTONS" && (c.buttons ?? []).some((b) => !["QUICK_REPLY", "PHONE_NUMBER", "URL"].includes(b.type) || /\{\{/.test(b.url ?? ""))) return "tem botão com parte variável";
    if (!["HEADER", "BODY", "FOOTER", "BUTTONS"].includes(c.type)) return "usa um recurso que o Boavoz ainda não envia";
  }
  const body = templateBody(t);
  if (/\{\{\s*[^\d\s}]/.test(body)) return "usa variáveis com nome em vez de número";
  return null;
}

export const STATUS_LABEL: Record<string, string> = {
  APPROVED: "aprovado",
  PENDING: "em análise",
  REJECTED: "reprovado",
  PAUSED: "pausado",
  DISABLED: "desativado",
  IN_APPEAL: "em recurso",
};

/** Números das variáveis {{1}}, {{2}}… na ordem em que aparecem (sem repetir). */
export function templateVariables(body: string): number[] {
  const seen: number[] = [];
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}

/** Texto do corpo de um modelo, para mostrar e saber quantas variáveis ele pede. */
export function templateBody(t: Pick<Template, "components">): string {
  return t.components?.find((c) => c.type === "BODY")?.text ?? "";
}

/** O texto como o contato vai receber: cada {{n}} trocado pelo valor n (vazio fica como está). */
export function renderTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n: string) => params[Number(n) - 1]?.trim() || m);
}

/** O que o formulário de envio precisa saber de um modelo aprovado. */
export interface SendableTemplate {
  name: string;
  language: string;
  body: string;
  vars: number;
}

export function toSendable(t: Template): SendableTemplate {
  const body = templateBody(t);
  return { name: t.name, language: t.language, body, vars: templateVariables(body).length };
}

/** Valores das variáveis enviados pelo formulário (campos param_1, param_2…). */
export function formParams(formData: FormData, count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(formData.get(`param_${i + 1}`) ?? "").trim());
}

/** "Retorno Atendimento!" vira "retorno_atendimento": o formato de nome que a Meta aceita. */
export function templateName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // acentos soltos pelo NFD
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Linhas de um textarea, uma por variável. */
export function lines(value: string): string[] {
  return value.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Regras da Meta, conferidas antes de enviar para não gastar uma reprovação à toa. */
export function validateTemplate(input: { name: string; body: string; examples: string[] }): string | null {
  if (!/^[a-z0-9_]{1,512}$/.test(input.name)) return "O nome aceita só letras minúsculas, números e _ (ex.: aviso_de_retorno).";
  const body = input.body.trim();
  if (body.length < 5) return "Escreva o texto da mensagem.";
  if (body.length > 1024) return "O texto pode ter no máximo 1.024 caracteres.";
  const vars = templateVariables(body);
  if (vars.some((n, i) => n !== i + 1)) return "Numere as variáveis em ordem, começando em {{1}}: {{1}}, {{2}}, {{3}}…";
  if (/^\s*\{\{\s*\d+\s*\}\}|\{\{\s*\d+\s*\}\}\s*$/.test(body)) return "A Meta não aceita variável no começo ou no fim do texto. Coloque alguma palavra antes e depois.";
  if (input.examples.length < vars.length) return `Dê um exemplo para cada variável (${vars.length}), um por linha. A Meta usa os exemplos para aprovar.`;
  return null;
}
