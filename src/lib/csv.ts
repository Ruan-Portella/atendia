/**
 * Célula de CSV com ponto e vírgula (Excel em português): aspas quando preciso e sem fórmula. O texto
 * que começa com =, +, -, @, tab ou quebra ganha um apóstrofo na frente: um nome de lead como
 * =HYPERLINK(...) não roda ao abrir a exportação (relatório de segurança de 23/10/2026, M8). Número
 * fica como número. Pura.
 */
export function csvCell(v: unknown): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  let s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
