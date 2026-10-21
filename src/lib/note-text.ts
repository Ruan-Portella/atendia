/* O texto das notas internas (Caixa de entrada, parte 4): puro, para a tela e o servidor. */

export const NOTE_MAX = 1000;

/** O texto da nota: sem espaços nas pontas e até NOTE_MAX caracteres; vazio vira null. Pura. */
export function noteBody(raw: unknown): string | null | { error: string } {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  if (s.length > NOTE_MAX) return { error: `Nota muito longa (até ${NOTE_MAX.toLocaleString("pt-BR")} caracteres).` };
  return s;
}
