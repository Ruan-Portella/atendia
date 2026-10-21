/*
 * Guias do cliente dentro do portal (Lançamento, parte 2, 19/10/2026): como usar a área do
 * cliente, com a marca da agência. Nunca citam a plataforma (o cliente da agência não vê o
 * BoaVoz). Cada seção aparece só para quem tem aquela parte liberada pela agência. Pura.
 */

export interface GuideAccess {
  manager: boolean;
  handoff: boolean;
  knowledge: boolean;
  hours: boolean;
}

export interface ClientGuideSection {
  id: string;
  title: string;
  paragraphs: string[];
}

/** As seções que a pessoa vê, com o nome da agência e do negócio nos textos. */
export function clientGuide(access: GuideAccess, names: { agency: string; client: string }): ClientGuideSection[] {
  const a = names.agency;
  const sections: Array<ClientGuideSection & { show: boolean }> = [
    {
      id: "entrar",
      title: "Entrar",
      show: true,
      paragraphs: [
        "Você entra com o seu e-mail, sem senha: chega um link que vale por 1 hora, e o acesso fica aberto por 7 dias. Depois, peça um link novo na tela de entrada.",
        `Se o link não chegar, confira o spam ou peça acesso para a ${a}.`,
      ],
    },
    {
      id: "relatorio",
      title: "Relatório",
      show: access.manager,
      paragraphs: [
        `A página inicial mostra como o assistente de ${names.client} está indo: as conversas, os leads e quanto ele resolveu sem a equipe.`,
        "Mais abaixo, a Evolução mostra os últimos 6 meses, mês a mês: quanto o assistente resolveu sozinho, quanto tempo a equipe levou para assumir quem pediu atendimento e a satisfação de quem respondeu à pesquisa.",
      ],
    },
    access.handoff
      ? {
          id: "atendimento",
          title: "Atender: assumir, responder e devolver",
          show: true,
          paragraphs: [
            "Quando um cliente pede para falar com uma pessoa, ou o assistente chama a equipe, a conversa aparece na Caixa de entrada, com o número de quem está esperando. As filas separam o que é seu, o que ninguém pegou ainda, cada setor, o que chegou fora do horário e o que foi adiado.",
            'Toque em "Assumir conversa": o assistente para de responder nela, e você responde por aqui. O cliente vê o seu nome e a sua foto (veja Meu perfil). Se outra pessoa já está atendendo, "Assumir no lugar" troca quem atende.',
            'No fim, "Encerrar atendimento e devolver ao assistente" faz ele voltar a responder. No WhatsApp, dá para responder até 24 horas depois da última mensagem do cliente.',
            "Embaixo da resposta: Transferir passa o atendimento para outra pessoa ou setor (com uma nota só para a equipe), Nota interna grava um recado que o cliente nunca vê e Adiar tira a conversa das filas até uma data. As respostas prontas ficam na lista em cima do campo de resposta.",
          ],
        }
      : {
          id: "conversas",
          title: "Conversas",
          show: true,
          paragraphs: [`Em Conversas, você lê o que o assistente conversou com os seus clientes. Responder por aqui é liberado pela ${a}.`],
        },
    {
      id: "ensinar",
      title: "Ensinar o assistente",
      show: access.manager && access.knowledge,
      paragraphs: [
        "Em Ensinar o assistente, você responde as perguntas que ele não soube: a resposta vale já na próxima conversa.",
        `Ali também ficam os textos e as perguntas frequentes, para manter preços, horários e regras em dia. O site e os PDFs ficam com a ${a}.`,
        "O aviso do momento é um recado com prazo (instabilidade, manutenção, atraso, mudança de horário): o assistente usa quando alguém pergunta, e o aviso some sozinho no fim do prazo.",
      ],
    },
    {
      id: "horario",
      title: "Horário de atendimento",
      show: access.manager && access.hours,
      paragraphs: ["Em Horário, você define os dias e as horas em que a equipe atende em cada assistente. Fora desse horário, o assistente continua respondendo e, quando alguém pede uma pessoa, avisa quando a equipe volta."],
    },
    {
      id: "equipe",
      title: "Equipe",
      show: access.manager,
      paragraphs: [`Em Equipe, você convida atendentes: a pessoa recebe um link de entrada no e-mail. Dá para reenviar o link ou tirar a pessoa. Gestores novos são adicionados pela ${a}.`],
    },
    {
      id: "canais",
      title: "Canais",
      show: access.manager,
      paragraphs: ["Em Canais, você vê o WhatsApp e o Instagram ligados ao assistente e pode desconectar. O número e a conta continuam do seu negócio."],
    },
    {
      id: "privacidade",
      title: "Privacidade",
      show: access.manager,
      paragraphs: [
        "Em Privacidade, você escolhe por quanto tempo as conversas ficam guardadas e confirma os pedidos de exclusão que os seus clientes fazem pelo chat.",
        "Ali também fica o modo dados sensíveis: as conversas ficam guardadas por menos tempo, e abrir uma delas pede a verificação em duas etapas.",
      ],
    },
    {
      id: "perfil",
      title: "Meu perfil",
      show: true,
      paragraphs: ["Em Meu perfil, você troca o nome e a foto que o cliente vê quando você atende, marca se está disponível para receber conversas pelo rodízio dos setores e escolhe a sua assinatura. Ali também fica a verificação em duas etapas, pedida para abrir conversas em modo dados sensíveis e para confirmar pedidos de exclusão."],
    },
  ];
  return sections.filter((s) => s.show).map(({ id, title, paragraphs }) => ({ id, title, paragraphs }));
}
