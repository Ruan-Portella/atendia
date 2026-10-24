/*
 * Conteúdo da landing (24/10/2026), por público: a agência (que atende os clientes dela, com a marca
 * dela), o próprio negócio e o SaaS (a plataforma que dá um assistente a cada cliente dela, pela
 * API). A página escolhe pelo ?para=negocio ou ?para=saas; a agência é o padrão. Só dados.
 */

export type Audience = "agency" | "business" | "saas";

export const audienceOf = (raw: unknown): Audience => (raw === "negocio" ? "business" : raw === "saas" ? "saas" : "agency");

export interface DemoTurn {
  /** O que o contato manda (o botão da demonstração). */
  ask: string;
  /** A resposta do assistente. */
  answer: string;
  /** O que aconteceu por trás (aparece embaixo da resposta). */
  note?: string;
}

export const LANDING: Record<
  Audience,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    demoName: string;
    demoInitials: string;
    demoColor: string;
    demo: DemoTurn[];
    steps: Array<[string, string]>;
    brandFeature: [string, string];
    ctaTitle: string;
  }
> = {
  agency: {
    eyebrow: "Para agências e freelancers",
    title: "Atendimento com IA para os clientes da sua agência, com a sua marca.",
    subtitle: "Um assistente treinado no site e nos documentos de cada cliente, respondendo no WhatsApp oficial, no Instagram e no site. Você coloca o seu logo e cobra o que quiser. A IA fica por nossa conta.",
    demoName: "Clínica Sorriso",
    demoInitials: "CS",
    demoColor: "#2f6fd1",
    demo: [
      { ask: "Quanto custa o clareamento?", answer: "O clareamento a laser sai por R$ 890 e o caseiro, com as moldeiras, por R$ 450. Quer marcar uma avaliação gratuita para ver qual combina com você?", note: "Respondeu com a tabela de preços do site da clínica" },
      { ask: "Vocês atendem sábado?", answer: "Atendemos sim: de segunda a sexta, das 8h às 19h, e no sábado das 8h às 12h. Quer que eu veja um horário para você?", note: "Horário tirado da página de contato" },
      { ask: "Quero marcar uma avaliação", answer: "Claro! Tenho sábado às 9h ou às 10h30, e segunda às 14h. Qual fica melhor? Me passa também o seu nome completo.", note: "Roteiro de agendamento ligado à agenda da clínica" },
      { ask: "Mandou a foto do comprovante", answer: "Recebi o comprovante do Pix de R$ 150,00 para Clínica Sorriso, de hoje às 10h12. Já passei para a recepção confirmar, tá?", note: "Leu a foto e avisou a equipe" },
      { ask: "Quero falar com uma pessoa", answer: "Sem problema! Já chamei a Juliana, da recepção. Ela responde por aqui mesmo, em instantes.", note: "Passou a conversa para a equipe, na Caixa de entrada" },
    ],
    steps: [
      ["Cole o site do cliente", "A IA lê o site, os PDFs e as perguntas frequentes e monta a base do assistente em minutos."],
      ["Coloque a sua marca", "Logo, cores, nome e tom de voz. No chat, no painel do cliente e nos e-mails, quem aparece é a sua agência."],
      ["Ligue os canais", "WhatsApp oficial e Instagram pelo login da Meta, e o chat do site com uma linha de código, em qualquer plataforma."],
      ["Acompanhe e cobre", "Conversas, leads e relatório do mês num painel só. Seu cliente vê a área dele; você define quanto cobra."],
    ],
    brandFeature: ["A sua marca em tudo", "Painel do cliente, chat, e-mails e até o domínio próprio saem com o nome da sua agência. O cliente nunca vê o nosso."],
    ctaTitle: "Monte o primeiro assistente e mostre para um cliente amanhã.",
  },
  business: {
    eyebrow: "Para o seu negócio",
    title: "Seu WhatsApp, seu Instagram e seu site respondendo na hora, do seu jeito.",
    subtitle: "Um assistente treinado no seu site e nos seus documentos, que tira dúvidas, agenda, lê comprovantes e chama a sua equipe quando precisa. Sem chave da OpenAI, sem programar.",
    demoName: "Studio Bella",
    demoInitials: "SB",
    demoColor: "#b7791f",
    demo: [
      { ask: "Quanto custa a escova?", answer: "A escova sai por R$ 70 (cabelo curto) e R$ 90 (longo). Quer aproveitar e marcar? Essa semana ainda tenho horários na quinta e na sexta.", note: "Respondeu com a tabela do site do salão" },
      { ask: "Vocês abrem domingo?", answer: "No domingo não abrimos. De terça a sábado, das 9h às 19h. Quer que eu veja um horário para você?", note: "Horário tirado do perfil do Instagram" },
      { ask: "Quero marcar para sexta", answer: "Sexta tenho 10h, 14h ou 16h30 com a Carol. Qual prefere? Me passa o seu nome para eu reservar.", note: "Roteiro de agendamento ligado à agenda do salão" },
      { ask: "Mandou um áudio", answer: "Ouvi aqui: você quer remarcar a coloração de amanhã para a semana que vem, certo? Tenho terça às 15h ou quarta às 10h.", note: "Transcreveu o áudio e entendeu o pedido" },
      { ask: "Quero falar com a dona", answer: "Já chamei a Bella! Ela responde por aqui mesmo assim que puder.", note: "Passou a conversa para você, com um aviso no celular" },
    ],
    steps: [
      ["Cole o seu site", "A IA lê o site, os PDFs e as perguntas frequentes e monta a base do assistente em minutos."],
      ["Ajuste o jeito de falar", "Nome, tom de voz, o que ele pode e o que não pode responder, e quando chamar você."],
      ["Ligue os canais", "WhatsApp oficial e Instagram pelo login da Meta, e o chat do site com uma linha de código."],
      ["Acompanhe tudo", "Conversas, contatos e relatório do mês num lugar só. A sua equipe responde pela mesma caixa."],
    ],
    brandFeature: ["Seu número, seu jeito", "O assistente responde no seu WhatsApp e no seu Instagram, com o nome e a foto que você escolher, e chama você quando a conversa pede uma pessoa."],
    ctaTitle: "Coloque o assistente no ar e pare de perder conversa fora do horário.",
  },
  saas: {
    eyebrow: "Para plataformas e SaaS",
    title: "Atendimento com IA para cada cliente do seu software, criado pela API.",
    subtitle: "Monte um modelo uma vez e crie um assistente por cliente direto do seu sistema, cada um com o próprio WhatsApp, Instagram e equipe. As ações consultam o seu sistema, os webhooks avisam tudo e a sua marca fica na frente.",
    demoName: "Pizzaria do Zé",
    demoInitials: "PZ",
    demoColor: "#c53d3d",
    demo: [
      { ask: "Qual o cardápio de hoje?", answer: "Hoje tem calabresa, margherita e portuguesa (R$ 49,90 a grande), e a do dia é frango com catupiry por R$ 44,90. Quer pedir?", note: "Buscou o cardápio da loja no sistema da plataforma" },
      { ask: "Quero uma margherita grande", answer: "Anotado: 1 margherita grande, R$ 49,90. Entrego na Rua das Flores, 120, como da última vez? A taxa é R$ 6.", note: "Criou o pedido pela ação criar_pedido, com o id da loja" },
      { ask: "Cadê o meu pedido?", answer: "O seu pedido #4821 saiu para entrega às 19h42 com o Marcos. Deve chegar em uns 15 minutos.", note: "Reconheceu a pessoa pelo login do app e consultou o pedido" },
      { ask: "Mandou a foto do comprovante", answer: "Recebi o comprovante do Pix de R$ 55,90 para Pizzaria do Zé. Já avisei a loja para confirmar.", note: "Leu a foto e mandou o webhook para o seu sistema" },
      { ask: "Quero falar com a loja", answer: "Já chamei a equipe da Pizzaria do Zé. Eles respondem por aqui mesmo.", note: "Passou a conversa para a equipe da loja, no portal dela" },
    ],
    steps: [
      ["Monte o modelo uma vez", "Personalidade, instruções, roteiros e ações (como buscar_cardapio e criar_pedido) valem para todos os seus clientes."],
      ["Crie um assistente por cliente", "Quando um cliente entra no seu software, o seu sistema cria o assistente dele pela API, com os dados e o contexto da loja."],
      ["Cada cliente com os canais dele", "WhatsApp e Instagram de cada loja pelo link de conexão, e o chat dentro do seu app com o login dos seus usuários."],
      ["Integre e acompanhe", "Webhooks de cada conversa e lead, o uso de cada cliente pela API e um portal para a equipe de cada loja."],
    ],
    brandFeature: ["A sua plataforma na frente", "Cada cliente vê a sua marca no chat, no portal e nos e-mails. O modelo é seu: mude uma vez e publique a versão nova para todos."],
    ctaTitle: "Dê a cada cliente do seu software um atendimento que não dorme.",
  },
};

