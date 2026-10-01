import { generateText } from "ai";
import { chatModel, chatModelId, modelCallOptions } from "../ai";
import { dictionaryHits, hitSummary, categoryLabel } from "./match";
import { GATE_TEXTS, type GateCategory, type GateChannel } from "./rules";
import type { AgeStatus } from "./age";

/*
 * Portão na entrada (WhatsApp e Instagram): o que o contato pede. Etapa 1, dicionário em toda
 * mensagem; etapa 2, IA só quando o dicionário acusa, com a pergunta "o contato PEDE o item?"
 * (mencionar não basta: "bebi cerveja ontem, posso tomar o remédio?" não dispara nada).
 */

export interface EntranceInput {
  text: string;
  channel: Exclude<GateChannel, "widget">;
  contactPhone?: string | null;
  age: AgeStatus;
  /** Contexto que a busca trouxe para esta pergunta (atalho do 18+ só se ele tem item regulamentado). */
  context: string;
  companyName: string;
  /** Classificador da etapa 2 (troca nos testes). */
  classify?: (text: string, categories: GateCategory[], companyName: string, blocked: GateCategory[]) => Promise<Classification>;
}

export interface Classification {
  /** Categorias que o contato está de fato pedindo (das que o dicionário acusou). */
  pedidas: GateCategory[];
  tem_outro_assunto: boolean;
  /** A mensagem reescrita sem os pedidos das categorias barradas (só quando há barradas). */
  resto?: string;
}

export type EntranceDecision =
  /** Só pedido proibido: texto fixo, sem a IA principal. */
  | { kind: "proibido"; categories: GateCategory[] }
  /** Pedido de regulamentado, idade não confirmada e a base tem o item: pergunta de 18+ direto. */
  | { kind: "pede_18"; categories: GateCategory[] }
  /** Só pedido de regulamentado, por quem disse que não tem 18: texto fixo, sem a IA principal. */
  | { kind: "nao_18"; categories: GateCategory[] }
  /**
   * Segue para a IA, com instrução extra e/ou texto fixo antes da resposta. `question`: a
   * mensagem sem os itens barrados, que a IA responde no lugar da original (ela nem vê o item).
   */
  | { kind: "ia"; prefix?: string; instruction?: string; question?: string; regulated: GateCategory[]; prohibited: GateCategory[] };

/**
 * Etapa 2: IA barata, só quando o dicionário acusa. Cada categoria marcada conta como pedida, a
 * não ser que a IA diga "menciona" (lado seguro: um "vendem X?" no meio de outra pergunta já
 * escapou quando a IA tinha de listar o que era pedido). Com categorias barradas para esta
 * pessoa, devolve também a mensagem sem esses pedidos.
 */
export async function classifyRequest(text: string, categories: GateCategory[], companyName: string, blocked: GateCategory[] = []): Promise<Classification> {
  const labels = categories.map((c) => `${c} (${categoryLabel(c)})`).join(", ");
  const rest = blocked.length
    ? `\nTambém devolva "resto": a mensagem reescrita sem os pedidos de ${blocked.map(categoryLabel).join(" e ")}, mantendo o resto com as mesmas palavras ("" se não sobrar nada).`
    : "";
  try {
    const r = await generateText({
      model: chatModel(),
      system: "Você classifica mensagens de clientes de uma empresa. Responda só com JSON válido, sem texto antes ou depois.",
      prompt: `Empresa: ${companyName}. Mensagem do cliente: """${text.slice(0, 1500)}"""
Um filtro de palavras marcou estas categorias: ${labels}.
Para cada categoria, diga se o cliente PEDE o item ou só o MENCIONA.
- "pede": quer comprar, pede, pergunta se a empresa vende ou tem, pergunta o preço, pede o cardápio ou a lista desses itens. Vale mesmo quando é só uma parte de uma mensagem com outros assuntos (ex.: "que horas vocês abrem? e tem narguilé?": narguilé pede).
- "menciona": cita sem pedir: conta o que fez, pergunta de saúde ou de uso (qual remédio tomar para um sintoma, dose, se pode misturar), receita, comparação (ex.: "tomei vinho no jantar, posso tomar paracetamol?": vinho e paracetamol mencionam; "estou com febre, que remédio eu tomo?": remédio menciona, é pergunta de saúde; "gastei 20 reais em cerveja": menciona).
Na dúvida, "pede".${rest}
Responda: {"categorias": {"categoria": "pede" | "menciona"}, "tem_outro_assunto": true|false${blocked.length ? ', "resto": "..."' : ""}}, onde tem_outro_assunto diz se a mensagem também pede ou pergunta outra coisa além desses itens.`,
      ...modelCallOptions(chatModelId(), { temperature: 0, cacheKey: "boavoz-portao" }),
      maxRetries: 3,
    });
    return parseClassification(r.text, categories);
  } catch {
    return { pedidas: categories, tem_outro_assunto: true };
  }
}

