import { DocPage, H2, NextSteps, Note } from "@/components/docs/doc";

export const metadata = { title: "Guia para o seu negócio" };

/** Guia rápido do perfil negócio (Entrada e docs, parte 2): o assistente do próprio negócio no site e no WhatsApp. */
export default function BusinessGuide() {
  return (
    <DocPage eyebrow="Documentação · Guias rápidos" title="Guia para o seu negócio" intro="Um assistente que conhece o seu negócio e atende os seus clientes no site, no WhatsApp e no Instagram, e chama você quando precisa.">
      <H2 id="conta">1. Crie a conta</H2>
      <p>
        Crie a conta grátis e, no primeiro acesso, escolha <strong>Para o meu negócio</strong>. A conta grátis tem 50 respostas de teste da IA para montar e testar o assistente.
      </p>

      <H2 id="chatbot">2. Monte o seu assistente</H2>
      <ol>
        <li>
          Crie o chatbot: o cliente dele é o seu próprio negócio.
        </li>
        <li>
          Na <strong>Base de conhecimento</strong>, cole o endereço do seu site, envie o cardápio ou a tabela de preços em PDF, ou escreva as perguntas frequentes.
        </li>
        <li>
          Na <strong>Personalidade</strong>, dê um nome ao assistente e diga como ele fala. Converse com ele no <strong>teste ao vivo</strong> como se fosse um cliente.
        </li>
        <li>
          Quando estiver bom, clique em <strong>Publicar</strong>.
        </li>
      </ol>

      <H2 id="canais">3. Leve para o site e o WhatsApp</H2>
      <p>
        Escolha o tamanho do chatbot em Cobrança: ele define quantos atendimentos o assistente faz no mês. Depois, na página do chatbot:
      </p>
      <ul>
        <li>
          <strong>WhatsApp:</strong> conecte o número do negócio, inclusive o que você já usa no app do celular (ele continua funcionando no celular).
        </li>
        <li>
          <strong>Instagram:</strong> conecte a conta profissional para o assistente responder o direct.
        </li>
        <li>
          <strong>Site:</strong> na aba <strong>Instalação</strong>, cole uma linha de código.
        </li>
      </ul>

      <H2 id="equipe">4. Atenda junto com o assistente</H2>
      <p>
        Quando o cliente pede uma pessoa, ou o assunto pede, o assistente chama a sua equipe e a conversa aparece em <strong>Conversas</strong>. Os pedidos de orçamento e os contatos deixados viram <strong>leads</strong>.
      </p>
      <Note>Receba no seu WhatsApp os avisos de atendimento urgente, pedido de atendente e lead novo: ponha o número no primeiro acesso ou em Meu perfil.</Note>

      <NextSteps
        items={[
          { href: "/docs/campanhas", title: "Campanhas e consentimento", text: "Novidades e lembretes pelo WhatsApp, dentro das regras da Meta." },
          { href: "/docs/roteiros", title: "Roteiros", text: "Passos que a IA segue: agendamento, segunda via, suporte." },
        ]}
      />
    </DocPage>
  );
}
