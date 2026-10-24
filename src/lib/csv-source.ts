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

/**
 * A planilha guardada (uma linha por item, "Coluna: valor; Coluna: valor") de volta em colunas e
 * linhas, para ver e editar no painel. Um pedaço sem "Coluna: " é o resto do valor anterior (o
 * valor tinha "; " dentro). Pura.
 */
export function parseSheet(text: string): { cols: string[]; rows: string[][] } {
  const cols: string[] = [];
  const parsed = (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const cells: Record<string, string> = {};
      let last: string | null = null;
      for (const part of line.split("; ")) {
        const m = /^([^:;]{1,60}): ([\s\S]*)$/.exec(part);
        if (m) {
          last = m[1].trim();
          if (!cols.includes(last)) cols.push(last);
          cells[last] = cells[last] ? `${cells[last]}; ${m[2].trim()}` : m[2].trim();
        } else if (last) cells[last] = `${cells[last]}; ${part}`;
      }
      return cells;
    });
  return { cols, rows: parsed.map((c) => cols.map((k) => c[k] ?? "")) };
}

/** As colunas e linhas de volta no texto guardado (linha vazia sai). Pura. */
export function sheetToText(cols: string[], rows: string[][]): string {
  return rows
    .map((r) => cols.map((k, i) => ((r[i] ?? "").trim() ? `${k}: ${(r[i] ?? "").trim()}` : null)).filter(Boolean).join("; "))
    .filter(Boolean)
    .join("\n");
}
