# Guia do painel BoaVoz

Base de conhecimento do assistente da BoaVoz no WhatsApp: responde a quem usa o painel (agências, freelancers e a equipe delas) sobre como o BoaVoz funciona. Cada seção responde a uma dúvida e cabe sozinha.

## O que é o BoaVoz

O BoaVoz é uma plataforma para agências e freelancers criarem chatbots com IA para os clientes deles, com a marca da agência. Cada chatbot aprende com o site, os PDFs e os textos do cliente e atende no chat do site, no WhatsApp oficial e no Instagram Direct. A agência cobra o preço que quiser do cliente; o BoaVoz cobra da agência pelo tamanho de cada chatbot. A IA já vem incluída: ninguém precisa de chave da OpenAI.

## Como começar (primeiros passos)

1. Crie a conta grátis em boavoz.com: com o Google, ou com o seu e-mail e o código que chega nele (o BoaVoz não usa senha; entrar e criar conta é a mesma tela, e o código vale por 1 hora).
2. No primeiro acesso, diga como vai usar o BoaVoz: para os clientes da sua agência, para o seu negócio ou para integrar pela API. Ali vão também o nome da agência (ou do negócio), o seu nome e, se quiser, o seu WhatsApp para os avisos. A resposta muda os "Primeiros passos" do painel: a agência vai até o chat no site do cliente; o negócio, até o site ou o WhatsApp dele; quem integra, até a chave da API, o webhook, o pacote Integrações e a primeira chamada. Para mudar depois, use "Mudar o perfil" nos primeiros passos ou em Marca e domínio (só o dono da conta).
3. No painel, em Clientes, crie o cliente e um chatbot para ele (no perfil do próprio negócio, o cliente é o próprio negócio).
4. No chatbot, aba Base de conhecimento, adicione o site, PDFs, textos ou perguntas frequentes do cliente.
5. Ajuste a aba Personalidade (nome do assistente, tom, instruções) e teste no "teste ao vivo".
6. Quando estiver bom, escolha um tamanho para o chatbot (em Cobrança) e conecte os canais: o chat do site (aba Instalação), o WhatsApp e o Instagram.

## Conta grátis

A conta grátis serve para montar e testar: ela tem 50 respostas de teste da IA, que valem no teste ao vivo e nas demos. O chat do site, o WhatsApp e o Instagram só ligam quando o chatbot tem um tamanho (assinatura). Não precisa de cartão para criar a conta.

## Tamanhos e preços dos chatbots

Cada chatbot no ar tem um tamanho, com a própria cota de atendimentos por mês:
- Atendimento: R$ 29 por mês, sem IA nenhuma (caixa de entrada para a equipe responder).
- P: R$ 49 por mês, 160 atendimentos (umas 5 conversas por dia).
- M: R$ 99 por mês, 340 atendimentos (umas 11 conversas por dia).
- G: R$ 199 por mês, 680 atendimentos (umas 22 conversas por dia).
- Volume: R$ 299 por pacote de 1.000 atendimentos, para chatbots com muito movimento, como o de um app.
Conectar canal não custa nada a mais: o preço é do software e da IA.

## O que conta como um atendimento

Um atendimento é a conversa com um contato durante 24 horas, contadas a partir da primeira resposta da IA, com até 40 respostas. O painel avisa quando o chatbot chega a 80% e a 95% da cota do mês. Com a cota cheia, só aquele chatbot para de responder com IA: as mensagens continuam chegando em Conversas para a equipe, e o chat do site mostra um formulário de contato. A cota volta no dia 1º.

## Excedente e crédito

O excedente é opcional e ligado por chatbot, em Cobrança → Uso. Com ele ligado, quando a cota acaba o chatbot continua atendendo e cada atendimento a mais custa R$ 0,35, pago com o crédito pré-pago da conta. O crédito é comprado em Cobrança → Crédito (mínimo de R$ 50), no cartão da assinatura ou pelo Pix (até R$ 10.000 por compra), e vale 12 meses. Pelo Pix, abre a página de pagamento da Stripe, que pede o CPF ou CNPJ de quem paga e mostra o QR e o copia e cola; o código vale 1 hora, e o crédito entra quando o banco confirma (avisamos por e-mail). A recarga automática usa só o cartão. Dá para pôr um teto de gasto por chatbot e ligar a recarga automática.

## Pacotes da conta

