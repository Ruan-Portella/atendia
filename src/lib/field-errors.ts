/**
 * Mensagens de validação dos formulários (redesenho, etapa 1): o erro aparece embaixo do campo,
 * em português e dizendo o que fazer, no lugar do balão do navegador. Pura: recebe só o que o
 * campo informa (o ValidityState e os limites), para dar para testar sem navegador.
 */
export interface FieldInfo {
  tagName: string;
  type: string;
  validity: Pick<ValidityState, "valueMissing" | "typeMismatch" | "patternMismatch" | "tooShort" | "tooLong" | "rangeUnderflow" | "rangeOverflow" | "stepMismatch" | "badInput" | "customError" | "valid">;
  min?: string;
  max?: string;
  minLength?: number;
  maxLength?: number;
  step?: string;
  /** No pattern, o title explica o formato esperado. */
  title?: string;
  /** O setCustomValidity do campo. */
  validationMessage?: string;
}

const brNumber = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v).toLocaleString("pt-BR") : v);

export function fieldError(f: FieldInfo): string | null {
  const v = f.validity;
  if (v.valid) return null;
  const tag = f.tagName.toLowerCase();
  const type = f.type.toLowerCase();
  if (v.customError && f.validationMessage) return f.validationMessage;
  if (v.valueMissing) {
    if (type === "checkbox") return "Marque esta opção para continuar.";
    if (type === "radio" || tag === "select") return "Escolha uma opção.";
    if (type === "file") return "Escolha um arquivo.";
    return "Preencha este campo.";
  }
  if (v.badInput) return type === "number" ? "Digite só números." : "Confira o que foi digitado.";
  if (v.typeMismatch) {
    if (type === "email") return "Confira o e-mail: falta algo antes ou depois do @ (ex.: ana@loja.com.br).";
    if (type === "url") return "Confira o endereço, com o https:// (ex.: https://loja.com.br).";
    return "Confira o formato.";
  }
  if (v.patternMismatch) return f.title?.trim() || "Confira o formato.";
  if (v.tooShort && f.minLength && f.minLength > 0) return `Use pelo menos ${f.minLength} caracteres.`;
  if (v.tooLong && f.maxLength && f.maxLength > 0) return `Use no máximo ${f.maxLength} caracteres.`;
  if (v.rangeUnderflow && f.min) return `O mínimo é ${brNumber(f.min)}.`;
  if (v.rangeOverflow && f.max) return `O máximo é ${brNumber(f.max)}.`;
  if (v.stepMismatch) return !f.step || f.step === "1" ? "Use um número inteiro." : `Use múltiplos de ${brNumber(f.step)}.`;
  return f.validationMessage || "Confira este campo.";
}
