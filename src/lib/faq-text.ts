/*
 * O texto de uma fonte de perguntas e respostas: um par por parágrafo, "P: …" e "R: …" (o mesmo
 * formato das respostas que a equipe ensina, em knowledge.ts). O painel mostra em linhas
 * (components/faq-fields) e salva neste formato.
 */

export type FaqPair = { q: string; a: string };

/** O texto em pares; null quando algum parágrafo não está no formato (fica para editar como texto). */
export function parseFaq(text: string): FaqPair[] | null {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const pairs: FaqPair[] = [];
  for (const b of blocks) {
    const m = /^P:\s*([\s\S]*?)\n\s*R:\s*([\s\S]*)$/i.exec(b);
    if (!m) return null;
    pairs.push({ q: m[1].trim(), a: m[2].trim() });
  }
  return pairs;
}

/** Os pares no texto salvo; os pares vazios saem. */
export function faqText(pairs: FaqPair[]): string {
  return pairs
    .filter((r) => r.q.trim() || r.a.trim())
    .map((r) => `P: ${r.q.trim()}\nR: ${r.a.trim()}`)
    .join("\n\n");
}