Os pacotes valem para a agência toda, um de cada por mês:
- Domínio próprio (R$ 29): o painel do cliente e o chat abrem no domínio da agência.
- Integrações (R$ 49): webhooks, API, ações que consultam e executam no sistema do cliente e o passo de ação nos roteiros.
- Plataforma (R$ 199, exige o Integrações): recursos para quem atende muitos clientes ou monta um app em cima do BoaVoz, como os segredos de identidade para todos os clientes de uma vez.

## Assinatura, fatura e cancelamento

A assinatura é feita em Cobrança, com cartão, pela Stripe. Assinatura por Pix não tem: a Stripe não oferece o Pix automático para empresa brasileira, então o Pix serve só para comprar crédito. A fatura sai no dia 1º. Subir o tamanho de um chatbot vale na hora, com cobrança proporcional aos dias que faltam no mês; descer o tamanho ou tirar um chatbot vale a partir do dia 1º seguinte. O cancelamento fica agendado para o fim do período pago, e dá para reativar antes disso. As faturas ficam em Cobrança.

## Pagamento atrasado

Se o pagamento da assinatura falhar, a IA fica pausada em todos os chatbots até a fatura ser paga: as mensagens continuam chegando em Conversas para a equipe responder. Para resolver, pague a fatura em aberto ou troque o cartão em Cobrança. Para assinar de novo, primeiro paga a fatura em aberto.

## Modelos de chatbot

Com o pacote Plataforma, o menu Modelos junta o que vários chatbots têm em comum: a personalidade, as instruções, os assuntos do negócio, as ações, os roteiros e a base de conhecimento. Cada chatbot criado do modelo (na aba Herança do modelo, um por cliente ou por loja, com o contexto fixo opcional) usa a versão publicada do modelo. O que você muda no modelo (personalidade, instruções, assuntos, ações e roteiros) fica no rascunho, e o teste ao vivo do modelo usa o rascunho; os derivados só recebem ao clicar em Publicar, no topo do modelo, que mostra quantos chatbots a publicação afeta. Cada publicação vira uma versão, e a aba Herança deixa voltar os derivados para uma versão anterior em um clique. A base de conhecimento, o que o modelo libera e o que vem pela API valem na hora, sem publicar. O modelo decide o que cada derivado pode mudar: o nome do assistente, a saudação, a aparência, o anúncio dos atendentes, instruções extras (somadas às do modelo) e uma base própria. Na saudação do modelo, {empresa} vira o nome do cliente de cada derivado e {assistente}, o nome do assistente. No derivado, os campos travados aparecem só para leitura, com o valor do modelo, e as abas Ações e Roteiros mostram os do modelo, com o link para mudar lá. Um campo liberado que o derivado mudou fica como valor próprio, e "Voltar ao modelo" desfaz. "Desligar do modelo", na faixa do topo do derivado, deixa o chatbot independente, com uma cópia das ações, dos roteiros e da base do modelo, e não dá para ligar de novo. O modelo não atende ninguém: não tem canais, tamanho nem cobrança, e o teste ao vivo dele fica no painel. Um modelo com derivados não pode ser excluído. Pela API (pacote Plataforma, rotas POST /v1/clients e POST /v1/bots), o sistema da plataforma cria sozinho cada cliente e o chatbot dele a partir do modelo, com o contexto e os dados da loja; o id do modelo para a API fica na aba Herança, e o cliente criado assim mostra o id dele no sistema da plataforma, ao lado do nome.

## Demos para prospects

Em Demos, a agência gera uma demonstração do chatbot de um possível cliente a partir do site dele, para mostrar antes de fechar. Cada demo vale 14 dias e responde até 50 vezes. A conta grátis gera até 3 demos por mês; com assinatura, até 20. A demo tem um link próprio e conta as visitas.

## Base de conhecimento (fontes)

Na aba Base de conhecimento do chatbot, a agência adiciona o que o assistente sabe: o site do cliente (o BoaVoz lê as páginas sozinho), uma página só, PDF de até 15 MB, texto e perguntas frequentes (FAQ). O site é lido de novo toda semana, sozinho. O assistente só responde com o que está na base: o que não está vira "Não tenho essa informação" e a pergunta fica registrada para a equipe responder. Respondida no painel, ela entra na base como FAQ.

## Aviso do momento

