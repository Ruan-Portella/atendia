import Link from "next/link";
import { LegalPage, Section } from "@/components/legal-page";
import { company, companyIdentity } from "@/lib/company";

export const metadata = { title: "Política de Privacidade" };

/*
 * Leva S (05/10/2026): papéis em três camadas, cifra por cliente, retenção por negócio, registros de
 * acesso, modo dados sensíveis, arquivos recebidos, pedido pelo chat, acesso do suporte com
 * autorização e subcontratados. Só entra aqui o que já existe: encerramento com carência e o prazo
 * dos backups (depois do Supabase Pro) entram quando existirem. Leva B3 (06/10/2026): a prova do
 * consentimento para novidades; o envio de campanhas entra com a tela de campanhas.
 */
export default function PrivacyPage() {
  const { brand, email } = company;
  const operator = companyIdentity();
  return (
    <LegalPage
      title="Política de Privacidade"
      updatedAt="6 de outubro de 2026"
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
          <li><strong>Pagamento:</strong> plano, histórico de cobranças e identificadores do meio de pagamento. Os dados do cartão são tratados diretamente pela Stripe; não os armazenamos.</li>
          <li><strong>Conteúdo dos assistentes:</strong> páginas de sites, documentos e textos enviados para formar a base de conhecimento.</li>
          <li><strong>Conversas:</strong> mensagens trocadas com os assistentes e com atendentes humanos, data e hora, canal e um identificador técnico do visitante.</li>
          <li><strong>Arquivos recebidos:</strong> fotos, áudios, vídeos e documentos que o contato envia pelo WhatsApp ou pelo Instagram (até 16 MB), guardados para a empresa ver no histórico da conversa.</li>
          <li><strong>Contato:</strong> telefone ou identificador do WhatsApp e do Instagram, nome de perfil e, quando a empresa identifica o cliente dela no chat, o identificador informado por ela. Quando o contato pede um item regulamentado (como bebida alcoólica), guardamos a resposta à pergunta de maioridade.</li>
          <li><strong>Leads:</strong> nome, telefone, e-mail e o interesse, quando a pessoa decide informá-los.</li>
          <li>
            <strong>Registros de acesso:</strong> endereço IP completo, data e hora dos acessos ao painel e à área do cliente (entradas e sessões) e do chat do site (início de cada conversa e mudança de IP), como exige o Marco Civil da Internet. Nos demais registros, como o limite de uso do chat, o IP é guardado apenas como um código (hash).
          </li>
          <li><strong>Auditoria:</strong> quem fez o quê na conta (por exemplo, conectar um canal ou mudar um prazo), sem conteúdo de conversas.</li>
          <li><strong>Dados técnicos:</strong> tipo de navegador, cookies de sessão do painel e armazenamento local do navegador para manter a conversa do chat do site.</li>
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
          Usamos esses dados somente para responder as mensagens com o assistente da empresa, permitir o atendimento humano e mostrar o histórico no painel. Não vendemos esses dados, não os usamos para publicidade nem para treinar modelos de IA. A empresa pode desconectar a conta no painel ou nas configurações do Instagram (Apps e sites); com isso, o token é apagado.
        </p>
      </Section>

      <Section title="5. Para que usamos e com qual base legal">
        <ul>
          <li><strong>Prestar o serviço contratado</strong> (execução de contrato; nos dados dos contatos, por instrução da empresa atendida): operar os assistentes, entregar contatos, relatórios e atendimento humano, e enviar aos sistemas que a empresa conectou (Integrações) os dados que ela pediu.</li>
          <li><strong>Verificação de uso e conformidade</strong> (por instrução da empresa atendida, como parte do serviço e para cumprir as políticas da Meta), descrita no item 6.</li>
          <li><strong>Registros de acesso</strong> (obrigação legal: Marco Civil da Internet, art. 15).</li>
          <li><strong>Cobrança e obrigações fiscais</strong> (execução de contrato e obrigação legal).</li>
          <li><strong>Segurança e prevenção a fraude</strong> (legítimo interesse, só nos dados da conta e para prevenir fraude): limites de uso, auditoria e investigação de abusos.</li>
          <li><strong>Comunicações sobre a conta</strong> (execução de contrato): avisos de teste, cobrança, segurança e alterações relevantes. Os e-mails de aviso não levam conteúdo de conversa: o de novo contato leva só o nome, o canal e o link para o painel.</li>
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
          <li><strong>Provedores de IA</strong> (OpenAI, Anthropic e Google): geram as respostas, processam a base de conhecimento e transcrevem áudios. Pelos termos de uso das APIs, não usam os dados para treinar modelos.</li>
          <li><strong>Meta Platforms</strong>: entrega de mensagens no WhatsApp e no Instagram, quando a empresa conecta esses canais.</li>
          <li><strong>Stripe</strong>: pagamentos.</li>
          <li><strong>Resend</strong>: envio de e-mails.</li>
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
          <li><strong>Ficha do contato e resposta de maioridade:</strong> apagadas quando o contato fica parado pelo prazo acima, sem conversa nem vínculo ativo.</li>
          <li><strong>Registros técnicos de integrações</strong> (chamadas de ações e entregas de webhooks): 30 dias.</li>
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
          <li><strong>Dados da conta:</strong> enquanto ela estiver ativa, e depois pelo prazo exigido por lei (por exemplo, registros fiscais).</li>
        </ul>
        <p>
          A empresa atendida pode exportar os dados do seu atendimento (conversas, contatos e leads) a qualquer momento. Ao excluir um cliente, a chave de criptografia dele é apagada: o que ela protegia fica ilegível.
        </p>
      </Section>

      <Section title="12. Dados sensíveis">
        <p>
          Quando o modo dados sensíveis é ligado num assistente, pela empresa ou pela agência que cuida dele (a {brand} sugere isso para negócios de saúde), as conversas dele ficam guardadas por menos tempo, num prazo escolhido entre 7 e 90 dias; os arquivos recebidos, por até 30 dias; e abrir essas conversas no painel ou na área do cliente exige verificação em duas etapas. Quando a agência muda o modo, a empresa recebe um aviso. Em todos os assistentes, enviamos aos provedores de IA e aos registros técnicos só o necessário.
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
