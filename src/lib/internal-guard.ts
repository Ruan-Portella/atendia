import { normalizeGateText } from "./gate/payment";

/*
 * Campos internos das ações (spec "Formatos de payload", resposta das ações): o dev manda em
 * `internal` o que a IA precisa saber para decidir o que dizer, mas que não pode aparecer
 * ("bloqueado por inadimplência", um score). A IA recebe com a regra de nunca citar; e, como a
 * regra sozinha não garante, a resposta é conferida antes de sair: frase com um valor interno
 * escrito igual sai (paráfrase não dá para pegar: o que nunca pode vazar não deve ir na resposta).
 * Vale em todos os canais, inclusive no widget. O `internal` nunca vai ao navegador nem ao histórico.
 */

export const INTERNAL_RULE = 'Os campos de "interno" são só para você decidir o que dizer: nunca cite, nunca repita os valores e nunca diga que eles existem.';

/** Quando a resposta inteira era sobre um valor interno. */
export const INTERNAL_FALLBACK = "Não consigo te passar essa informação por aqui. Posso ajudar com outra coisa?";

/** Valores do `internal` que não podem aparecer: textos com 4+ letras ou números, números com 3+ dígitos. Função pura. */
export function internalTerms(value: unknown): string[] {
  const out = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (v == null || depth > 6) return;
    if (typeof v === "string") {
      const t = v.trim();
      if (t.replace(/[^\p{L}\p{N}]/gu, "").length >= 4) out.add(t.slice(0, 300));
    } else if (typeof v === "number" && Number.isFinite(v)) {
      // 4100 também aparece como "4.100" num texto em português
      if (String(v).replace(/\D/g, "").length >= 3) [String(v), v.toLocaleString("pt-BR")].forEach((s) => out.add(s));
    } else if (Array.isArray(v)) v.forEach((x) => visit(x, depth + 1));
    else if (typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => visit(x, depth + 1));
  };
  visit(value, 0);
  return [...out];
}

/** Frases (pontuação final), por linha, mantendo as quebras de parágrafo. */
const sentencesOf = (line: string) => line.split(/(?<=[.!?;])\s+/).filter((s) => s.trim());

/**
 * Tira da resposta as frases com um valor interno escrito igual (sem acento e sem caixa, palavra
 * inteira). leaked: algo saiu; o texto pode ficar vazio (quem chama usa INTERNAL_FALLBACK). Função pura.
 */
export function stripInternal(text: string, terms: string[]): { text: string; leaked: boolean } {
  if (!text || !terms.length) return { text, leaked: false };
  const needles = [...new Set(terms.map(normalizeGateText))].filter((n) => n.trim().length >= 3);
  const hit = (s: string) => {
    const n = normalizeGateText(s);
    return needles.some((x) => n.includes(x));
  };
  if (!hit(text)) return { text, leaked: false };
  const lines = text.split("\n").map((line) => (line.trim() ? sentencesOf(line).filter((s) => !hit(s)).join(" ") : line));
  const kept = lines
    .filter((l, i) => l.trim() || !text.split("\n")[i].trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: kept, leaked: true };
}
