/*
 * Pagamento numa conversa com bebida ou remédio (regulamentados): a IA tira o dado de pagamento
 * da resposta (exit.ts) e o painel pergunta à equipe antes de enviar. Puro e leve: roda também no
 * navegador (sem o dicionário do portão).
 */

/** Quanto tempo a conversa continua "com item regulamentado" depois do último pedido. */
export const REGULATED_WINDOW_MS = 24 * 3_600_000;

/** A conversa ainda está marcada como de item regulamentado? */
export const regulatedConversation = (regulatedAt: string | null | undefined, now = Date.now()) => Boolean(regulatedAt) && now - Date.parse(regulatedAt!) < REGULATED_WINDOW_MS;

/** Sem acento, minúsculas, pontuação vira espaço (o mesmo jeito do portão). */
export function normalizeGateText(text: string): string {
  return ` ${text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/** Código do Pix ou link de meio de pagamento (link do site da empresa não conta: finalizar lá é o caminho certo). */
const PAYMENT_CODE = /br\.gov\.bcb|\b000201\d|mpago\.la|mercadopago\.com|pag\.ae|pagseguro\.uol|picpay\.me|buy\.stripe\.com|checkout\.stripe\.com|pay\.hotmart|link\.pagar\.me|sumup\.com|cielolink/i;
const PAYMENT_WORD = /\b(pix|boleto|pagamento|pagar|transferencia|deposito)\b/;
/** Chave: e-mail, documento ou telefone. */
const PAYMENT_KEY = /[\w.+-]+@[\w-]+\.[\w.]+|\d[\d.\-/ ]{9,}\d/;

/** Dado de pagamento numa frase: código ou link, ou a chave junto de Pix/boleto (saída da IA). */
export function isPaymentData(sentence: string): boolean {
  if (PAYMENT_CODE.test(sentence)) return true;
  return PAYMENT_WORD.test(normalizeGateText(sentence)) && PAYMENT_KEY.test(sentence);
}

/** A equipe está passando instrução de pagamento? Mais largo que a IA: só pergunta, não bloqueia. */
export function mentionsPayment(text: string): boolean {
  return PAYMENT_CODE.test(text) || PAYMENT_WORD.test(normalizeGateText(text)) || /\blink de pagamento\b/.test(normalizeGateText(text));
}
