import Link from "next/link";
import { LegalPage, Section } from "@/components/legal-page";
import { company, companyIdentity } from "@/lib/company";

export const metadata = { title: "Política de Privacidade" };

export default function PrivacyPage() {
  const { brand, email } = company;
  const operator = companyIdentity();
  return (
    <LegalPage
      title="Política de Privacidade"
      intro={`Esta política explica quais dados pessoais a ${brand} trata, para quê, com quem compartilha e como você exerce seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018, LGPD).`}
    >
      <Section title="1. Quem somos">
        <p>
          {operator ? `A plataforma ${brand} é operada por ${operator}. ` : ""}A {brand} permite que agências e profissionais criem assistentes virtuais (chatbots) para empresas clientes, treinados no conteúdo dessas empresas, e os publiquem em sites e canais de mensagem, como o WhatsApp.
        </p>
        <p>Contato do encarregado de dados (DPO): <a href={`mailto:${email}`}>{email}</a>.</p>
      </Section>

      <Section title="2. Nosso papel em cada tipo de dado">
        <ul>
          <li><strong>Dados da sua conta</strong> (agências e usuários do painel): a {brand} é a <strong>controladora</strong>.</li>
          <li>
            <strong>Dados de quem conversa com os assistentes</strong> (visitantes de sites e contatos no WhatsApp): a controladora é a agência ou a empresa dona do assistente. A {brand} é <strong>operadora</strong> e trata esses dados apenas para prestar o serviço, conforme as instruções dela. Pedidos sobre esses dados devem ir primeiro à empresa com quem você conversou; também ajudamos pelo e-mail acima.
          </li>
        </ul>
      </Section>

      <Section title="3. Dados que tratamos">
        <ul>
          <li><strong>Cadastro:</strong> nome, e-mail, nome da agência, logo, cores, telefone de suporte e dados de acesso.</li>
          <li><strong>Pagamento:</strong> plano, histórico de cobranças e identificadores do meio de pagamento. Os dados do cartão são tratados diretamente pela Stripe; não os armazenamos.</li>
          <li><strong>Conteúdo dos assistentes:</strong> páginas de sites, documentos e textos enviados para formar a base de conhecimento.</li>
          <li><strong>Conversas:</strong> mensagens trocadas com os assistentes e com atendentes humanos, data e hora, canal e um identificador técnico do visitante.</li>
          <li><strong>Contatos (leads):</strong> nome, telefone/WhatsApp, e-mail e resumo da conversa, quando a pessoa decide informá-los.</li>
          <li><strong>Dados técnicos:</strong> endereço IP (guardado apenas como hash, para limitar abuso), tipo de navegador, cookies de sessão do painel e armazenamento local do navegador para manter a conversa do widget.</li>
        </ul>
      </Section>

      <Section title="4. WhatsApp e produtos da Meta">
        <p>
          Quando uma empresa conecta um número de WhatsApp Business à {brand} (pelo cadastro incorporado da Meta), recebemos e tratamos: identificadores da conta WhatsApp Business e do número, o token de acesso concedido pela empresa, e as mensagens enviadas e recebidas nesse número, incluindo o número de telefone, o nome de perfil do contato e o status de entrega.
        </p>
        <p>
          Usamos esses dados <strong>somente</strong> para receber as mensagens, gerar e enviar as respostas do assistente, permitir o atendimento humano e mostrar o histórico no painel da empresa. Não vendemos esses dados, não os usamos para publicidade e não os usamos para treinar modelos de inteligência artificial. O uso também segue os Termos e as Políticas do WhatsApp Business e da Meta.
        </p>
        <p>
          A empresa pode desconectar o número a qualquer momento no painel da {brand} ou nas configurações da Meta. Com isso, deixamos de receber mensagens e apagamos o token de acesso.
        </p>
      </Section>

      <Section title="5. Para que usamos e com qual base legal">
        <ul>
          <li><strong>Prestar o serviço contratado</strong> (execução de contrato): criar e operar os assistentes, entregar contatos, relatórios e atendimento humano.</li>
          <li><strong>Cobrança e obrigações fiscais</strong> (execução de contrato e obrigação legal).</li>
          <li><strong>Segurança e prevenção a abuso</strong> (legítimo interesse): limites de uso, registros de acesso e investigação de fraudes.</li>
          <li><strong>Comunicações sobre a conta</strong> (execução de contrato): avisos de teste, cobrança e alterações relevantes.</li>
        </ul>
      </Section>

      <Section title="6. Com quem compartilhamos">
        <p>Compartilhamos dados apenas com fornecedores necessários para operar a plataforma, sob contrato:</p>
        <ul>
          <li><strong>Supabase</strong>: banco de dados e autenticação.</li>
          <li><strong>Vercel</strong>: hospedagem da aplicação.</li>
          <li><strong>Provedores de IA</strong> (OpenAI, Anthropic e Google): geram as respostas e processam a base de conhecimento.</li>
          <li><strong>Stripe</strong>: pagamentos.</li>
          <li><strong>Resend</strong>: envio de e-mails.</li>
          <li><strong>Meta Platforms</strong>: entrega de mensagens no WhatsApp, quando a empresa conecta esse canal.</li>
        </ul>
        <p>Também podemos compartilhar dados por ordem judicial ou exigência legal. Não vendemos dados pessoais.</p>
      </Section>

      <Section title="7. Transferência internacional">
        <p>
          Alguns fornecedores, em especial os provedores de IA e a Meta, processam dados fora do Brasil. Essas transferências seguem o art. 33 da LGPD, com cláusulas contratuais e garantias de proteção equivalentes.
        </p>
      </Section>

      <Section title="8. Por quanto tempo guardamos">
        <ul>
          <li>Dados da conta: enquanto ela estiver ativa, e depois pelo prazo exigido por lei (por exemplo, registros fiscais).</li>
          <li>Conversas e contatos: pelo prazo definido por cada agência no painel (6, 12 ou 24 meses) ou até serem apagados por ela.</li>
          <li>Tokens de acesso do WhatsApp: até a desconexão do número ou o encerramento da conta.</li>
        </ul>
      </Section>

      <Section title="9. Seus direitos">
        <p>
          Você pode pedir confirmação do tratamento, acesso, correção, anonimização, portabilidade, eliminação dos dados, informação sobre compartilhamento e revogação do consentimento, e também reclamar à ANPD. Veja como pedir a exclusão em <Link href="/exclusao-de-dados">Exclusão de dados</Link>, ou escreva para <a href={`mailto:${email}`}>{email}</a>. Respondemos em até 15 dias.
        </p>
      </Section>

      <Section title="10. Segurança">
        <p>
          Usamos conexão criptografada (HTTPS), controle de acesso por conta, isolamento de dados entre agências no banco e chaves de acesso guardadas apenas no servidor. Nenhum sistema é totalmente imune a falhas. Se houver um incidente relevante, avisaremos os afetados e a ANPD, como manda a lei.
        </p>
      </Section>

      <Section title="11. Menores de idade">
        <p>O painel da {brand} é destinado a maiores de 18 anos. Não coletamos intencionalmente dados de crianças.</p>
      </Section>

      <Section title="12. Mudanças nesta política">
        <p>Podemos atualizar esta política. A data no topo mostra a versão atual. Mudanças relevantes serão avisadas por e-mail ou no painel.</p>
      </Section>
    </LegalPage>
  );
}
