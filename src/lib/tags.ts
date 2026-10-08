/* Etiquetas de contato (leva B3): regra pura, usada no painel, na planilha e no navegador. */

/** Etiquetas digitadas no painel: separadas por vírgula, sem "#", até 20, cada uma com até 30 caracteres, sem repetir. Pura. */
export function normalizeTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n;]/)) {
    const tag = part.replace(/\s+/g, " ").trim().replace(/^#+\s*/, "").slice(0, 30);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length === 20) break;
  }
  return out;
}
