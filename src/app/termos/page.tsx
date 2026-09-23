import Link from "next/link";
import { LegalPage, Section } from "@/components/legal-page";
import { company, companyIdentity } from "@/lib/company";

export const metadata = { title: "Termos de Uso" };

export default function TermsPage() {
  const { brand, email } = company;
  const operator = companyIdentity();
  return (
    <LegalPage title="Termos de Uso" intro={`Estes termos regem o uso da plataforma ${brand}. Ao criar uma conta, você concorda com eles.`}>
      <Section title="1. O serviço">
        <p>
          A {brand}{operator && `, operada por ${operator},`} é uma plataforma para criar, personalizar e publicar assistentes virtuais de atendimento, treinados no conteúdo de cada empresa, em sites e canais de mensagem como o WhatsApp. O assistente atende os clientes da própria empresa: responde dúvidas, registra contatos e passa a conversa para um atendente humano quando preciso.
        </p>
      </Section>

      <Section title="2. Conta">
        <ul>
          <li>Você precisa ter 18 anos ou mais e informar dados verdadeiros.</li>
          <li>Você responde pelo que acontece na sua conta e por quem você convida para ela, inclusive os seus clientes.</li>
          <li>Guarde bem o seu acesso e nos avise se suspeitar de uso indevido.</li>
        </ul>
      </Section>

      <Section title="3. Planos, teste e pagamento">
        <ul>
          <li>Novas contas têm um período de teste grátis. Ao fim dele, o assistente só volta a responder com um plano pago.</li>
          <li>Os planos são cobrados por mês, antecipadamente, pela Stripe. Você pode cancelar quando quiser; o acesso continua até o fim do período já pago.</li>
          <li>Os limites de cada plano (assistentes, conversas) estão na página de preços e no painel.</li>
          <li>
            <strong>Custos do WhatsApp:</strong> mensagens no WhatsApp podem ser cobradas pela Meta diretamente da empresa dona do número, conforme a tabela da Meta. Esses valores não fazem parte do plano da {brand}.
          </li>
        </ul>
      </Section>

      <Section title="4. Seu conteúdo">
        <p>
          O conteúdo que você envia (sites, documentos, textos, logos) continua sendo seu. Você nos dá permissão para processá-lo apenas para operar os seus assistentes. Você garante que tem direito de usar esse conteúdo e de tratar os dados pessoais envolvidos. Nos dados dos seus clientes e dos visitantes deles, você (ou a empresa cliente) é o controlador, e a {brand} é operadora, conforme a <Link href="/privacidade">Política de Privacidade</Link>.
        </p>
      </Section>

      <Section title="5. Uso do WhatsApp">
        <ul>
          <li>Para conectar um número, a empresa precisa aceitar os Termos do WhatsApp Business e seguir a Política Comercial e a Política de Mensagens do WhatsApp Business.</li>
          <li>Só envie mensagens para quem aceitou recebê-las (opt-in). Fora da janela de atendimento de 24 horas, use apenas modelos de mensagem aprovados pela Meta.</li>
          <li>O assistente deve servir ao atendimento da empresa. É proibido usá-lo como assistente de IA de uso geral, para spam ou para produtos e conteúdos vedados pelas políticas da Meta.</li>
          <li>A Meta pode restringir ou bloquear números que violem as regras dela. A {brand} não responde por essas decisões.</li>
        </ul>
      </Section>

      <Section title="6. Usos proibidos">
        <p>Não é permitido usar a {brand} para:</p>
        <ul>
          <li>atividades ilegais, fraude, golpes ou falsidade ideológica;</li>
          <li>spam, mensagens em massa sem consentimento ou coleta de dados sem base legal;</li>
          <li>discurso de ódio, assédio, conteúdo sexual envolvendo menores ou conteúdo que viole direitos de terceiros;</li>
          <li>tentar invadir, sobrecarregar ou copiar a plataforma, ou contornar os limites dos planos.</li>
        </ul>
        <p>Podemos suspender contas que violem estes termos, avisando sempre que possível.</p>
      </Section>

      <Section title="7. Respostas da IA">
        <p>
          O assistente gera respostas automaticamente, a partir do conteúdo que você forneceu, e pode errar. Revise a base de conhecimento, teste o assistente antes de publicar e não o use como única fonte para decisões médicas, jurídicas ou financeiras.
        </p>
      </Section>

      <Section title="8. Disponibilidade e responsabilidade">
        <p>
          Trabalhamos para manter a plataforma no ar, mas não garantimos funcionamento ininterrupto: dependemos de fornecedores como hospedagem, provedores de IA e a Meta. Na medida permitida pela lei, nossa responsabilidade total se limita ao valor pago por você nos 12 meses anteriores ao fato, e não respondemos por lucros cessantes ou danos indiretos.
        </p>
      </Section>

      <Section title="9. Encerramento">
        <p>
          Você pode encerrar a conta quando quiser. Após o encerramento, apagamos os dados conforme a <Link href="/privacidade">Política de Privacidade</Link> e a página de <Link href="/exclusao-de-dados">Exclusão de dados</Link>, exceto o que a lei nos obriga a guardar.
        </p>
      </Section>

      <Section title="10. Mudanças e foro">
        <p>
          Podemos atualizar estes termos e avisaremos as mudanças relevantes com antecedência. Estes termos seguem as leis do Brasil. Dúvidas: <a href={`mailto:${email}`}>{email}</a>.
        </p>
      </Section>
    </LegalPage>
  );
}
