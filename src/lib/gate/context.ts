import { categoryLabel, dictionaryHits } from "./match";
import { CATEGORIES, type GateCategory, type GateChannel } from "./rules";
import type { AgeStatus } from "./age";

/*
 * O que a IA principal vê da base nos canais da Meta: trecho com item proibido nunca; com bebida
 * ou remédio, só depois do "Sim" do 18+. Tirar do contexto é mais seguro que pedir no prompt para
 * não citar (a IA cita o que está na frente dela). O corte é por frase, para não perder o resto
 * da linha ("Pedidos pelo site: …" fica). A classificação da base por IA (parte 6) refina isto.
 */
export function gatedContext(context: string, o: { channel: Exclude<GateChannel, "widget">; contactPhone?: string | null; age: AgeStatus }): { context: string; hidden: GateCategory[] } {
  const hidden = new Set<GateCategory>();
  const keep = (sentence: string) => {
    const hits = dictionaryHits(sentence, { channel: o.channel, contactPhone: o.contactPhone }).filter((h) => h.level === "proibido" || o.age !== "sim");
    for (const h of hits) hidden.add(h.category);
    return !hits.length;
  };
  const out = context
    .split("\n")
    .map((line) => line.split(/(?<=[.!?;])\s+/).filter(keep).join(" "))
    .join("\n");
  return { context: out, hidden: [...hidden] };
}

/** Linha para o prompt quando a base tinha bebida ou remédio que ficaram de fora. null sem nada oculto. */
export function hiddenNote(hidden: GateCategory[], age: AgeStatus): string | null {
  const regulated = hidden.filter((c) => CATEGORIES[c].level === "regulamentado");
  if (!regulated.length || age === "sim") return null;
  const labels = regulated.map(categoryLabel).join(" e ");
  return age === "nao"
    ? `A base tem ${labels}, mas esses itens ficam ocultos para esta pessoa (disse que não tem 18 anos): não fale deles e não diga que a empresa não tem; ofereça o resto.`
    : `A base tem ${labels}, ocultos até a pessoa confirmar 18+: se ela pedir esses itens ou perguntar o que tem deles (cardápio de bebidas, carta de vinhos, remédios), chame pedir_confirmacao_18 e não escreva mais nada; nunca diga que a empresa não tem.`;
}
