import { DocPage, H2, NextSteps, Note } from "@/components/docs/doc";

export const metadata = { title: "Guia para agências" };

/** Guia rápido do perfil agência (Entrada e docs, parte 2): do cadastro ao chat no site do cliente, com a marca da agência. */
export default function AgencyGuide() {
  return (
    <DocPage eyebrow="Documentação · Guias rápidos" title="Guia para agências" intro="Do cadastro ao assistente atendendo no site e no WhatsApp do seu cliente, com a sua marca. O cliente nunca vê o BoaVoz.">
      <H2 id="conta">1. Crie a conta</H2>
      <p>
        Crie a conta grátis e, no primeiro acesso, escolha <strong>Para os clientes da minha agência</strong>. A conta grátis tem 50 respostas de teste da IA para montar, testar e mostrar demos; o chat no site, o WhatsApp e o Instagram ligam quando o chatbot ganha um tamanho.
      </p>

      <H2 id="chatbot">2. Monte o chatbot do cliente</H2>
      <ol>
        <li>
          Em <strong>Clientes</strong>, cadastre o cliente e crie um chatbot para ele.
        </li>
        <li>
          Na <strong>Base de conhecimento</strong>, cole o site do cliente, envie PDFs e planilhas CSV ou escreva as perguntas frequentes. É daí que saem as respostas.
        </li>
        <li>
          Na <strong>Personalidade</strong>, dê o nome do assistente, o tom e as instruções, e converse com ele no <strong>teste ao vivo</strong>.
        </li>
        <li>
          Quando estiver bom, clique em <strong>Publicar</strong>.
        </li>
      </ol>

      <H2 id="demo">3. Mostre para o cliente</H2>
      <p>
        Em <strong>Demos</strong>, gere uma página de demonstração com o site do prospect: ele conversa com o assistente treinado no site dele antes de fechar. A demo sai com a sua marca.
      </p>

      <H2 id="canais">4. Ligue os canais</H2>
      <ul>
        <li>
          <strong>Site:</strong> na aba <strong>Instalação</strong>, uma linha de código (com passo a passo para WordPress, Wix, Shopify e outros).
        </li>
        <li>
          <strong>WhatsApp e Instagram:</strong> mande o link de conexão para o cliente. Ele entra com a conta da Meta dele, e o número fica no portfólio do negócio.
        </li>
      </ul>
      <p>Para ligar os canais, escolha o tamanho do chatbot em Cobrança (a cota de atendimentos do mês).</p>

      <H2 id="marca">5. Coloque a sua marca e dê acesso ao cliente</H2>
      <ul>
        <li>
          Em <strong>Marca e domínio</strong>, envie o logo e escolha a cor; com o pacote Domínio próprio, as demos, o portal e o chat usam o seu endereço.
        </li>
        <li>
          Na página do cliente, ligue o <strong>portal</strong> (o relatório do mês) e dê acesso à <strong>área do cliente</strong>, onde a equipe dele vê as conversas e responde.
        </li>
        <li>
          Em <strong>Equipe</strong>, convide quem atende e quem configura, cada um com o papel e os clientes dele.
        </li>
      </ul>
      <Note>Os avisos da conta (atendimento urgente, lead novo e cobrança) podem chegar no seu WhatsApp: ponha o número no primeiro acesso ou em Meu perfil.</Note>

      <NextSteps
        items={[
          { href: "/docs/acoes", title: "Ações", text: "A IA consulta o sistema do cliente na conversa (pacote Integrações)." },
          { href: "/docs/roteiros", title: "Roteiros", text: "Passos que a IA segue: segunda via, suporte, agendamento." },
        ]}
      />
    </DocPage>
  );
}
