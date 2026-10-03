/*
 * Antes de conectar o WhatsApp (L1, tela Conexão): os erros mais comuns da janela da Meta e, na
 * coexistência (número que já usa o app WhatsApp Business), o que muda no app do celular. Textos
 * usados no painel e no link de conexão.
 */

export interface CheckItem {
  title: string;
  detail: string;
}

/** Lista curta dos erros mais comuns. `coexistence`: só vale para o número que já está no app. */
export const PRECONNECT_CHECKS: Array<CheckItem & { coexistence?: boolean }> = [
  {
    title: "Facebook de quem manda no negócio",
    detail: "Entre com o Facebook da pessoa que administra a empresa na Meta (ou que tem acesso de administrador ao portfólio). Com outro login, a janela não mostra a conta certa.",
  },
  {
    title: "PIN de verificação em duas etapas",
    detail: "Número que já foi usado na API pode ter um PIN de 6 dígitos. Se ninguém lembra, desligue no Gerenciador do WhatsApp (Números de telefone → Configurações) antes de conectar.",
  },
  {
    title: "App atualizado",
    detail: "No celular, o WhatsApp Business precisa estar na versão 2.24.17 ou mais nova (atualize pela loja de aplicativos).",
    coexistence: true,
  },
  {
    title: "Nome de exibição",
    detail: "O nome que os clientes veem precisa ser o do negócio, como no site ou na fachada. A Meta recusa nome genérico (\"Delivery\"), só com emojis ou com palavras como \"oficial\" sem ser a marca.",
  },
  {
    title: "Cartão à mão",
    detail: "A Meta cobra as mensagens direto do negócio. Tenha um cartão de crédito para cadastrar no fim da conexão.",
  },
];

/** O que muda no app do celular quando o número passa a responder também pelo assistente. */
export const COEXISTENCE_CHANGES: string[] = [
  "Listas de transmissão viram só leitura, mensagens temporárias são desligadas e grupos não entram no assistente.",
  "Aparelhos vinculados desconectam; o WhatsApp Web e o app do Mac podem ser conectados de novo.",
  "Abra o app no celular pelo menos 1 vez por semana: parado por uns 14 dias, a Meta desconecta o número.",
  "Quando você ou a equipe responde pelo celular, o assistente fica quieto naquela conversa por 1 hora.",
  "O BoaVoz não guarda o histórico antigo do app: só as conversas a partir da conexão.",
  "Tire bebida alcoólica e remédio do catálogo do app: o catálogo do celular fica fora do controle do assistente.",
];

/** O que o dono precisa desligar no app para o contato não receber duas respostas. */
export const AUTO_REPLIES_OFF = "Desliguei a mensagem de saudação e a mensagem de ausência do app (e o agente de IA da Meta, se aparecer)";