Na aba Base de conhecimento do chatbot (e em Ensinar o assistente, na área do cliente), dá para pôr um aviso do momento: um recado com prazo, como instabilidade, manutenção, atraso ou mudança de horário, de até 500 caracteres e que vale até o dia e a hora escolhidos (no máximo 30 dias). O assistente usa o aviso quando alguém pergunta ou o assunto tem a ver, sem começar a conversa por ele, e o aviso some sozinho no fim do prazo. Dá para tirar antes, na mesma tela.

## Perguntas sem resposta

Quando o assistente não acha a resposta na base, ele diz que não tem a informação, oferece deixar o contato e registra a pergunta. Essas perguntas ficam na aba Base de conhecimento: é só responder por lá que o assistente passa a saber (a resposta vira FAQ). É o jeito mais rápido de completar a base nos primeiros dias.

## Personalidade e instruções

Na aba Personalidade ficam o nome do assistente, o tom (por exemplo, amigável e direto), o idioma, as instruções da empresa e os assuntos que o negócio também atende. O "teste ao vivo" mostra como o assistente responde antes de ligar os canais. A aparência do chat do site (cores, logo, saudação, perguntas sugeridas) fica na aba Aparência e marca.

## O que o assistente não faz

Nos canais da Meta (WhatsApp e Instagram), o assistente só fala do negócio do cliente: recusa com educação o que não tem a ver (como fazer redação, escrever código ou dar opinião de jogo) e o que faria a IA virar o próprio serviço. Ele não faz diagnóstico nem indica remédio, não confirma pagamento, não inventa preço, prazo ou promoção, e não finge ser uma pessoa. Em risco à vida, manda o texto com os telefones de emergência e avisa a equipe com urgência.

## Leads (captura de contatos)

Na aba Captura de leads, a agência liga o pedido de contato: quando alguém quer orçar, agendar, comprar ou falar com alguém, o assistente pede o nome (no WhatsApp e no Instagram o contato já é conhecido) e registra o lead. Os leads ficam na aba Leads do cliente, com exportação em CSV. O assistente nunca diz que o pedido foi anotado ou confirmado: ele diz que passou para a equipe.

## Atendimento humano e conversas

Todas as conversas ficam em Conversas, no cliente e em cada chatbot, com o estado: urgente, aguardando a equipe, assumida sem resposta, em atendimento. Alguém da equipe pode assumir a conversa (a IA para), responder pelo painel e devolver para a IA. Na aba Atendimento humano ficam o horário da equipe, o aviso de que é uma IA e o texto de fora do horário. O contato pode pedir "falar com uma pessoa" a qualquer momento.

## Pesquisa de satisfação

Na aba Atendimento humano do chatbot, dá para ligar a pesquisa de satisfação (vem desligada). No WhatsApp e no Instagram, o contato recebe "Como foi o seu atendimento hoje?" com os botões Ótimo, Regular e Ruim: quando a equipe encerra um atendimento e quando a conversa com o assistente fica parada por 30 minutos depois de uma resposta dele. Sai uma por conversa por dia, só dentro da janela de 24 horas (é mensagem de atendimento: a Meta não cobra), e nunca para quem pediu para sair. O toque grava a nota e o assistente agradece, sem responder ao toque. O resultado dos últimos 30 dias aparece na mesma aba: a porcentagem de Ótimo e quantas pesquisas foram respondidas.

## Chat do site (widget)

O chat do site é instalado com o código da aba Instalação do chatbot (funciona em WordPress, Wix, Webflow, Shopify e qualquer HTML), ou pelo link de página própria. Ele guarda a conversa, mostra quando alguém da equipe entra e, quando a IA para (pausa, cota cheia, pagamento), mostra um formulário de contato que vira lead. Um app ou site com login pode identificar a pessoa (ChatWidget.identify), para o assistente saber quem é.

## Conectar o WhatsApp de um cliente

Na aba WhatsApp do chatbot, há três jeitos: o cadastro pela tela da Meta (o mais comum), o link de conexão para o próprio cliente fazer (vale 7 dias) e a conexão por ID, para quem já tem o número na Meta. Antes, o painel mostra o aceite das regras do canal e um checklist dos erros comuns. Depois de conectado, o diagnóstico do número mostra o status, o nome de exibição, a qualidade e a forma de pagamento. O chatbot precisa de um tamanho para conectar.

## WhatsApp com o app do celular (coexistência)

O número pode continuar no app WhatsApp Business do celular do cliente enquanto o BoaVoz atende pela API. Quando alguém responde pelo celular, a resposta aparece no painel e o assistente fica quieto naquela conversa por 1 hora, para não falar por cima da pessoa.

