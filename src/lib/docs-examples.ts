import data from "./api-exemplos.json";

/*
 * Exemplos das páginas da API na documentação (Entrada e docs, parte 2): saem da mesma fonte da
 * coleção do Postman (docs/postman/gerar_colecao.py grava api-exemplos.json). Daqui saem o cURL e
 * o JavaScript de cada exemplo. Puro.
 */

export interface DocExample {
  page: string;
  id: string;
  title: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Caminho depois de /api/v1, já com os ids de exemplo. */
  path: string;
  query: [string, string][];
  headers: Record<string, string>;
  body: unknown;
  status: number;
  response: unknown;
  /** A resposta é o arquivo (sem JSON). */
  binary: boolean;
}

export const API_BASE = "https://boavoz.com/api/v1";

const ALL = data.exemplos as DocExample[];

/** Os exemplos de uma página, na ordem pedida (um id que não existe quebra o build). */
export function examplesFor(page: string, ids: string[]): DocExample[] {
  return ids.map((id) => {
    const ex = ALL.find((e) => e.page === page && e.id === id);
    if (!ex) throw new Error(`exemplo ${page}/${id} não existe: rode python docs/postman/gerar_colecao.py`);
    return ex;
  });
}

export function exampleUrl(ex: Pick<DocExample, "path" | "query">): string {
  const qs = ex.query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `${API_BASE}/${ex.path}${qs ? `?${qs}` : ""}`;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

/** cURL para o terminal (a chave vem da variável de ambiente BOAVOZ_API_KEY). */
export function curlOf(ex: DocExample): string {
  const lines = [`curl${ex.method === "GET" ? "" : ` -X ${ex.method}`} "${exampleUrl(ex)}"`, `  -H "Authorization: Bearer $BOAVOZ_API_KEY"`];
  if (ex.body !== null && ex.body !== undefined) lines.push(`  -H "Content-Type: application/json"`);
  for (const [k, v] of Object.entries(ex.headers)) lines.push(`  -H "${k}: ${v}"`);
  // aspas simples no corpo: fecha, escapa e abre de novo (o jeito do shell)
  if (ex.body !== null && ex.body !== undefined) lines.push(`  -d '${json(ex.body).replace(/'/g, `'\\''`)}'`);
  if (ex.binary) lines.push(`  -o arquivo`);
  return lines.join(" \\\n");
}

/** Chaves que são nomes válidos ficam sem aspas, como se escreve em JavaScript. */
const jsObject = (v: unknown, indent: string) =>
  json(v)
    .replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, "$1$2:")
    .split("\n")
    .join(`\n${indent}`);

/** JavaScript com fetch (Node 18 ou mais novo; a chave em process.env.BOAVOZ_API_KEY). */
export function fetchOf(ex: DocExample): string {
  const headers = [`    Authorization: \`Bearer \${process.env.BOAVOZ_API_KEY}\`,`];
  const hasBody = ex.body !== null && ex.body !== undefined;
  if (hasBody) headers.push(`    "Content-Type": "application/json",`);
  for (const [k, v] of Object.entries(ex.headers)) headers.push(`    "${k}": ${JSON.stringify(v)},`);
  const opts = [...(ex.method === "GET" ? [] : [`  method: "${ex.method}",`]), "  headers: {", ...headers, "  },", ...(hasBody ? [`  body: JSON.stringify(${jsObject(ex.body, "  ")}),`] : [])];
  const read = ex.binary ? "const arquivo = Buffer.from(await res.arrayBuffer());" : ex.response === null || ex.response === undefined ? "console.log(res.status);" : "const data = await res.json();";
  return [`const res = await fetch("${exampleUrl(ex)}", {`, ...opts, "});", read].join("\n");
}

/** A resposta como aparece na documentação. */
export function responseOf(ex: DocExample): string {
  if (ex.binary) return "(o arquivo, com Content-Type e Content-Disposition)";
  if (ex.response === null || ex.response === undefined) return "(sem corpo)";
  return json(ex.response);
}
