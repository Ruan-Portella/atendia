import { generateText } from "ai";
import { chatModel, chatModelId, modelCallOptions } from "./ai";
import { usageFrom, type UsageTokens } from "./ai-usage";
import { normalizeGateText } from "./gate/match";

/*
 * Risco à vida ou à integridade (Peça 10, Camada 1), em qualquer bot. Com a IA respondendo, ela
 * acolhe e chama chamar_atendente com urgente=true. Com a IA fora (atendente assumiu, modo só
 * humano), este dicionário curto roda em toda mensagem e, se acusar, uma checagem barata de IA
 * confirma. Nunca orienta clinicamente; nunca promete resposta rápida da equipe.
 */

/** Texto fixo (Textos legais, seção 6; proposta, a revisar). */
export const RISK_TEXT =
  "Sinto muito que você esteja passando por isso. Se for uma emergência, ligue agora: SAMU 192 ou Polícia 190. Para conversar com alguém a qualquer hora, o CVV atende de graça, 24 horas, pelo 188. Sua mensagem fica registrada para a nossa equipe.";

/** Termos e frases (sem acento, minúsculas). Só filtro: quem confirma é a checagem de IA. */
const RISK_TERMS = [
  "me matar", "vou me matar", "quero morrer", "tirar minha vida", "tirar a minha vida", "acabar com a minha vida", "acabar com tudo",
  "suicidio", "suicidar", "nao quero mais viver", "nao aguento mais viver", "me cortar", "me cortando", "autolesao", "me machucar",
  "overdose", "tomei todos os remedios", "nao consigo respirar", "nao esta respirando", "desmaiou", "infarto", "avc", "convulsao",
  "sangrando muito", "estou sendo agredida", "estou sendo agredido", "ele vai me matar", "ameacando me matar", "violencia domestica",
  "me bateu", "socorro",
];
const PATTERNS = RISK_TERMS.map((t) => new RegExp(` ${t.replace(/ /g, " ")} `));

export function riskHits(text: string): string[] {
  const t = normalizeGateText(text);
  return RISK_TERMS.filter((_, i) => PATTERNS[i].test(t));
}

/**
 * Checagem de IA, só quando o dicionário acusa: "há risco imediato?". Na dúvida, sim. Fica no
 * modelo principal (não no barato do portão): roda pouco e é risco à vida.
 */
export async function confirmRisk(text: string, onUsage?: (u: UsageTokens) => void): Promise<boolean> {
  try {
    const r = await generateText({
      model: chatModel(),
      system: "Você classifica mensagens de atendimento. Responda só SIM ou NAO.",
      prompt: `A mensagem abaixo indica risco imediato à vida ou à integridade de alguém (ideia de suicídio, autolesão, emergência médica, violência)? Expressões figuradas ("morri de rir", "esse preço me mata") não contam.\n\nMensagem: """${text.slice(0, 1000)}"""`,
      ...modelCallOptions(chatModelId(), { temperature: 0, cacheKey: "boavoz-risco" }),
      maxRetries: 3,
    });
    onUsage?.(usageFrom(r.response?.modelId ?? chatModelId(), r.totalUsage));
    return !/^\s*n[aã]o\b/i.test(r.text);
  } catch {
    return true; // sem confirmação, vai o texto fixo: errar para o lado seguro
  }
}

/** Risco confirmado na mensagem (dicionário + IA). */
export async function detectRisk(text: string, onUsage?: (u: UsageTokens) => void): Promise<boolean> {
  return riskHits(text).length > 0 && (await confirmRisk(text, onUsage));
}
