import Link from "next/link";
import { LegalPage, Section } from "@/components/legal-page";
import { company, companyIdentity } from "@/lib/company";
import { CREDIT_MIN_BRL, CREDIT_VALID_MONTHS, DEMOS_PER_MONTH, DEMOS_PER_MONTH_FREE, DEMO_ANSWERS, DEMO_ANSWERS_SHOWCASE, DEMO_DAYS, FIRST_WEEK_CREDIT_BRL, FIRST_WEEK_DAYS, FIRST_WEEK_QUOTA_SHARE, OVERAGE_PRICE_BRL, TEST_ANSWERS_FREE, WITHDRAWAL_MARK_MONTHS, brl, brlCents } from "@/lib/plans";

export const metadata = { title: "Termos de Uso" };

export default function TermsPage() {
  const { brand, email } = company;
  const operator = companyIdentity();
  return (
    <LegalPage title="Termos de Uso" updatedAt="21 de outubro de 2026" intro={`Estes termos regem o uso da plataforma ${brand}. Ao criar uma conta, você concorda com eles.`}>
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

      <Section title="3. Conta grátis, tamanhos e pagamento">
        <ul>
          <li>
            <strong>Conta grátis:</strong> você monta e testa os assistentes sem cartão, com até {TEST_ANSWERS_FREE} respostas de teste da IA na conta, somando o teste no painel e as demos. Cada demo vale {DEMO_DAYS} dias e responde até {DEMO_ANSWERS} vezes (a gerada no site da {brand} sem conta, até {DEMO_ANSWERS_SHOWCASE}); a conta gera até {DEMOS_PER_MONTH_FREE} demos por mês, ou {DEMOS_PER_MONTH} com assinatura. O site, o WhatsApp e o Instagram só ligam num assistente com tamanho. O teste vale uma vez por pessoa: a conta ligada a outra da mesma pessoa que já usou o teste ou assinou (pelo e-mail, pelo navegador, pelo número de WhatsApp, pelo documento ou pelo cartão) fica sem as respostas de teste e sem demos, e e-mails temporários não abrem conta. Se for engano, o suporte libera.
          </li>
          <li>
            <strong>Tamanhos e pacotes:</strong> cada assistente no ar tem um tamanho, cobrado por mês: o tamanho Atendimento, sem nenhum recurso de IA (só a sua equipe responde), ou um tamanho com IA (P, M, G ou Volume), com uma cota de atendimentos por mês. Os pacotes (Domínio próprio, Integrações e Plataforma) valem para a conta toda. Os preços e as cotas estão na página de preços e no painel; mudanças de preço são avisadas com antecedência.
          </li>
          <li>
            <strong>Atendimento</strong>, a unidade da cota, igual no site, no WhatsApp e no Instagram: 1 atendimento = cada período de 24 horas em que a IA respondeu a um contato, contado a partir da primeira resposta da IA, por contato, assistente e canal, com até 40 respostas da IA; a seguinte abre outro atendimento. Conversa nova, troca de contexto ou logout dentro das 24 horas não abrem outro. Não contam: respostas da equipe (painel ou celular), mensagens pela API, campanhas e lembretes, textos fixos da {brand} e períodos com a IA ou o assistente pausados. O mês é o mês civil, no horário de Brasília.
          </li>
          <li>
            A cota é de cada assistente, pelo tamanho dele, sem tolerância. Quando a cota de um assistente acaba, só ele entra no <strong>modo só humano</strong> até o mês virar, a não ser que o excedente esteja ligado. No modo só humano, a IA para de responder, as conversas continuam gravadas e a sua equipe segue respondendo pelo painel. Atendimento já aberto vai até completar 24 horas ou 40 respostas.
          </li>
          <li>
            <strong>Excedente e crédito:</strong> com o excedente ligado num assistente, cada atendimento além da cota custa {brlCents(OVERAGE_PRICE_BRL)}, descontado do crédito pré-pago da conta. O crédito é comprado a partir de {brl(CREDIT_MIN_BRL)}, vale {CREDIT_VALID_MONTHS} meses, é usado na ordem de vencimento e não é reembolsável, salvo na desistência em {FIRST_WEEK_DAYS} dias (abaixo) ou quando a lei garantir. A recarga automática é opcional, com o valor e o limite por mês escolhidos por você. Um pico anormal no chat do site suspende o excedente daquele assistente até você confirmar que o tráfego é real.
          </li>
          <li>
            <strong>Cobrança:</strong> pela Stripe, no cartão (o crédito do excedente também pode ser comprado pelo Pix). A fatura fecha todo dia 1º (mês civil, no horário de Brasília); o primeiro mês é proporcional, no preço e na cota. Subir de tamanho ou assinar um pacote vale na hora, com a diferença proporcional cobrada no ato; descer de tamanho ou tirar um pacote vale no dia 1º seguinte. Você pode cancelar quando quiser: a assinatura segue até o dia 1º seguinte, sem reembolso do mês em curso, salvo quando a lei exigir.
          </li>
          <li>
            <strong>Desistência em {FIRST_WEEK_DAYS} dias</strong> (art. 49 do Código de Defesa do Consumidor): nos {FIRST_WEEK_DAYS} dias do pagamento que abre a assinatura, você pode desistir em Cobrança. Estornamos tudo o que foi pago desde então (assinatura, subidas e crédito), a assinatura acaba na hora, os assistentes ficam sem tamanho e a conta volta para a conta grátis, sem as respostas de teste. Para evitar abuso, os dados de quem desistiu (o e-mail, o número, o documento, o cartão e o navegador, guardados só como código) ficam marcados por {WITHDRAWAL_MARK_MONTHS} meses: nesse período, nenhuma conta dessa pessoa ganha o teste grátis, e a desistência de uma assinatura nova é feita pelo suporte, que analisa o pedido.
          </li>
          <li>
            <strong>Contestação no cartão:</strong> se um pagamento for contestado no banco, a assinatura é encerrada na hora (os assistentes ficam sem tamanho; a configuração fica guardada), e enviamos à Stripe, para o banco analisar, as provas da contratação e do uso: o aceite destes termos ao assinar, as entradas no painel (data, hora e IP) e o uso do serviço no período, sem o conteúdo das conversas. Quem contesta fica marcado por {WITHDRAWAL_MARK_MONTHS} meses, como na desistência. Se foi engano, fale com o suporte e retire a contestação no banco: o dinheiro de volta, quando cabe, sai pelo suporte ou pela desistência em {FIRST_WEEK_DAYS} dias.
          </li>
          <li>
            <strong>Primeira semana da assinatura:</strong> nos mesmos {FIRST_WEEK_DAYS} dias, cada assistente usa até {Math.round(FIRST_WEEK_QUOTA_SHARE * 100)}% da cota do mês, e a compra de crédito fica em até {brl(FIRST_WEEK_CREDIT_BRL)}. Passou disso, o assistente entra no modo só humano até o 8º dia, quando tudo libera.
          </li>
          <li>
            <strong>Pagamento em atraso:</strong> se a cobrança falhar, a IA de todos os assistentes pausa até a fatura ser paga, e a sua equipe segue respondendo. A Stripe tenta cobrar de novo por até 2 semanas; sem pagamento, a assinatura é cancelada. Para assinar de novo, a fatura em aberto precisa ser paga antes.
          </li>
          <li>
            <strong>Sem tamanho ou sem pacote:</strong> quando um assistente fica sem tamanho (no dia 1º ou no fim da assinatura), o WhatsApp e o Instagram dele são desconectados, e ele não envia campanhas, lembretes nem modelos de mensagem. Sem o pacote Domínio próprio, o painel e o chat voltam ao domínio da {brand}. Nada é apagado: as conversas e a configuração ficam guardadas.
          </li>
          <li>
            <strong>Custos do WhatsApp:</strong> mensagens no WhatsApp podem ser cobradas pela Meta diretamente da empresa dona do número, conforme a tabela da Meta. Esses valores não fazem parte do plano da {brand}.
          </li>
        </ul>
      </Section>

      <Section title="4. Seu conteúdo e os dados dos seus clientes">
        <p>
          O conteúdo que você envia (sites, documentos, textos, logos) continua sendo seu. Você nos dá permissão para processá-lo apenas para operar os seus assistentes. Você garante que tem direito de usar esse conteúdo e de tratar os dados pessoais envolvidos.
        </p>
        <ul>
          <li>
            Nos dados de quem conversa com os assistentes, o negócio atendido é o <strong>controlador</strong>, a agência é <strong>operadora</strong> e a {brand} é <strong>suboperadora</strong> (ou operadora, quando o negócio usa a {brand} diretamente), conforme a <Link href="/privacidade">Política de Privacidade</Link>. A agência repassa estas regras aos seus clientes.
          </li>
          <li>Os dados de cada cliente só servem ao atendimento dele: sem marketing próprio da agência nem cruzamento entre clientes.</li>
          <li>Cada cliente define por quanto tempo os dados ficam guardados (6, 12 ou 24 meses, ou menos no modo dados sensíveis) e pode exportar as conversas, os contatos e os leads a qualquer momento; na saída de um cliente, entregue ou apague os dados dele.</li>
          <li>Os pedidos de exclusão feitos pelos contatos no chat chegam em Segurança e devem ser atendidos no prazo da lei.</li>
          <li>Nossa equipe de suporte só lê conversas com a sua autorização, dada em Segurança por 24 horas e com motivo; cada leitura fica registrada.</li>
          <li>
            Como o negócio é o controlador, ele pode pedir à {brand} para levar o cliente dele, com os chatbots, as conversas, os contatos e a base, para outra conta (outra agência ou a conta do próprio negócio), também quando a agência não responde. A {brand} faz a mudança a pedido do negócio e avisa as duas contas. Um chatbot criado de um modelo da sua conta vai como chatbot comum, com uma cópia da configuração do modelo que ele usava (personalidade, instruções, roteiros e a base comum); as ações vão desligadas e sem os segredos. A auditoria, o uso já contado e a cobrança até a mudança ficam com a sua conta.
          </li>
        </ul>
      </Section>

      <Section title="5. Uso do WhatsApp">
        <ul>
          <li>Para conectar um número, a empresa precisa aceitar os Termos do WhatsApp Business e seguir a Política Comercial e a Política de Mensagens do WhatsApp Business.</li>
          <li>Antes de conectar o WhatsApp ou o Instagram, o próprio negócio aceita os termos do canal e a <Link href="/uso-aceitavel">Política de Uso Aceitável</Link>, que faz parte destes termos.</li>
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
          <li>tentar invadir, sobrecarregar ou copiar a plataforma, ou contornar os limites da conta grátis, das demos ou dos tamanhos (por exemplo, criando contas para repetir o teste, ou assinando, usando e desistindo de novo e de novo).</li>
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