/** Lê a resposta do classificador. Categoria sem resposta clara de "menciona" conta como pedida. */
export function parseClassification(raw: string, categories: GateCategory[]): Classification {
  try {
    const json = JSON.parse(raw.replace(/^\s*```(?:json)?|```\s*$/g, "").trim()) as { categorias?: Record<string, string>; tem_outro_assunto?: boolean; resto?: unknown };
    const said = json.categorias ?? {};
    return {
      pedidas: categories.filter((c) => String(said[c] ?? "").trim().toLowerCase() !== "menciona"),
      tem_outro_assunto: json.tem_outro_assunto === true,
      ...(typeof json.resto === "string" && json.resto.trim() ? { resto: json.resto.trim().slice(0, 1500) } : {}),
    };
  } catch {
    return { pedidas: categories, tem_outro_assunto: true };
  }
}

export async function decideEntrance(input: EntranceInput): Promise<EntranceDecision> {
  const scan = (text: string) => dictionaryHits(text, { channel: input.channel, contactPhone: input.contactPhone });
  const hits = scan(input.text);
  if (!hits.length) return { kind: "ia", regulated: [], prohibited: [] };
  // o nível vem do dicionário (canal e país já aplicados); a IA só diz o que foi pedido
  const levelOf = new Map(hits.map((h) => [h.category, h.level]));
  const summary = hitSummary(hits);
  // barrado para esta pessoa: proibido sempre; regulamentado para quem disse que não tem 18
  const blocked = [...summary.proibidos, ...(input.age === "nao" ? summary.regulamentados : [])];
  const c = await (input.classify ?? classifyRequest)(input.text, [...summary.proibidos, ...summary.regulamentados], input.companyName, blocked);
  const prohibited = [...new Set(c.pedidas.filter((x) => levelOf.get(x) === "proibido"))];
  const regulated = [...new Set(c.pedidas.filter((x) => levelOf.get(x) === "regulamentado"))];

  // tudo o que foi pedido está barrado para esta pessoa (e não há outro assunto): texto fixo
  if (!c.tem_outro_assunto && prohibited.length && (!regulated.length || input.age === "nao")) return { kind: "proibido", categories: [...prohibited, ...regulated] };
  // a IA prometia "vou confirmar com a equipe" sobre a cerveja para quem disse que não tem 18
  if (!c.tem_outro_assunto && regulated.length && !prohibited.length && input.age === "nao") return { kind: "nao_18", categories: regulated };

  // atalho determinístico do 18+: pediu regulamentado, idade vazia e a base tem o item
  if (regulated.length && input.age === null && !prohibited.length) {
    const contextHasItem = scan(input.context).some((h) => regulated.includes(h.category));
    if (contextHasItem) return { kind: "pede_18", categories: regulated };
  }

  const blockedAsked = [...prohibited, ...(input.age === "nao" ? regulated : [])];
  if (!blockedAsked.length) return { kind: "ia", regulated, prohibited };
  // a IA responde à mensagem sem os itens barrados (pedir no prompt para não citar não bastava:
  // ela dizia "sobre a Heineken, vou confirmar com a equipe"); a reescrita que ainda tem o item
  // não serve, e aí fica a mensagem original com a instrução
  const question = c.resto && !scan(c.resto).some((h) => blockedAsked.includes(h.category)) ? c.resto : undefined;
  const notes: string[] = [];
  if (prohibited.length) notes.push(`A pessoa também pediu ${prohibited.map(categoryLabel).join(", ")}: não trate disso, não cite o item; responda só o resto.`);
  if (regulated.length && input.age === "nao") notes.push(`A pessoa pediu ${regulated.map(categoryLabel).join(", ")}, mas disse que não tem 18 anos: não fale desses itens, não registre pergunta sobre eles nem diga que vai confirmar com a equipe; responda só o resto.`);
  return {
    kind: "ia",
    prefix: GATE_TEXTS.prohibitedMixed,
    instruction: question ? undefined : notes.join(" "),
    ...(question ? { question } : {}),
    regulated,
    prohibited,
  };
}