/** O que acontece num dia de atendimento (a faixa que corre embaixo do painel). */
export const TICKER = [
  "Assistente respondeu a Ana no WhatsApp",
  "Lead novo: Bruno Lima, avaliação no sábado",
  "Lembrete da consulta saiu para 12 pacientes",
  "Juliana assumiu a conversa da Carla",
  "Comprovante do Pix lido e enviado à recepção",
  "Áudio transcrito: remarcar para terça",
  "Relatório do mês enviado ao cliente",
  "Pedido de exclusão de dados concluído (LGPD)",
];

/** Recursos, em cartões (o destaque muda por público; o SaaS tem os dele). */
export const FEATURES: Array<[string, string]> = [
  ["Uma caixa para os três canais", "WhatsApp oficial, Instagram Direct e o chat do site na mesma Caixa de entrada, com setores, rodízio entre a equipe e respostas prontas."],
  ["Responde com o que é verdade", "A IA usa só o que está no site, nos PDFs e no que você escrever. Quando não sabe, diz que vai confirmar e chama alguém."],
  ["Roteiros que resolvem", "Agendar, mandar segunda via, consultar pedido, pedir CPF e CEP: passo a passo, ligado ao seu sistema pelas Ações."],
  ["Réguas e lembretes", "Lembrete de consulta, aniversário, retorno e as datas que você criar, pelos modelos aprovados do WhatsApp."],
  ["Foto e áudio também", "Lê comprovantes e fotos de produtos, transcreve áudios e responde como se tivesse ouvido."],
  ["LGPD de verdade", "Dados cifrados por cliente, modo dados sensíveis para saúde, pedidos do titular e auditoria de quem viu o quê."],
];

/** Recursos de quem integra pela API (SaaS e plataformas). */
export const SAAS_FEATURES: Array<[string, string]> = [
  ["API completa", "Clientes, chatbots, canais, pausa, equipe, contatos, conversas, mensagens e uso: tudo pela API, com chaves por escopo."],
  ["Modelo com versões", "Um modelo para todos os clientes, com os campos que cada um pode mudar e a publicação de versões novas."],
  ["Ações no seu sistema", "A IA consulta e cria no seu sistema (pedido, saldo, segunda via) com o contexto de cada cliente, em chamadas assinadas e com limites."],
  ["Webhooks de tudo", "Conversa, lead, mensagem, pausa e exclusão de dados: eventos assinados, com reenvio e registro de cada entrega."],
  ["Usuários identificados", "No chat dentro do seu app, o login do seu usuário vai junto: a IA atende a pessoa certa, com os dados da conta dela."],
  ["LGPD por cliente", "Dados cifrados com a chave de cada cliente, pedidos do titular e exclusão em cascata, também pela API."],
];

export const featuresFor = (a: Audience) => (a === "saas" ? SAAS_FEATURES : FEATURES);