## Problemas comuns na conexão

- Entre com o Facebook de quem administra a empresa na Meta (ou de quem tem acesso de administrador ao portfólio): com outro login, a janela da Meta não mostra a conta certa. Quem não tem esse acesso pode mandar o link de conexão para o dono fazer.
- Número que já foi usado na API pode ter um PIN de 6 dígitos (verificação em duas etapas). Se ninguém lembra, desligue no Gerenciador do WhatsApp (Números de telefone, Configurações) antes de conectar.
- O nome de exibição precisa ser o do negócio, como no site ou na fachada. A Meta recusa nome genérico (por exemplo, "Delivery"), só com emojis ou com palavras como "oficial" sem ser a marca. O diagnóstico do número, na aba WhatsApp, mostra se o nome foi aprovado.
- A Meta cobra os modelos de mensagem direto do negócio: tenha um cartão para cadastrar no fim da conexão. Sem forma de pagamento, a Meta recusa os modelos, e o painel avisa.
- No número que já usa o app WhatsApp Business no celular (coexistência), o app precisa estar na versão 2.24.17 ou mais nova. Abra o app pelo menos uma vez por semana: parado por uns 14 dias, a Meta desconecta o número; para voltar, abra o app e conecte de novo.
- No Instagram, se a conexão cair (senha trocada, app removido ou acesso vencido), o painel avisa: é só conectar de novo na aba Instagram do chatbot.

## Modelos de mensagem e janela de 24 horas

No WhatsApp, a empresa só escreve livremente até 24 horas depois da última mensagem do contato. Fora dessa janela, só sai modelo de mensagem aprovado pela Meta: o BoaVoz cria sozinho o de retomada (para a equipe reabrir uma conversa parada) e a agência pode criar outros na aba WhatsApp. Modelo de marketing só sai para quem aceitou receber novidades. Quem manda SAIR, PARAR ou STOP deixa de receber modelos.

## Custo do WhatsApp

As mensagens de modelo do WhatsApp são cobradas pela Meta, na forma de pagamento da conta do WhatsApp Business do cliente. O BoaVoz não cobra pelo uso do WhatsApp: mostra na aba WhatsApp o consumo e o custo estimado e avisa quando a Meta recusa por falta de pagamento.

## Instagram Direct

Na aba Instagram do chatbot, a conexão é pelo login do próprio Instagram (não precisa de página do Facebook). O assistente responde as mensagens do Direct, entende post, reel e story compartilhados e lida com mensagem editada ou desfeita. A equipe responde pelo painel.

## Áudios e fotos

No WhatsApp, os áudios do contato são transcritos e o assistente responde ao que foi falado. No WhatsApp e no Instagram, o assistente lê as fotos (uma descrição curta, que passa pelas regras do canal) e responde sobre elas; cada foto lida conta como uma resposta. Comprovante de pagamento, documento pessoal, cartão e foto de saúde nunca são lidos: o contato recebe um texto fixo e a equipe é avisada. No painel, embaixo de cada foto, aparece o que a IA viu.

## Regras da Meta e o portão do BoaVoz

O BoaVoz segue as regras de comércio da Meta no WhatsApp e no Instagram: itens proibidos (como cigarro, armas, drogas e apostas) nunca são oferecidos; bebida alcoólica e remédio só aparecem para quem confirmou ter 18 anos ou mais, e a venda deles vai para o canal que a empresa declarou (site, loja ou telefone). O portão confere a pergunta, a resposta, os botões e os dados das ações. Quando um item da base não é o que parece (por exemplo, "cerveja" no nome de um prato), dá para pedir a revisão no painel.

## Botão de emergência

Cada chatbot tem um botão para pausar a IA na hora. Pausado, as mensagens continuam chegando em Conversas para a equipe responder, e o chat do site mostra o formulário de contato. Para voltar, é só retomar no mesmo botão.

## Equipe e papéis

Em Equipe, o dono ou o administrador convida pessoas pelo e-mail (o convite vale 7 dias). Os papéis são: dono (tudo, inclusive cobrança), administrador (tudo menos cobrança), editor (configura os clientes e chatbots do escopo e atende) e atendente (só as conversas do escopo). O escopo pode ser todos os clientes ou só alguns clientes e chatbots. Não há limite de pessoas.

## Meu perfil

