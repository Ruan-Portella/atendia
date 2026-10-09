/*
 * Textos e regras puras das campanhas que o navegador também usa (assistente "Nova campanha").
 * Sem nada de servidor: o público e as conferências ficam em campaign-audience.ts.
 */

/** Advertência sugerida para campanha de bebida ou remédio (aviso, sem bloquear). */
export const REGULATED_ADVICE = "Sugestão: inclua a advertência pedida pelo CONAR (bebida: \"Beba com moderação\" e proibido para menores de 18 anos) ou pela Anvisa (remédio: \"Se persistirem os sintomas, o médico deverá ser consultado\").";

/** Variável do modelo: texto fixo ou o primeiro nome do contato (com um texto para quem não tem nome). */
export interface VariableSpec {
  mode: "fixed" | "name";
  value: string;
}

/** Valores das variáveis para um contato. Pura. */
export function renderVariables(specs: VariableSpec[], contactName: string | null): string[] {
  const first = (contactName ?? "").trim().split(/\s+/)[0] ?? "";
  return specs.map((v) => (v.mode === "name" && first ? first.slice(0, 60) : v.value.trim()));
}

/** Problema nas variáveis (todas preenchidas; o nome precisa de um texto para quem não tem). Pura. */
export function variablesProblem(specs: VariableSpec[], count: number): string | null {
  if (specs.length < count) return `O modelo tem ${count} variáve${count === 1 ? "l" : "is"}: preencha todas.`;
  for (const [i, v] of specs.slice(0, count).entries()) {
    if (!v.value.trim()) return v.mode === "name" ? `Variável {{${i + 1}}}: escreva o texto para quem não tem nome no cadastro (ex.: cliente).` : `Variável {{${i + 1}}}: preencha o texto.`;
    if (v.value.length > 200) return `Variável {{${i + 1}}}: até 200 caracteres.`;
    if (/[\n\t]| {5,}/.test(v.value)) return `Variável {{${i + 1}}}: a Meta não aceita quebra de linha, tabulação ou muitos espaços seguidos.`;
  }
  return null;
}
