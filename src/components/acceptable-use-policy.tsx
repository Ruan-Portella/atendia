import type { ReactNode } from "react";
import { Section } from "@/components/legal-page";

/*
 * Política de Uso Aceitável (rascunho de 26/09, aba "Textos legais"; falta a revisão do advogado).
 * Aceita na tela única de aceite, antes da primeira conexão de um canal da Meta. O mesmo texto
 * serve à página pública (com a marca) e ao link de conexão do cliente (white-label: "a
 * plataforma"), por isso a marca e o contato entram como parâmetro.
 */

const PROHIBITED: Array<[string, string, string]> = [
  ["Armas, drogas e tabaco", "Armas, munição e explosivos; drogas; produtos de tabaco e cigarros eletrônicos", "—"],
  [
    "Saúde",
    "Medicamentos que exigem receita; produtos médicos e de saúde, como aparelhos, lentes de contato, óculos de grau e de leitura, termômetros, testes de doenças, kits de primeiros socorros, bombas de leite e fórmula infantil; suplementos para ingestão (vitaminas, proteína em pó e outros); oferecer, dar preço ou cobrar procedimentos estéticos injetáveis (como toxina botulínica e preenchimento)",
    "Testes de gravidez e de ovulação; agendar avaliação estética; higiene, cosméticos e alimentos; medicamentos isentos de prescrição, que seguem o item 5; vitamina registrada na Anvisa como medicamento isento de prescrição é analisada caso a caso",
  ],
  ["Adulto e relacionamentos", "Conteúdo e produtos adultos, inclusive preservativos e lubrificantes; serviços de namoro", "—"],
  [
    "Dinheiro",
    "Apostas com dinheiro real (pagar para concorrer a prêmio); moedas virtuais; câmbio (compra e venda de moeda estrangeira); empréstimos de curto prazo (payday loans), adiantamento de salário e empréstimo entre pessoas; cobrança de dívidas de terceiros como atividade; esquemas financeiros e marketing multinível (recrutamento com promessa de renda)",
    "Crédito consignado, bancos e financiamento; fiador, seguro-fiança e imobiliárias; o próprio negócio cobrar os seus clientes (fatura, mensalidade); promoção vinculada à compra",
  ],
  ["Outros produtos", "Partes do corpo, animais vivos e produtos perigosos", "—"],
  [
    "Organizações",
    "Políticos, partidos, candidatos, campanhas e serviços políticos; sistemas de votação; polícia, forças militares e serviços de inteligência; portais de notícias sem o status de Página de Notícias da Meta; no WhatsApp, também órgãos de governo e fornecedores exclusivos de governo",
    "—",
  ],
];

