/*
 * Por que uma mensagem não saiu (D', parte 7): os erros mais comuns da Meta no WhatsApp e no
 * Instagram, em português, para a conversa ("Não entregue") e a lista "Envios que falharam" da aba
 * do canal. Funções puras.
 */

/** WhatsApp Cloud API: o código do erro (o que o envio guardou em messages.error_code). */
const WHATSAPP: Record<string, string> = {
  "131037": "o número ainda não tem o nome de exibição aprovado pela Meta (veja no WhatsApp Manager)",
  "131047": "passaram 24 horas desde a última mensagem do contato; só um modelo aprovado reabre a conversa",
  "137000": "o WhatsApp do contato mudou desde que ele conectou a conta (número reciclado ou aparelho novo): a mensagem não foi entregue e o vínculo com a conta foi desfeito",
  "131026": "o contato não pode receber (número sem WhatsApp ou aplicativo desatualizado)",
  "131050": "o contato parou de receber promoções desta empresa pelo próprio WhatsApp",
  "131042": "a conta do WhatsApp está sem forma de pagamento na Meta",
  "131049": "a Meta limita quantas promoções cada pessoa recebe, somando todas as empresas",
  "131051": "a Meta não aceita este tipo de mensagem",
  "131053": "o arquivo não foi aceito pela Meta (formato ou tamanho)",
  "131056": "mensagens demais para o mesmo contato em pouco tempo; espere um pouco",
  "130429": "o número passou do ritmo de envio da Meta; espere um pouco",
  "131048": "a Meta limitou o envio deste número por denúncias ou bloqueios",
  "132000": "o número de variáveis não bate com o modelo",
  "132001": "o modelo não existe nesse idioma",
  "132015": "o modelo foi pausado por baixa qualidade",
  "132016": "o modelo foi desativado pela Meta",
  "130472": "a Meta segurou a mensagem (o número participa de um teste da própria Meta)",
  "190": "o acesso ao WhatsApp venceu ou foi tirado; conecte de novo",
  "131000": "erro interno da Meta; tente de novo",
};

/** Instagram (Graph API): o código e, quando vier, o subcódigo ("10/2018278"). */
const INSTAGRAM: Record<string, string> = {
  "10": "o Instagram não deixou mandar (fora da janela de 24 horas ou sem permissão)",
  "551": "esta pessoa não está disponível no Instagram agora",
  "100": "a conversa não existe mais do lado do Instagram",
  "190": "o acesso ao Instagram venceu ou foi tirado; conecte de novo",
  "2": "o Instagram ficou instável; tente de novo",
};

/** O motivo em português, ou o genérico. Pura. */
export function failureReason(code: string | null | undefined, channel: "whatsapp" | "instagram" | string = "whatsapp"): string {
  if (!code) return "o canal recusou e o contato não recebeu";
  const table = channel === "instagram" ? INSTAGRAM : WHATSAPP;
  return table[code] ?? table[code.split("/")[0]] ?? "o canal recusou e o contato não recebeu";
}
