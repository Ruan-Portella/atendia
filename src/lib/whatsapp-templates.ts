import { graphFor, type WaChannel } from "./whatsapp";

/**
 * Modelos de mensagem (templates) do WhatsApp: a única forma de escrever para alguém fora da
 * janela de 24 h. Ficam na conta do WhatsApp Business (WABA) e passam pela aprovação da Meta.
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
  components?: Array<{ type: string; text?: string }>;
}

export interface TemplateChannel extends WaChannel {
  waba_id: string;
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

export async function listTemplates(ch: TemplateChannel): Promise<Template[]> {
  const res = await graphFor<{ data?: Template[] }>(ch, `${ch.waba_id}/message_templates?fields=id,name,status,category,language,rejected_reason,components&limit=100`);
  return res.data ?? [];
}

export async function createTemplate(ch: TemplateChannel, input: { name: string; category: TemplateCategory; body: string; examples: string[] }) {
  const vars = templateVariables(input.body);
  const bodyComponent: Record<string, unknown> = { type: "BODY", text: input.body.trim() };
  if (vars.length) bodyComponent.example = { body_text: [input.examples.slice(0, vars.length)] };
  return graphFor<{ id: string; status: string }>(ch, `${ch.waba_id}/message_templates`, {
    body: { name: input.name, language: TEMPLATE_LANGUAGE, category: input.category, components: [bodyComponent] },
  });
}

export async function deleteTemplate(ch: TemplateChannel, name: string) {
  await graphFor(ch, `${ch.waba_id}/message_templates?name=${encodeURIComponent(name)}`, { method: "DELETE" });
}

export async function sendTemplate(ch: WaChannel, to: string, t: { name: string; language: string }, params: string[]) {
  const components = params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : [];
  return graphFor<{ messages?: Array<{ id: string }> }>(ch, `${ch.phone_number_id}/messages`, {
    body: { messaging_product: "whatsapp", to, type: "template", template: { name: t.name, language: { code: t.language }, components } },
  });
}
