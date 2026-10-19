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

O excedente é opcional e ligado por chatbot, em Cobrança → Uso. Com ele ligado, quando a cota acaba o chatbot continua atendendo e cada atendimento a mais custa R$ 0,35, pago com o crédito pré-pago da conta. O crédito é comprado em Cobrança → Crédito (mínimo de R$ 50) e vale 12 meses. Dá para pôr um teto de gasto por chatbot e ligar a recarga automática.

## Pacotes da conta

Os pacotes valem para a agência toda, um de cada por mês:
- Domínio próprio (R$ 29): o painel do cliente e o chat abrem no domínio da agência.
- Integrações (R$ 49): webhooks, API, ações que consultam e executam no sistema do cliente e o passo de ação nos roteiros.
- Plataforma (R$ 199, exige o Integrações): recursos para quem atende muitos clientes ou monta um app em cima do BoaVoz, como os segredos de identidade para todos os clientes de uma vez.

## Assinatura, fatura e cancelamento

A assinatura é feita em Cobrança, com cartão, pela Stripe. A fatura sai no dia 1º. Subir o tamanho de um chatbot vale na hora, com cobrança proporcional aos dias que faltam no mês; descer o tamanho ou tirar um chatbot vale a partir do dia 1º seguinte. O cancelamento fica agendado para o fim do período pago, e dá para reativar antes disso. As faturas ficam em Cobrança.

## Pagamento atrasado

Se o pagamento da assinatura falhar, a IA fica pausada em todos os chatbots até a fatura ser paga: as mensagens continuam chegando em Conversas para a equipe responder. Para resolver, pague a fatura em aberto ou troque o cartão em Cobrança. Para assinar de novo, primeiro paga a fatura em aberto.

## Demos para prospects

Em Demos, a agência gera uma demonstração do chatbot de um possível cliente a partir do site dele, para mostrar antes de fechar. Cada demo vale 14 dias e responde até 50 vezes. A conta grátis gera até 3 demos por mês; com assinatura, até 20. A demo tem um link próprio e conta as visitas.

## Base de conhecimento (fontes)

Na aba Base de conhecimento do chatbot, a agência adiciona o que o assistente sabe: o site do cliente (o BoaVoz lê as páginas sozinho), uma página só, PDF de até 15 MB, texto e perguntas frequentes (FAQ). O site é lido de novo toda semana, sozinho. O assistente só responde com o que está na base: o que não está vira "Não tenho essa informação" e a pergunta fica registrada para a equipe responder. Respondida no painel, ela entra na base como FAQ.

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

## Chat do site (widget)

O chat do site é instalado com o código da aba Instalação do chatbot (funciona em WordPress, Wix, Webflow, Shopify e qualquer HTML), ou pelo link de página própria. Ele guarda a conversa, mostra quando alguém da equipe entra e, quando a IA para (pausa, cota cheia, pagamento), mostra um formulário de contato que vira lead. Um app ou site com login pode identificar a pessoa (ChatWidget.identify), para o assistente saber quem é.

## Conectar o WhatsApp de um cliente

Na aba WhatsApp do chatbot, há três jeitos: o cadastro pela tela da Meta (o mais comum), o link de conexão para o próprio cliente fazer (vale 7 dias) e a conexão por ID, para quem já tem o número na Meta. Antes, o painel mostra o aceite das regras do canal e um checklist dos erros comuns. Depois de conectado, o diagnóstico do número mostra o status, o nome de exibição, a qualidade e a forma de pagamento. O chatbot precisa de um tamanho para conectar.

## WhatsApp com o app do celular (coexistência)

O número pode continuar no app WhatsApp Business do celular do cliente enquanto o BoaVoz atende pela API. Quando alguém responde pelo celular, a resposta aparece no painel e o assistente fica quieto naquela conversa por 1 hora, para não falar por cima da pessoa.

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

Todo mês sai por e-mail o relatório do atendimento, com um link público que mostra só números (conversas, atendimentos, leads), sem conteúdo das conversas. O relatório fica também na aba Relatório e portal do cliente.

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
- API: conversas, mensagens (texto, imagem, documento, modelo e botões), contatos, leads, campanhas, lembretes e uso, com chave em Integrações → Chaves de API.
A documentação completa fica em boavoz.com/docs.

## Roteiros

Na aba Roteiros do chatbot, a agência define passos que a IA segue quando a conversa entra num assunto: segunda via, troca, orçamento, agendamento, rastreio (há 5 modelos prontos). Os passos podem ser instrução, pedir um dado (CPF, CNPJ, CEP, e-mail, telefone, data, número ou formato próprio), botões, ação no sistema do cliente e pedir uma foto. O BoaVoz confere os dados e escolhe o caminho; a IA conversa dentro de cada passo. A palavra-chave (por exemplo, "2VIA") começa o roteiro na hora. Até 10 roteiros por chatbot, com até 12 passos.

## Identificação pelo roteiro e lembrar o número

Num roteiro com ação, o sistema do cliente pode dizer quem é a pessoa (pelo CPF, por exemplo) e quais contas ela tem: com mais de uma, ela escolhe por botão antes de ver qualquer dado. No WhatsApp e no Instagram, o BoaVoz pergunta se pode lembrar o número; lembrado, a próxima conversa começa por "Estou falando com...?". "Sou outra pessoa" esquece o número, e "desconectar" também. A loja pode desligar o lembrar o número na aba Roteiros.

## Segurança e privacidade (LGPD)

O que vem do contato fica cifrado com a chave de cada cliente. A agência escolhe o prazo de guarda (6, 12 ou 24 meses), e o modo dados sensíveis (para saúde, por exemplo) apaga em 7 a 90 dias e desliga a leitura de fotos. Os pedidos do titular (apagar dados) chegam pelo chat, pelo painel e pela API e são cumpridos num lugar só. Em Segurança ficam a auditoria, os acessos, o acesso do suporte da BoaVoz (só com liberação por 24 horas) e o segundo fator. Os dados do cliente podem ser exportados em Dados do cliente.

## Avisos no WhatsApp para a equipe

Cada pessoa da equipe pode receber os avisos da conta no próprio WhatsApp, pelo número da BoaVoz: atendimento urgente, pedido de atendente, lead novo, WhatsApp de um cliente desconectado, pagamento atrasado e cota no fim. Para ligar, ponha o número no primeiro acesso, em Meu perfil ou em "Ativar no WhatsApp", na faixa do topo do painel, e toque em Confirmar na mensagem que chega. Os avisos não trazem o conteúdo das conversas, só o que aconteceu e onde ver no painel. Para parar, mande SAIR para o número da BoaVoz ou desligue em Meu perfil. Os clientes da agência nunca recebem mensagens da BoaVoz.

## Sobre este assistente

Este assistente é a própria BoaVoz atendendo pelo BoaVoz: um chatbot como os que a agência cria para os clientes. Ele responde sobre o painel e, para quem confirmou o número, sobre a conta (os chatbots, o tamanho e o uso do mês), sem mudar nada na conta. Para falar com alguém da equipe BoaVoz, é só pedir "falar com uma pessoa".