Em Meu perfil, cada pessoa da equipe põe o nome e a foto que o contato vê quando ela atende, liga o segundo fator (app autenticador) e põe o próprio WhatsApp para receber os avisos da conta e conversar com o assistente da BoaVoz.

## Área do cliente (portal)

O cliente da agência entra pela área do cliente com um link enviado por e-mail (vale 7 dias), no domínio da agência quando ela tem o pacote Domínio próprio. Ele vê o relatório e, se a agência liberar, as conversas, o atendimento e o "ensinar o assistente". Também cuida da privacidade (prazo de guarda, modo dados sensíveis, exportar dados e pedidos de exclusão) e pode desconectar o WhatsApp e o Instagram. O acesso é configurado na aba Acesso do cliente.

## Relatório mensal

Todo mês sai por e-mail o relatório do atendimento, com um link público que mostra só números (conversas, atendimentos, leads e a evolução dos últimos 6 meses), sem conteúdo das conversas. O relatório fica também na aba Relatório e portal do cliente.

## Evolução mês a mês

Na aba Evolução de cada chatbot, uma tabela com os últimos 6 meses: as conversas, quantas o assistente resolveu sem a equipe (com a porcentagem), quantas foram para a equipe, quanto tempo a equipe levou para assumir quem pediu atendimento (a mediana, do pedido até alguém assumir; o pedido deixado fora do horário não entra), a satisfação (a porcentagem de Ótimo entre as respostas da pesquisa) e os contatos capturados. Um traço quer dizer que não houve aquilo no mês. O cliente vê a mesma tabela no relatório (no link e na área do cliente), com os chatbots dele somados, até o mês que estiver aberto. Serve para mostrar ao cliente, mês a mês, o resultado do assistente.

## Marca e domínio

Em Marca e domínio, a agência põe o logo, as cores e o nome que aparecem no painel do cliente, no chat do site e nos e-mails. Com o pacote Domínio próprio, o portal do cliente e o chat abrem num domínio da agência, com a verificação de DNS feita pelo painel.

## Contatos

Na aba Contatos do cliente ficam as pessoas que conversaram pelo WhatsApp, com busca, etiquetas, o aceite de novidades e a resposta de 18+. Dá para importar uma planilha de contatos, informando se cada um aceitou receber novidades.

## Campanhas no WhatsApp

Na aba Campanhas do cliente, a agência manda um modelo de mensagem para um público (por etiquetas ou por lista), com a prévia de quem recebe e de quem fica de fora (quem não aceitou, quem pediu para sair, menor de 18 em item de bebida), o custo estimado e o prazo. Dá para mandar na hora ou agendar no fuso do cliente. Marketing só vai para quem aceitou novidades, com a prova do aceite guardada. Depois do envio, a campanha mostra o relatório do resultado.

## Lembretes

Os lembretes de utilidade (consulta amanhã, pedido pronto, vencimento) são enviados por planilha: cada linha é um envio, na data e na hora dela, com um modelo de utilidade aprovado. A agência informa o fuso e declara que os contatos aceitaram receber esses lembretes.

## Integrações: ações, webhooks e API

Com o pacote Integrações:
- Ações: o assistente consulta o sistema do cliente (pedido, agenda, estoque, segunda via) e executa operações (criar pedido, agendar, cancelar) só depois do Confirmar do contato. Ficam na aba Ações do chatbot.
- Webhooks: o sistema do cliente recebe os eventos (mensagem recebida, lead, pedido de atendente, fim de roteiro e outros), com assinatura, novas tentativas e reenvio. Ficam em Integrações → Webhooks.
- API: conversas, mensagens (texto, imagem, documento, modelo e botões), contatos, leads, campanhas, lembretes, uso e fontes de conhecimento, com chave em Integrações → Chaves de API.
- Contexto fixo e dados da loja: na aba Ações, cada chatbot pode ter um contexto fixo (por exemplo a loja de uma plataforma, {"loja_id": "42"}), que vai em toda chamada de ação, por cima do contexto do token ou do pareamento, e os dados da loja para a IA (o display da API: nome da unidade, horário, endereço), que o assistente usa como um trecho fixo da base e que não vão para as ações. Só o dono ou um administrador muda, com o segundo fator, e o dono recebe o alerta.
- Fontes por contexto: pela API, cada fonte pode ter um contexto (por exemplo o cliente de um SaaS). Ela só vale nas conversas daquele contexto, passa pelo portão e não refaz a análise do chatbot. No painel, a base mostra só quantas são.
A documentação completa fica em boavoz.com/docs.