/** O texto da política. `brand` é o nome com artigo feminino ("BoaVoz" ou "plataforma"). */
export function AcceptableUsePolicy({ brand, contact }: { brand: string; contact: ReactNode }) {
  const A = `A ${brand}`;
  const a = `a ${brand}`;
  const da = `da ${brand}`;
  const pela = `pela ${brand}`;
  return (
    <>
      <p className="text-[15px] leading-relaxed text-ink-2">
        {A} existe para o atendimento de empresas aos seus próprios clientes. Esta política vale para toda a plataforma — painel, assistentes, canais, campanhas, API e Integrações — e para todas as pessoas da sua conta e dos seus clientes. Ela complementa os Termos de Uso.
      </p>

      <Section title="1. Atendimento do negócio, não IA de uso geral">
        <p>
          O assistente deve atender sobre o seu negócio: produtos, serviços, pedidos, agendamentos, suporte e vendas, além de conversa cordial e assuntos próximos. É proibido oferecer, por qualquer meio {da} (inclusive ações, API ou respostas enviadas por sistemas externos), um assistente de inteligência artificial de uso geral, ou usar {a} como canal de distribuição de um modelo de IA.
        </p>
        <p>
          No WhatsApp e no Instagram, o assistente recusa quando a própria IA viraria o serviço entregue: (a) tarefa sem relação com os produtos ou serviços do negócio (como a redação escolar do contato, programar o aplicativo dele, traduzir um texto qualquer, servir de assistente geral ou fingir ser outro assistente); ou (b) a IA executar o serviço que o negócio vende (por exemplo, uma agência de tradução traduzindo o documento do contato, ou uma escola de idiomas dando a aula). Nesses casos, o assistente apresenta, vende, agenda ou chama uma pessoa. Responder no idioma do contato e dar trechos curtos que ajudam a usar ou comprar o produto do negócio são sempre permitidos. Essa trava não pode ser desativada. Negócios em que a conversa com a IA é o próprio produto (por exemplo, um tutor feito só de IA) passam por revisão antes de ativar o WhatsApp.
        </p>
      </Section>

      <Section title="2. Caminho para uma pessoa">
        <p>
          No WhatsApp, o contato sempre pode pedir para falar com uma pessoa no próprio chat: a conversa passa para a equipe, que responde pelo painel ou pelo portal. A conta pode indicar outros caminhos, como telefone para ligação, e-mail, página ou formulário de suporte, ou visita à loja. No Instagram e no site, esse caminho é recomendado. O horário de atendimento humano é opcional. Quando o contato pede para falar com uma pessoa, o assistente indica o caminho.
        </p>
      </Section>

      <Section title="3. Uso verificado">
        <p>
          Analisamos o que seus assistentes fazem — conteúdo da base de conhecimento, catálogos, ações, site e perfil informados, sinais da Meta e detecções automáticas no canal —, na ativação e de forma contínua (o conteúdo de conversas só é analisado quando há sinal de violação), inclusive com apoio de inteligência artificial, para identificar o tipo de negócio e itens regulamentados ou proibidos. Informações que você fornecer (site, perfil, canais de venda) devem ser verdadeiras e atualizadas.
        </p>
      </Section>

      <Section title="4. Produtos, atividades e organizações proibidos">
        <p>
          No WhatsApp e no Instagram, é proibido usar {a} para vender, promover ou intermediar os itens e atividades proibidos pelas políticas da Meta. Os principais estão na tabela abaixo. A lista completa é a das políticas da Meta, e vale a versão em inglês.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="py-2 pr-3 font-semibold">Grupo</th>
                <th className="py-2 pr-3 font-semibold">Proibido no WhatsApp e no Instagram</th>
                <th className="py-2 font-semibold">Não é proibido (exemplos)</th>
              </tr>
            </thead>
            <tbody>
              {PROHIBITED.map(([group, no, yes]) => (
                <tr key={group} className="border-b border-line-2 align-top">
                  <td className="py-2 pr-3 font-semibold text-ink">{group}</td>
                  <td className="py-2 pr-3">{no}</td>
                  <td className="py-2">{yes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Não podem usar o WhatsApp nem o Instagram {pela} os negócios cujo modelo é proibido: apostas, namoro, recrutamento de marketing multinível, empréstimo de curto prazo (payday), cobrança de dívidas de terceiros, moedas virtuais, tabacaria e vape, sex shop, armas, canil ou gatil e as organizações da tabela. Negócios cujo carro-chefe é proibido pela Meta, como óticas, lojas de suplementos e clínicas de estética, passam por revisão, com o canal funcionando e a trava automática ligada. Nesta política, vender ou fechar pedido na conversa quer dizer catálogo, carrinho, checkout, cobrança ou pedido fechado dentro do chat; mensagem informativa e link para fora do chat não contam.
        </p>
        <p>
          Negócios que vendem itens proibidos junto com itens permitidos, como farmácias, mercados e pet shops, podem usar {a}: o assistente só não oferece os itens proibidos. No site (widget), que não é canal da Meta, continua proibido tudo o que é ilegal no Brasil, como cigarro eletrônico e apostas sem licença. Em saúde, o assistente de IA atende só a parte administrativa (agendamento, preparo de exames, valores) e pode dar informação factual, como alérgenos. Ele nunca diagnostica, prescreve, indica dose ou interpreta exame. Fora do Instagram, o profissional de saúde da empresa pode tirar uma dúvida pontual pelo chat, conforme as regras do conselho dele; teleconsulta completa não é recurso {da}. No Instagram, é proibido o atendimento por profissional de saúde e o envio ou pedido de receitas, laudos, pedidos de exame ou outros dados de paciente.
        </p>
      </Section>

      <Section title="5. Itens regulamentados">
        <p>
          No Brasil, bebidas alcoólicas e medicamentos isentos de prescrição são setores regulamentados nas políticas da Meta, e {a} os trata conforme as políticas de cada canal. No WhatsApp e no Instagram, o assistente só informa e mostra esses itens a quem confirmar ter 18 anos ou mais. No WhatsApp, a venda nunca é concluída na conversa: o contato é levado ao site da empresa ou a outro canal indicado por ela (ligação, retirada, aplicativo), que nunca pode ser o próprio WhatsApp. A regra vale também para atendentes humanos e inclui cobrança, Pix ou link de pagamento de pedido com esses itens. Mensagens sobre esses itens só podem ir para números do Brasil e nunca pelo aplicativo WhatsApp Business do celular. No Instagram, a mesma regra vale por enquanto, por decisão {da}.
        </p>
        <p>
          A confirmação de maioridade para mensagens, feita no chat, atende à regra da Meta e não substitui a verificação legal de idade na venda, que é responsabilidade do seu negócio. No site (widget e página de atendimento), que não é canal da Meta, {a} não aplica essas travas: o assistente trata esses itens como qualquer outro, sem perguntar a idade, e a verificação legal de idade na venda é do seu negócio. Ao oferecer esses itens, em qualquer canal, você declara que tem as licenças exigidas (por exemplo, a Autorização de Funcionamento de Empresa, AFE, da Anvisa para farmácias), que cumpre as leis e os códigos do setor (como as normas da Anvisa e o código do CONAR, o Conselho Nacional de Autorregulamentação Publicitária) e que para de oferecer se a licença vencer. É proibido qualquer apelo a menores de idade. No WhatsApp e no Instagram, {a} aplica essas regras automaticamente no canal, independentemente de configuração sua.
        </p>
      </Section>

      <Section title="6. Mensagens com consentimento">
        <p>
          Só envie mensagens de marketing a quem deu consentimento, registrado com origem, data e texto aceito. Respeite a saída (&ldquo;SAIR&rdquo;, &ldquo;PARAR&rdquo; ou botão de descadastro) imediatamente. Não disfarce marketing como mensagem de utilidade. Para lembretes e avisos que você iniciar, declare que os contatos consentiram em receber mensagens suas e informe a origem desse consentimento. A declaração é feita uma vez por cliente (negócio atendido), fica registrada com origem, texto, quem declarou e quando, e vale para os envios seguintes. Fora da janela de 24 horas, use apenas modelos aprovados pela Meta.
        </p>
      </Section>

      <Section title="7. Conteúdo e condutas proibidos">
        <p>
          Atividades ilegais, fraude, golpes, falsidade ideológica ou se passar por outra empresa; spam; discurso de ódio, assédio ou ameaças; conteúdo sexual envolvendo menores; discriminação; violação de direitos de terceiros; coleta de dados pessoais sem base legal. Negócio cujo modelo é discriminatório é bloqueado.
        </p>
      </Section>

      <Section title="8. Dados pessoais">
        <p>
          O negócio atendido é o controlador dos dados dos contatos e deve ter base legal para tratá-los; a agência atua como operadora e {a} como suboperadora. Se você usa {a} para o seu próprio negócio, você é o controlador. Dados sensíveis (como saúde) exigem cuidado adicional. Pedidos de titulares feitos pelo chat serão encaminhados ao negócio atendido (e à agência que o atende) e executados no prazo legal.
        </p>
      </Section>

      <Section title="9. Integrações e API">
        <p>
          Os endpoints que você conectar recebem dados dos seus contatos e devem protegê-los. Você deve autorizar o acesso a dados pelo contato verificado informado {pela}, nunca por dados digitados pelo usuário. É proibido usar a API para contornar esta política, os limites dos planos ou as regras da Meta.
        </p>
      </Section>

      <Section title="10. Segurança da plataforma">
        <p>É proibido tentar invadir, sobrecarregar, copiar ou fazer engenharia reversa da plataforma, compartilhar chaves de API fora da sua organização ou acessar dados de outras contas.</p>
      </Section>

      <Section title="11. Como aplicamos esta política">
        <p>
          Podemos, de forma proporcional: enviar aviso; abrir revisão; limitar recursos (por exemplo, desligar Integrações ou Campanhas); suspender um canal ou a conta. Na dúvida, a revisão acontece com o canal funcionando. A suspensão imediata acontece só nestes casos: ordem ou pedido da Meta; item ou modelo de negócio proibido de forma inequívoca; conteúdo sexual envolvendo menores, fraude ou golpe; risco à segurança da plataforma ou de outros clientes (como invasão ou chave de API vazada); ordem judicial ou de autoridade.
        </p>
        <p>
          Registramos as análises e decisões, informamos o motivo, e você pode contestar {contact}. Se a suspensão for revertida na contestação, ou se encerrarmos a conta sem violação sua, devolvemos o valor proporcional ao período pago e não usado. A Meta também pode aplicar medidas próprias aos seus números e contas, independentes {da}.
        </p>
      </Section>

      <Section title="12. Atualizações">
        <p>As políticas da Meta mudam; esta política será atualizada quando necessário, com aviso das mudanças relevantes.</p>
      </Section>
    </>
  );
}
