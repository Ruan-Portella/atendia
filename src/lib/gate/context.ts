import { categoryLabel, dictionaryHits } from "./match";
import { CATEGORIES, type GateCategory, type GateChannel } from "./rules";
import type { AgeStatus } from "./age";

/*
 * O que a IA principal vê da base nos canais da Meta: trecho com item proibido nunca; com bebida
 * ou remédio, só depois do "Sim" do 18+. Tirar do contexto é mais seguro que pedir no prompt para
 * não citar (a IA cita o que está na frente dela). O corte é por frase, para não perder o resto
 * da linha ("Pedidos pelo site: …" fica). A classificação da base por IA (parte 6) refina isto.
 */
export function gatedContext(context: string, o: { channel: Exclude<GateChannel, "widget">; contactPhone?: string | null; age: AgeStatus; exempt?: readonly GateCategory[] }): { context: string; hidden: GateCategory[] } {
  const hidden = new Set<GateCategory>();
  const keep = (sentence: string) => {
    const hits = dictionaryHits(sentence, { channel: o.channel, contactPhone: o.contactPhone, exempt: o.exempt }).filter((h) => h.level === "proibido" || o.age !== "sim");
    for (const h of hits) hidden.add(h.category);
    return !hits.length;
  };
  const out = context
    .split("\n")
    .map((line) => line.split(/(?<=[.!?;])\s+/).filter(keep).join(" "))
    .join("\n");
  return { context: out, hidden: [...hidden] };
}

/**
 * O mesmo corte nas respostas antigas do bot que vão no histórico: sem isso, depois de zerar o
 * 18+ no painel, a IA repetia "Brahma R$ 7" de uma resposta de antes. Só as do bot: a fala da
 * pessoa fica como ela escreveu.
 */
export function gatedHistory<M extends { role: string; parts: Array<{ type: string; text?: string }> }>(messages: M[], o: Parameters<typeof gatedContext>[1]): M[] {
  return messages.map((m) =>
    m.role !== "assistant"
      ? m
      : { ...m, parts: m.parts.map((p) => (p.type === "text" && typeof p.text === "string" ? { ...p, text: gatedContext(p.text, o).context.trim() || "(omitido)" } : p)) },
  );
}

/** Linha para o prompt quando a base tinha bebida ou remédio que ficaram de fora. null sem nada oculto. */
export function hiddenNote(hidden: GateCategory[], age: AgeStatus): string | null {
  const regulated = hidden.filter((c) => CATEGORIES[c].level === "regulamentado");
  if (!regulated.length || age === "sim") return null;
  const labels = regulated.map(categoryLabel).join(" e ");
  return age === "nao"
    ? `A base tem ${labels}, mas esses itens ficam ocultos para esta pessoa (disse que não tem 18 anos): não fale deles, não registre pergunta sobre eles e não diga que a empresa não tem; ofereça o resto.`
    : `A base tem ${labels}, ocultos até a pessoa confirmar 18+: se ela pedir esses itens ou perguntar o que tem deles (cardápio de bebidas, carta de vinhos, remédios), chame pedir_confirmacao_18 e não escreva mais nada; nunca diga que a empresa não tem. Se ela pedir só o que não é 18+ (bebida sem álcool, refrigerante, suco, água), responda com esses itens sem perguntar a idade.`;
}
