import { parseCsv } from "./contact-import";

/*
 * Fonte do tipo CSV (planilha de produtos, preços, convênios...). O arquivo vira texto na hora do
 * envio: cada linha sai com o nome das colunas ("Produto: X; Preço: Y"), para que qualquer trecho
 * cortado pela leitura continue se explicando sozinho. O texto fica em sources.content e daí em
 * diante a fonte é lida como um Texto. Pura.
 */

export const CSV_MAX_BYTES = 2 * 1024 * 1024;
export const CSV_MAX_ROWS = 5000;

export function csvToText(raw: string): { text: string; rows: number } | { error: string } {
  const [head = [], ...body] = parseCsv(raw);
  const cols = head.map((h, i) => h.trim() || `Coluna ${i + 1}`);
  if (!cols.length || !body.length) return { error: "A planilha precisa de um cabeçalho e pelo menos uma linha." };
  if (body.length > CSV_MAX_ROWS) return { error: `A planilha passa de ${CSV_MAX_ROWS} linhas. Divida em arquivos menores.` };
  const lines = body
    .map((r) =>
      r
        .map((v, i) => [cols[i] ?? `Coluna ${i + 1}`, v.trim()] as const)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; "),
    )
    .filter(Boolean);
  if (!lines.length) return { error: "A planilha não tem nenhuma linha preenchida." };
  return { text: lines.join("\n"), rows: lines.length };
}
