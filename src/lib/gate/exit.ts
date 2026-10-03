import { dictionaryHits, normalizeGateText } from "./match";
import { isPaymentData } from "./payment";
import { GATE_TEXTS, type GateCategory, type GateChannel } from "./rules";
import type { AgeStatus } from "./age";

/*
 * Portão na saída (WhatsApp e Instagram): a última conferência da resposta da IA antes de ela
 * ir para o contato, só com o dicionário (sem IA, sem custo). É a rede de segurança: a entrada
 * já tira da base o que a pessoa não pode ver, mas a IA ainda pode trazer do histórico ou do
 * próprio conhecimento. Corta por frase, como a base: o resto da resposta fica.
 * - item proibido oferecido: a frase sai;
 * - bebida ou remédio oferecido sem o "Sim" do 18+: a frase sai (e, sem resposta de idade, vai o
 *   botão "Ver opções 18+");
 * - conversa com bebida ou remédio: dado de pagamento (chave Pix, copia e cola, link de
 *   pagamento, boleto) sai, e vai o caminho para finalizar fora do chat.
 * Só sai frase que OFERECE: negação ("não posso indicar remédio") e conselho de saúde ficam.
 */

export interface ExitInput {
  text: string;
  channel: Exclude<GateChannel, "widget">;
  contactPhone?: string | null;
  age: AgeStatus;
  /** Conversa com pedido de bebida ou remédio nas últimas 24 h (ou nesta mensagem). */
  regulatedConversation: boolean;
  /** Onde o contato finaliza o pedido desses itens (regulatedDestination); null sem canal. */
  destination: { canal: string; destino: string } | null;
  /** Categorias liberadas pelo BoaVoz para este chatbot ("isto não é {categoria}"). */
  exempt?: readonly GateCategory[];
}

export interface ExitResult {
  /** A resposta que pode sair (igual à da IA quando nada foi tirado). */
  text: string;
  prohibited: GateCategory[];
  regulated: GateCategory[];
  payment: boolean;
  /** Bebida ou remédio tirados de quem ainda não respondeu à idade: vai o botão "Ver opções 18+". */
  offerAdult: boolean;
  /** Não sobrou nada da resposta (o canal decide o texto fixo ou a pergunta de 18+). */
  emptied: boolean;
}

const NEGATION = /\b(nao|nunca|nem|jamais)\b/;
/** Sinal de oferta: preço (no texto original: o normalizado perde o "$"), ou dizer que tem, vende, oferece, está no cardápio. */
const PRICE = /R\$\s?\d/i;
const OFFER_WORDS = /\b(temos|tem sim|vendemos|vende|oferecemos|disponivel|disponiveis|a venda|pode pedir|peca|cardapio|custa|sai por|por apenas)\b/;
const offers = (sentence: string, norm: string) => PRICE.test(sentence) || OFFER_WORDS.test(norm);
/** Dado de pagamento: código do Pix, link de meio de pagamento, ou chave junto de Pix/boleto (payment.ts). */
const isPayment = isPaymentData;

/** Frases (pontuação final ou quebra de linha), mantendo a separação original para remontar. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+|\n+/).filter((s) => s.trim());
}

export function checkExit(input: ExitInput): ExitResult {
  const prohibited = new Set<GateCategory>();
  const regulated = new Set<GateCategory>();
  let payment = false;
  const keep: string[] = [];
  for (const s of sentences(input.text)) {
    const norm = normalizeGateText(s);
    const negated = NEGATION.test(norm);
    const hits = negated ? [] : dictionaryHits(s, { channel: input.channel, contactPhone: input.contactPhone, exempt: input.exempt });
    const banned = hits.filter((h) => h.level === "proibido");
    // bebida ou remédio só sai se a frase oferece o item e a pessoa não confirmou 18+
    const adult = input.age === "sim" || !offers(s, norm) ? [] : hits.filter((h) => h.level === "regulamentado");
    const pay = input.regulatedConversation && isPayment(s);
    banned.forEach((h) => prohibited.add(h.category));
    adult.forEach((h) => regulated.add(h.category));
    if (pay) payment = true;
    if (!banned.length && !adult.length && !pay) keep.push(s.trim());
  }
  const touched = prohibited.size > 0 || regulated.size > 0 || payment;
  if (!touched) return { text: input.text, prohibited: [], regulated: [], payment: false, offerAdult: false, emptied: false };
  if (payment) {
    keep.push(GATE_TEXTS.paymentNotHere);
    if (input.destination) keep.push(GATE_TEXTS.finishOrder(input.destination.destino));
  }
  const text = keep.join(" ").trim();
  return {
    text,
    prohibited: [...prohibited],
    regulated: [...regulated],
    payment,
    offerAdult: regulated.size > 0 && input.age === null,
    emptied: !text,
  };
}

/**
 * Reply de uma ação (Integrações): o texto exato sai inteiro ou não sai, então a conferência é mais
 * dura que a da IA (sem cortar frase, sem olhar negação ou oferta): qualquer item proibido; item
 * 18+ sem o "Sim"; dado de pagamento numa conversa com esses itens.
 */
export function checkActionReply(input: Omit<ExitInput, "text" | "destination"> & { text: string }): { ok: boolean; prohibited: GateCategory[]; regulated: GateCategory[]; payment: boolean } {
  const hits = dictionaryHits(input.text, { channel: input.channel, contactPhone: input.contactPhone, exempt: input.exempt });
  const prohibited = [...new Set(hits.filter((h) => h.level === "proibido").map((h) => h.category))];
  const regulated = input.age === "sim" ? [] : [...new Set(hits.filter((h) => h.level === "regulamentado").map((h) => h.category))];
  const payment = input.regulatedConversation && sentences(input.text).some(isPayment);
  return { ok: !prohibited.length && !regulated.length && !payment, prohibited, regulated, payment };
}

/** Texto fixo no lugar de um reply barrado (o reply nunca é editado). Função pura. */
export function replyFallback(rc: { prohibited: GateCategory[]; regulated: GateCategory[] }, destination: { destino: string } | null): string {
  if (rc.prohibited.length) return GATE_TEXTS.prohibited;
  if (rc.regulated.length) return GATE_TEXTS.under18;
  return [GATE_TEXTS.paymentNotHere, destination ? GATE_TEXTS.finishOrder(destination.destino) : ""].filter(Boolean).join(" ");
}

/** Rótulo curto para o registro do portão (gate_detections). */
export const exitDecision = (r: ExitResult) => (r.prohibited.length ? "proibido" : r.regulated.length ? (r.offerAdult ? "pede_18" : "nao_18") : "pagamento");