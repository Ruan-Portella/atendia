import Link from "next/link";
import { LegalPage, Section } from "@/components/legal-page";
import { company, companyIdentity } from "@/lib/company";

export const metadata = { title: "Política de Privacidade" };

/*
 * Leva S (05/10/2026): papéis em três camadas, cifra por cliente, retenção por negócio, registros de
 * acesso, modo dados sensíveis, arquivos recebidos, pedido pelo chat, acesso do suporte com
 * autorização e subcontratados. Só entra aqui o que já existe: o prazo dos backups (depois do
 * Supabase Pro) entra quando existir; o encerramento com carência de 30 dias não vai existir
 * (decisão de 20/10/2026: vale a regra de 16/10, assinatura cancelada desconecta os canais). Leva B3 (06/10/2026): a prova do
 * consentimento para novidades; o envio de campanhas entra com a tela de campanhas. Avisos no
 * WhatsApp (19/10/2026): o número da pessoa da equipe, com o aceite confirmado no WhatsApp. Réguas
 * (20/10/2026): as datas do contato informadas pela empresa (aniversário sem o ano, última visita e
 * próximo horário). Pendências do MVP (20/10/2026): o código do contato que vai ao provedor de IA, o que segura a ficha do contato e o CPF ou CNPJ e o endereço para a nota fiscal.
 * Memória e avisos no celular (21/10/2026): a memória do assistente na ficha do contato e os aparelhos
 * que recebem os avisos da equipe (com os serviços de notificação dos navegadores). Trava da conta
 * grátis (21/10/2026): os sinais que ligam contas da mesma pessoa (só como código), o cookie do
 * navegador e a marca da desistência em 7 dias.
 */