## Roteiros

Na aba Roteiros do chatbot, a agência define passos que a IA segue quando a conversa entra num assunto: segunda via, troca, orçamento, agendamento, rastreio (há 5 modelos prontos). Os passos podem ser instrução, pedir um dado (CPF, CNPJ, CEP, e-mail, telefone, data, número ou formato próprio), botões, ação no sistema do cliente e pedir uma foto. O BoaVoz confere os dados e escolhe o caminho; a IA conversa dentro de cada passo. A palavra-chave (por exemplo, "2VIA") começa o roteiro na hora. Até 10 roteiros por chatbot, com até 12 passos.

## Identificação pelo roteiro e lembrar o número

Num roteiro com ação, o sistema do cliente pode dizer quem é a pessoa (pelo CPF, por exemplo) e quais contas ela tem: com mais de uma, ela escolhe por botão antes de ver qualquer dado. No WhatsApp e no Instagram, o BoaVoz pergunta se pode lembrar o número; lembrado, a próxima conversa começa por "Estou falando com...?". "Sou outra pessoa" esquece o número, e "desconectar" também. A loja pode desligar o lembrar o número na aba Roteiros.

## Segurança e privacidade (LGPD)

O que vem do contato fica cifrado com a chave de cada cliente. A agência escolhe o prazo de guarda (6, 12 ou 24 meses), e o modo dados sensíveis (para saúde, por exemplo) apaga em 7 a 90 dias e desliga a leitura de fotos. Os pedidos do titular (apagar dados) chegam pelo chat, pelo painel e pela API e são cumpridos num lugar só. Em Segurança ficam a auditoria, os acessos, o acesso do suporte da BoaVoz (só com liberação por 24 horas) e o segundo fator. Os dados do cliente podem ser exportados em Dados do cliente.

## Avisos no WhatsApp para a equipe

Cada pessoa da equipe pode receber os avisos da conta no próprio WhatsApp, pelo número da BoaVoz: atendimento urgente, pedido de atendente, lead novo, WhatsApp de um cliente desconectado, pagamento atrasado e cota no fim. Para ligar, ponha o número no primeiro acesso, em Meu perfil ou em "Ativar no WhatsApp", na faixa do topo do painel, e toque em Confirmar na mensagem que chega. Os avisos não trazem o conteúdo das conversas, só o que aconteceu e onde ver no painel. Para parar, mande SAIR para o número da BoaVoz ou desligue em Meu perfil. Os clientes da agência nunca recebem mensagens da BoaVoz.

## Excluir a conta

Só o dono exclui a conta, em Segurança, Excluir a conta (com o segundo fator e o nome da conta digitado). A exclusão acontece 7 dias depois do pedido: até lá, tudo funciona, o painel mostra a data numa faixa e o dono pode desistir na mesma tela. Na data, saem os clientes, os chatbots, as conversas, os contatos, os leads, os arquivos e a equipe; o WhatsApp e o Instagram são desconectados (os números e as contas continuam dos negócios). A assinatura para de renovar no pedido e é cancelada na exclusão, sem reembolso do mês em curso, e o crédito que sobrar se perde. A auditoria fica por 1 ano e os registros de acesso por 6 meses.

## Roadmap e sugestões

No menu Roadmap do painel fica o que estamos fazendo e o que vem por aí, em quatro colunas (Ideias, Vamos fazer, Fazendo e Pronto), sem datas: a ordem muda com o que os clientes pedem. Qualquer pessoa da equipe curte o que mais quer (uma curtida por pessoa; tocar de novo desfaz) e manda ideias. A gente lê todas: as que entram aparecem em Ideias já com a curtida de quem mandou, e uma ideia parecida com outra é juntada a ela. Em "Suas ideias", você vê o que aconteceu com cada uma. O roadmap também fica aberto, sem login, em boavoz.com/roadmap.

## Sobre este assistente

Este assistente é a própria BoaVoz atendendo pelo BoaVoz: um chatbot como os que a agência cria para os clientes. Ele responde sobre o painel e, para quem confirmou o número, sobre a conta (os chatbots, o tamanho e o uso do mês), sem mudar nada na conta. Para falar com alguém da equipe BoaVoz, é só pedir "falar com uma pessoa". As mesmas respostas estão na central de ajuda, em boavoz.com/ajuda (o menu Ajuda do painel), uma página por assunto.
