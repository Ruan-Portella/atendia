/*
 * Rede de segurança da trava de escopo: o modelo recusa no texto ("aqui atendo sobre a empresa",
 * "isso não está relacionado ao nosso negócio") e esquece de chamar registrar_recusa. Aí o BoaVoz
 * registra a recusa sozinho (e a pergunta não vira "sem resposta" na base). Só frases claras de
 * recusa de assunto de fora contam; recusa de um pedido do negócio ("não consigo cancelar por
 * aqui, posso chamar a equipe") não.
 */

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// sozinhas já dizem que o assunto é de fora
const STRONG = [
  /\b(?:aqui|por aqui),? (?:eu )?(?:so|apenas|somente) (?:atendo|respondo|ajudo|falo|converso)\b/,
  /\b(?:aqui|por aqui),? (?:eu )?(?:atendo|respondo) (?:so |apenas |somente )?(?:sobre|a respeito)\b/,
  /\bnao (?:esta|estao|e) relacionad/,
  /\bfora do (?:nosso )?(?:negocio|assunto|escopo)\b/,
  /\bnao (?:sou )?(?:o |a )?chat ?gpt\b/,
  /\b(?:so|apenas|somente) (?:atendo|respondo|ajudo|falo|converso) (?:sobre|a respeito|assunt|o que|quest|duvidas)/,
  /\b(?:atendo|respondo|ajudo|falo|converso) (?:so|apenas|somente) (?:sobre|a respeito|assunt|o que|quest|duvidas)/,
];

// "não posso ajudar com isso" só conta junto da oferta do que é da empresa
const DECLINE = [
  /\bnao (?:posso|consigo) (?:te )?(?:ajudar|fazer|responder|atender)(?: com| a)? (?:isso|esse|essa|esses|essas|lic|resum|redac|traduc|tarefa|exercic|textos?|esse tipo|esse pedido|essa pergunta|perguntas? (?:de|sobre))/,
  /\bnao (?:posso|consigo|vou) (?:opinar|comentar|palpitar|dar (?:minha )?opiniao|falar|explicar|ensinar) (?:sobre|a respeito|isso|esse|essa)/,
  /\bnao (?:faco|posso fazer|consigo fazer) (?:resum|redac|traduc|lic|tarefa|trabalho|isso)/,
  /\bnao faz parte d(?:os|as|o|a) (?:servic|assunt|que (?:eu )?(?:ofereco|atendo|faco|posso))/,
];
const OFFER_COMPANY = /\b(?:posso|podemos) (?:te )?(?:ajudar|oferecer|responder|apresentar|tirar duvidas|dar|falar|explicar|contar)\b[^.!?]*\b(?:informac|sobre (?:o|a|os|as|nosso|nossa|nossos|nossas)\b|cardapio|servico|produto|pedido|agend|horario)|\bestou aqui para (?:responder|ajudar|falar)[^.!?]*\b(?:sobre|informac)|\bse precisar de (?:informac|algo|ajuda)[^.!?]*\b(?:sobre|relacionad|com (?:o|a|os|as|nosso|nossa))/;

/** O texto é uma recusa de assunto de fora do negócio? Pura. */
export function isScopeRefusalText(text: string | null | undefined): boolean {
  const t = strip(text ?? "");
  if (!t) return false;
  if (STRONG.some((r) => r.test(t))) return true;
  return DECLINE.some((r) => r.test(t)) && OFFER_COMPANY.test(t);
}

// pergunta com cara de ser do negócio ("vocês têm…", serviço, preço, pedido): aí o texto pode ser só a
// IA dizendo o que atende, ou um pedido do negócio que ela não faz por aqui; não é recusa de assunto
const BUSINESS_QUESTION = /\b(?:voces|vcs|servic|produt|preco|valor|custa|plano|assinatura|horario|funciona|endereco|localiz|entreg|pedido|cardapio|agend|marcar|reserv|contrat|orcamento|pagamento|pagar|pix|cartao|desconto|frete|prazo|parcel|cancel|troca|devoluc|atendente|estacionamento|aberto|abre|fecha)/;

/** A pergunta parece ser sobre o negócio (palavras do ramo ou o nome do cliente)? Pura. */
export function isBusinessQuestion(question: string, clientName: string): boolean {
  const q = strip(question);
  if (BUSINESS_QUESTION.test(q)) return true;
  return strip(clientName).split(/[^a-z0-9]+/).filter((w) => w.length >= 4).some((w) => new RegExp(`\\b${w}\\b`).test(q));
}

/** A IA recusou no texto um assunto de fora do negócio? Texto de recusa e pergunta que não é do negócio. Pura. */
export function isTextRefusal(text: string | null | undefined, question: string, clientName: string): boolean {
  return isScopeRefusalText(text) && !isBusinessQuestion(question, clientName);
}

/** Nível da recusa pelo pedido: trabalho ou assistente de uso geral é "fixo"; o resto, "flexivel". Pura. */
export function refusalLevelFor(question: string): "fixo" | "flexivel" {
  const q = strip(question);
  return /\b(?:redac|resum|tradu|program|codigo|funcao|licao|exercicio|tarefa|dever de casa|trabalho (?:escolar|da escola|de casa)|chat ?gpt|finge|fingir|atue como|seja (?:o|a|um|uma) |escrev|faz(?:a|e)? (?:um|uma|o|a) |calcul|quanto e \d)/.test(q) ? "fixo" : "flexivel";
}