export default function PrivacyPage() {
  const { brand, email } = company;
  const operator = companyIdentity();
  return (
    <LegalPage
      title="Política de Privacidade"
      updatedAt="21 de outubro de 2026"
      intro={`Esta política explica quais dados pessoais a ${brand} trata, para quê, com quem compartilha, por quanto tempo guarda e como você exerce seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018, LGPD).`}
    >
      <Section title="1. Quem somos">
        <p>
          {operator ? `A plataforma ${brand} é operada por ${operator}. ` : ""}A {brand} permite que agências e empresas criem assistentes virtuais de atendimento, treinados no conteúdo de cada negócio, e os publiquem no site, no WhatsApp e no Instagram.
        </p>
        <p>Contato do encarregado de dados (DPO): <a href={`mailto:${email}`}>{email}</a>.</p>
      </Section>

      <Section title="2. Nosso papel em cada tipo de dado">
        <ul>
          <li><strong>Dados da sua conta</strong> (agências e pessoas que usam o painel): a {brand} é a <strong>controladora</strong>.</li>
          <li>
            <strong>Dados de quem conversa com os assistentes</strong> (visitantes do site e contatos no WhatsApp e no Instagram): a <strong>controladora</strong> é a empresa atendida, dona do assistente. A agência que gerencia o assistente é <strong>operadora</strong>, e a {brand} é <strong>suboperadora</strong> (ou operadora, quando a própria empresa usa a {brand} diretamente). Tratamos esses dados só para prestar o serviço, por instrução da empresa e conforme o contrato. Pedidos sobre esses dados devem ir primeiro à empresa com quem você conversou; você também pode pedir a exclusão no próprio chat ou escrever para o e-mail acima.
          </li>
        </ul>
      </Section>

      <Section title="3. Dados que tratamos">
        <ul>
          <li><strong>Cadastro:</strong> nome, e-mail, nome da agência, logo, cores, telefone de suporte e dados de acesso.</li>
          <li><strong>Pagamento:</strong> tamanhos e pacotes assinados, crédito comprado, histórico de cobranças e identificadores do meio de pagamento. Os dados do cartão são tratados diretamente pela Stripe; não os armazenamos. Para a nota fiscal de cada pagamento, pedimos no checkout o CPF ou CNPJ e o endereço de quem paga, guardados cifrados pelo prazo da lei fiscal, mesmo depois que a conta sai.</li>
          <li><strong>Conteúdo dos assistentes:</strong> páginas de sites, documentos e textos enviados para formar a base de conhecimento e, quando a empresa escolhe, os posts do Instagram dela (legenda, data, link e uma descrição curta de cada foto feita por IA; a imagem não é guardada).</li>
          <li><strong>Conversas:</strong> mensagens trocadas com os assistentes e com atendentes humanos, data e hora, canal e um identificador técnico do visitante.</li>
          <li><strong>Arquivos recebidos:</strong> fotos, áudios, vídeos e documentos que o contato envia pelo WhatsApp ou pelo Instagram (até 16 MB), guardados para a empresa ver no histórico da conversa.</li>
          <li>
            <strong>Leitura de fotos:</strong> quando o assistente tem IA, a foto que o contato envia pelo WhatsApp ou pelo Instagram é lida em baixa resolução, e uma descrição curta do que ela mostra passa a fazer parte da conversa. A descrição não identifica pessoas e não copia links, e-mails nem números longos. Comprovantes de pagamento, documentos pessoais, cartões e fotos de saúde não são descritos. No modo dados sensíveis, nenhuma foto é lida.
          </li>
          <li><strong>Contato:</strong> telefone ou identificador do WhatsApp e do Instagram, nome de perfil e, quando a empresa identifica o cliente dela no chat, o identificador informado por ela. Quando o contato pede um item regulamentado (como bebida alcoólica), guardamos a resposta à pergunta de maioridade. Quando a empresa informa (pela planilha, pelo painel ou pela API), também o dia e o mês do aniversário (o ano não é guardado), a data da última visita ou compra e o próximo horário marcado, usados nas mensagens automáticas do WhatsApp que a empresa liga.</li>
          <li>
            <strong>Memória do assistente:</strong> quando a empresa liga a memória num assistente, uma IA anota, depois de cada conversa, até 10 fatos curtos que ajudam no próximo atendimento (por exemplo, o nome que a pessoa prefere ou o produto de sempre), guardados cifrados na ficha do contato e usados só por aquele assistente. Nunca entram saúde, religião, política, vida sexual, origem racial ou étnica, dados de criança, documentos, dados de pagamento, senhas, endereço completo, telefone nem e-mail. A pessoa pode pedir no próprio chat para o assistente esquecer, e a empresa vê e apaga a memória na ficha do contato.
          </li>
          <li><strong>Leads:</strong> nome, telefone, e-mail e o interesse, quando a pessoa decide informá-los.</li>
          <li>
            <strong>WhatsApp da equipe para avisos:</strong> quando uma pessoa da equipe de uma agência põe o número dela no painel, guardamos o número (cifrado), a confirmação que ela faz pelo botão na mensagem que chega no WhatsApp, quais avisos ela quer receber e o sinal de identidade do WhatsApp que a Meta envia (para parar os avisos se o número mudar de aparelho ou de dono). O número só é usado para os avisos da conta e para o assistente da {brand} conversar com ela por lá. Os avisos não levam o conteúdo das conversas. As pessoas dos clientes da agência nunca recebem mensagens da {brand}.
          </li>
          <li>
            <strong>Avisos no celular e no computador:</strong> quando uma pessoa da equipe (da agência ou da empresa atendida) ativa os avisos num aparelho, guardamos o endereço de entrega que o navegador cria (com as chaves dele, cifradas), o nome do navegador e do sistema (como &quot;Chrome no Android&quot;), a data do último aviso e quais avisos ela quer receber. Os avisos não levam o conteúdo das conversas.
          </li>
          <li>
            <strong>Registros de acesso:</strong> endereço IP completo, data e hora dos acessos ao painel e à área do cliente (entradas e sessões) e do chat do site (início de cada conversa e mudança de IP), como exige o Marco Civil da Internet. Nos demais registros, como o limite de uso do chat, o IP é guardado apenas como um código (hash).
          </li>
          <li><strong>Auditoria:</strong> quem fez o quê na conta (por exemplo, conectar um canal ou mudar um prazo), sem conteúdo de conversas.</li>
          <li>
            <strong>Sinais contra o abuso da conta grátis:</strong> para o teste grátis valer uma vez por pessoa, guardamos, só como código (HMAC, sem o valor original), o e-mail de quem abre a conta (sem pontos e apelidos do Gmail), um identificador do navegador (um cookie nosso, usado só para isso), o IP do cadastro, o WhatsApp confirmado do dono e, a cada pagamento, o CPF ou CNPJ e a impressão digital do cartão que a Stripe gera (não o número do cartão). Os códigos servem só para ligar contas da mesma pessoa; não fazem rastreamento nem perfil. Quem desiste da assinatura em 7 dias fica com esses códigos marcados por 12 meses.
          </li>
          <li><strong>Dados técnicos:</strong> tipo de navegador, cookies de sessão do painel, o cookie do navegador contra o abuso da conta grátis (acima) e armazenamento local do navegador para manter a conversa do chat do site.</li>
        </ul>
      </Section>

      <Section title="4. WhatsApp e produtos da Meta">
        <p>
          Quando uma empresa conecta um número de WhatsApp Business à {brand} (pelo cadastro incorporado da Meta), recebemos e tratamos: identificadores da conta WhatsApp Business e do número, o token de acesso concedido pela empresa, e as mensagens enviadas e recebidas nesse número, incluindo o número de telefone, o nome de perfil do contato, os arquivos enviados e o status de entrega. Mensagens de áudio também são transcritas em texto por um provedor de IA para que o assistente possa responder. Quando a empresa conecta o número que já usa no aplicativo WhatsApp Business do celular (coexistência), também recebemos as mensagens que a equipe envia pelo celular, para mostrar a conversa completa no painel; os contatos e o histórico antigo do aparelho que a Meta sincroniza não são guardados pela plataforma.
        </p>
        <p>
          Usamos esses dados <strong>somente</strong> para receber as mensagens, gerar e enviar as respostas do assistente, permitir o atendimento humano e mostrar o histórico no painel da empresa. Não vendemos esses dados, não os usamos para publicidade e não os usamos para treinar modelos de inteligência artificial. O uso também segue os Termos e as Políticas do WhatsApp Business e da Meta.
        </p>
        <p>
          A empresa pode desconectar o número a qualquer momento no painel da {brand} ou nas configurações da Meta. Com isso, deixamos de receber mensagens e apagamos o token de acesso.
        </p>
      </Section>

      <Section title="4.1 Instagram">
        <p>
          Quando uma empresa conecta a conta profissional do Instagram (pelo login do Instagram), recebemos e tratamos o identificador e o nome de usuário da conta, o token de acesso concedido pela empresa e as mensagens diretas enviadas e recebidas por ela, incluindo o identificador do contato no Instagram e os arquivos enviados. Mensagens de áudio também são transcritas em texto por um provedor de IA.
        </p>
        <p>
          Quando o contato desfaz uma mensagem no Instagram, apagamos o conteúdo e os arquivos dela assim que a Meta avisa; fica só o registro, sem conteúdo, de que a mensagem existiu, para não gravá-la de novo se ela chegar outra vez.
        </p>
        <p>
          Quando o contato responde a um story da empresa ou compartilha um post dela, o story ou o post é descrito por IA no momento da mensagem, para o assistente saber de que produto se trata (a descrição fica guardada por 30 dias; a imagem, não). O post ou o story de outra conta que o contato envia, e o story em que ele marca a empresa, são tratados como uma foto enviada por ele (veja &quot;Leitura de fotos&quot;). Quando a empresa usa links do Instagram com origem (por exemplo, o link da bio ou de um QR impresso), guardamos de qual link a pessoa abriu a conversa.
        </p>
        <p>
          Quando a empresa liga as respostas aos comentários dos posts, recebemos os comentários feitos nos posts dela, com o nome de usuário de quem comentou. Guardamos o comentário (cifrado) e o que o assistente respondeu (em público ou por mensagem direta) por 90 dias, para a empresa ver no painel. Comentários com ofensa ou spam não são respondidos.
        </p>
        <p>
          Usamos esses dados somente para responder as mensagens com o assistente da empresa, permitir o atendimento humano e mostrar o histórico no painel. Não vendemos esses dados, não os usamos para publicidade nem para treinar modelos de IA. A empresa pode desconectar a conta no painel ou nas configurações do Instagram (Apps e sites); com isso, o token é apagado.
        </p>
      </Section>

      <Section title="5. Para que usamos e com qual base legal">
        <ul>
          <li><strong>Prestar o serviço contratado</strong> (execução de contrato; nos dados dos contatos, por instrução da empresa atendida): operar os assistentes, entregar contatos, relatórios e atendimento humano, e enviar aos sistemas que a empresa conectou (Integrações) os dados que ela pediu.</li>
          <li><strong>Verificação de uso e conformidade</strong> (por instrução da empresa atendida, como parte do serviço e para cumprir as políticas da Meta), descrita no item 6.</li>
          <li><strong>Registros de acesso</strong> (obrigação legal: Marco Civil da Internet, art. 15).</li>
          <li><strong>Cobrança e obrigações fiscais</strong> (execução de contrato e obrigação legal).</li>
          <li><strong>Segurança e prevenção a fraude</strong> (legítimo interesse, só nos dados da conta e para prevenir fraude): limites de uso, auditoria, investigação de abusos e os sinais que fazem o teste grátis valer uma vez por pessoa.</li>
          <li><strong>Comunicações sobre a conta</strong> (execução de contrato): avisos de cobrança, crédito, cota, segurança e alterações relevantes. Os e-mails de aviso não levam conteúdo de conversa: o de novo contato leva só o nome, o canal e o link para o painel.</li>
          <li><strong>Avisos e assistente no WhatsApp da equipe</strong> (consentimento da pessoa, dado no painel e confirmado no WhatsApp): os avisos que ela escolheu e a conversa com o assistente da {brand}, que responde sobre o painel e sobre a conta (só o que o papel dela vê no painel). Ela retira o consentimento quando quiser, mandando SAIR no WhatsApp ou desligando em Meu perfil.</li>
        </ul>
      </Section>

      <Section title="6. Verificação de uso e conformidade">
        <p>
          Para evitar usos proibidos e proteger os canais de todos os clientes, analisamos, com apoio de inteligência artificial, o conteúdo dos assistentes, os sites e perfis informados e os sinais do canal. Pedidos de itens proibidos ou regulamentados são identificados no momento da conversa, para aplicar as regras da Meta (por exemplo, a confirmação de maioridade antes de mostrar bebida alcoólica). Guardamos apenas a classificação resultante (por exemplo, &quot;item proibido detectado&quot; ou &quot;fora do assunto&quot;) por 1 ano, e resumos técnicos da análise do assistente por 30 dias. Identificadores de contexto de sistemas integrados nunca são enviados aos provedores de IA.
        </p>
      </Section>

      <Section title="7. Com quem compartilhamos" id="suboperadores">
        <p>Usamos estes subcontratados para operar a plataforma, sob contrato:</p>
        <ul>
          <li><strong>Supabase</strong>: banco de dados, autenticação, fila e arquivos (Brasil, região de São Paulo).</li>
          <li><strong>Vercel</strong>: hospedagem da aplicação (funções na região de São Paulo).</li>
          <li><strong>Provedores de IA</strong> (OpenAI, Anthropic, Google e Groq): geram as respostas, processam a base de conhecimento, transcrevem áudios e descrevem as fotos enviadas pelos contatos e as fotos dos posts e stories da empresa no Instagram (a OpenAI). Pelos termos de uso das APIs, não usam os dados para treinar modelos. Junto de cada pedido vai um código do contato (gerado pela {brand} com uma chave própria, sem o telefone nem o nome), para o provedor poder bloquear só aquele contato em caso de abuso.</li>
          <li><strong>Meta Platforms</strong>: entrega de mensagens no WhatsApp e no Instagram, quando a empresa conecta esses canais.</li>
          <li><strong>Stripe</strong>: pagamentos.</li>
          <li><strong>Resend</strong>: envio de e-mails.</li>
          <li><strong>Serviços de notificação dos navegadores</strong> (Google, Apple, Mozilla e Microsoft): entregam os avisos no celular e no computador às pessoas da equipe que os ativam; o aviso vai cifrado e não leva o conteúdo das conversas.</li>
          <li><strong>Sentry</strong>: monitoramento de erros técnicos da plataforma, configurado para não receber conteúdo de conversas, cookies nem dados de usuários.</li>
        </ul>
        <p>
          Quando a empresa conecta os próprios sistemas (ações, webhooks e API), enviamos a eles os dados que ela pediu, por instrução dela. Pedidos de autoridades públicas só são atendidos com pedido formal e base legal (e ordem judicial, quando a lei exige), entregando o mínimo necessário e avisando a empresa responsável, salvo quando a lei ou a ordem proibir. Não vendemos dados pessoais.
        </p>
      </Section>

      <Section title="8. Transferência internacional">
        <p>
          Alguns subcontratados, em especial os provedores de IA, a Meta, a Stripe, a Resend e a Sentry, tratam dados fora do Brasil. Essas transferências seguem o art. 33 da LGPD.
        </p>
      </Section>

      <Section title="9. Segurança e criptografia">
        <p>
          Usamos conexão criptografada (HTTPS) e criptografia de disco no banco de dados. Além disso, o conteúdo das conversas, os arquivos recebidos, o telefone e o ID do Instagram dos contatos, o telefone e o interesse dos leads e as perguntas feitas aos assistentes são criptografados pela própria plataforma antes de serem gravados, com uma chave exclusiva de cada empresa atendida (cada cliente tem a sua chave, separada das demais). Quem acessar o banco ou uma cópia dele sem essa chave vê esses dados apenas como texto ilegível. Nome e e-mail dos contatos ficam fora dessa camada, para permitir a busca por nome no painel, e seguem protegidos pela criptografia de disco e pelo controle de acesso. Os dados são decifrados somente no momento do uso: para gerar respostas, mostrar o histórico a quem tem permissão e entregar aos sistemas que a empresa conectou.
        </p>
        <p>
          O painel registra quem fez o quê (auditoria) e quem acessou, avisa o dono da conta por e-mail sobre eventos graves (como chave de API nova ou acesso do suporte liberado) e pede verificação em duas etapas nas áreas sensíveis: Segurança, exportação de dados e conversas de assistentes em modo dados sensíveis.
        </p>
        <p>
          Nenhum sistema é totalmente imune a falhas. Em incidente relevante com dados de contatos, avisamos as empresas responsáveis (a agência e a empresa atendida), que fazem os avisos à ANPD e aos afetados; nos dados da conta, que são nossos, avisamos os afetados e a ANPD.
        </p>
      </Section>

      <Section title={`10. Acesso da equipe da ${brand}`}>
        <p>
          Nossa equipe de suporte não lê o conteúdo das conversas sem autorização da empresa, concedida no painel (Segurança) por 24 horas e com motivo. A liberação é avisada ao dono da conta, e cada conversa ou arquivo aberto pelo suporte fica registrado na auditoria da conta. A empresa pode encerrar o acesso a qualquer momento.
        </p>
      </Section>

      <Section title="11. Por quanto tempo guardamos">
        <ul>
          <li>
            <strong>Conversas, arquivos recebidos, leads e perguntas:</strong> 12 meses após a última mensagem, ou 6 ou 24 meses, se a empresa atendida escolher (cada empresa tem o seu prazo; sem escolha, vale o padrão da conta que a atende). Quando o prazo diminui, a mudança só vale 30 dias depois do aviso, com opção de exportar. Em assistentes com o modo dados sensíveis, o prazo escolhido pela empresa, de 7 a 90 dias, e arquivos recebidos por até 30 dias.
          </li>
          <li><strong>Ficha do contato (com as datas informadas pela empresa) e resposta de maioridade:</strong> apagadas quando o contato fica parado pelo prazo acima, sem conversa, vínculo ativo, aceite de novidades em vigor, lead, mensagem agendada nem horário marcado pela frente.</li>
          <li><strong>Memória do assistente:</strong> 180 dias desde a última atualização; sai antes quando a pessoa pede para esquecer, quando a empresa apaga ou desliga a memória, quando o modo dados sensíveis é ligado e junto com a ficha do contato (inclusive no pedido de exclusão).</li>
          <li><strong>Registros técnicos de integrações</strong> (chamadas de ações e entregas de webhooks): 30 dias.</li>
          <li><strong>Instagram:</strong> comentários recebidos e as respostas, 90 dias; descrições de stories e posts lidos no momento da mensagem, 30 dias; os posts lidos como base de conhecimento ficam enquanto estiverem entre os 100 mais novos dos últimos 90 dias.</li>
          <li><strong>Auditoria da conta</strong> (sem conteúdo de conversas): 1 ano.</li>
          <li><strong>Registros de acesso ao painel e à área do cliente</strong> (IP, data e hora): 6 meses, como exige o Marco Civil da Internet.</li>
          <li>
            <strong>Visitantes do chat do site:</strong> IP, data e hora de cada conversa, por 6 meses, sob sigilo, sem acesso da empresa ou da agência, entregues só por ordem judicial (Marco Civil, arts. 10 e 15); esses registros ficam os 6 meses mesmo depois de um pedido de exclusão.
          </li>
          <li>
            <strong>Lista de supressão:</strong> quem pede para sair (&quot;SAIR&quot;, &quot;PARAR&quot; ou o pedido de exclusão) entra numa lista consultada em todo envio iniciado pela empresa, guardada por 5 anos só com um código do número (hash), o canal, o tipo de mensagem e a data, como prova; ela continua valendo mesmo que o contato seja apagado.
          </li>
          <li>
            <strong>Consentimento para novidades e promoções:</strong> quando a pessoa aceita ou recusa receber novidades pelo WhatsApp, guardamos a resposta, o texto mostrado, a origem e a data, só com um código do número (hash), como prova (LGPD, art. 8º, § 2º). O aceite vale até ser revogado (responder &quot;SAIR&quot; revoga na hora); depois da revogação ou da recusa, o registro fica 5 anos e é apagado, mesmo que o contato já tenha sido apagado antes.
          </li>
          <li><strong>Totais dos relatórios:</strong> números por dia, sem dados pessoais, enquanto a conta existir.</li>
          <li><strong>Tokens de acesso do WhatsApp e do Instagram:</strong> até a desconexão ou o encerramento da conta.</li>
          <li><strong>WhatsApp da equipe para avisos:</strong> enquanto a pessoa estiver na equipe e quiser receber; sai quando ela para os avisos ou sai da equipe. As conversas com o assistente da {brand} seguem o prazo das conversas (12 meses).</li>
          <li><strong>Aparelhos que recebem os avisos:</strong> até a pessoa desativar ou remover o aparelho, o navegador recusar o endereço ou a pessoa sair da equipe.</li>
          <li><strong>Sinais contra o abuso da conta grátis:</strong> enquanto a conta existir e por 12 meses depois de ela ser excluída; a marca de quem desistiu da assinatura em 7 dias, por 12 meses.</li>
          <li><strong>Dados da conta:</strong> enquanto ela estiver ativa, e depois pelo prazo exigido por lei (por exemplo, registros fiscais).</li>
        </ul>
        <p>
          A empresa atendida pode exportar os dados do seu atendimento (conversas, contatos e leads) a qualquer momento. Ao excluir um cliente, a chave de criptografia dele é apagada: o que ela protegia fica ilegível. O dono da conta pode excluí-la em Segurança: 7 dias depois do pedido (até lá, dá para desistir), apagamos os chatbots, as conversas, os contatos, os leads, os arquivos e a equipe, e ficam só a auditoria (1 ano) e os registros de acesso (6 meses), como pede a lei.
        </p>
      </Section>

      <Section title="12. Dados sensíveis">
        <p>
          Quando o modo dados sensíveis é ligado num assistente, pela empresa ou pela agência que cuida dele (a {brand} sugere isso para negócios de saúde), as conversas dele ficam guardadas por menos tempo, num prazo escolhido entre 7 e 90 dias; os arquivos recebidos, por até 30 dias; abrir essas conversas no painel ou na área do cliente exige verificação em duas etapas; e a memória do assistente fica desligada (ligar o modo apaga a que havia). Quando a agência muda o modo, a empresa recebe um aviso. Em todos os assistentes, enviamos aos provedores de IA e aos registros técnicos só o necessário.
        </p>
      </Section>

      <Section title="13. Seus direitos">
        <p>
          Você pode pedir confirmação do tratamento, acesso, correção, anonimização, portabilidade, eliminação dos dados, informação sobre compartilhamento e revogação do consentimento, e também reclamar à ANPD. Você pode pedir a exclusão escrevendo no próprio chat (por exemplo, &quot;apaga meus dados&quot;): o pedido é registrado, encaminhado à empresa responsável e concluído no prazo legal, com confirmação a você quando o canal permitir. Veja também <Link href="/exclusao-de-dados">Exclusão de dados</Link>, ou escreva para <a href={`mailto:${email}`}>{email}</a>. Respondemos em até 15 dias.
        </p>
      </Section>

      <Section title="14. Menores de idade">
        <p>O painel da {brand} é destinado a maiores de 18 anos. Não coletamos intencionalmente dados de crianças.</p>
      </Section>

      <Section title="15. Mudanças nesta política">
        <p>Podemos atualizar esta política. A data no topo mostra a versão atual. Mudanças relevantes serão avisadas por e-mail ou no painel.</p>
      </Section>
    </LegalPage>
  );
}
