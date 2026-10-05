import Link from "next/link";
import { LegalPage, Section } from "@/components/legal-page";
import { company } from "@/lib/company";

export const metadata = { title: "Exclusão de dados" };

/**
 * "Data deletion instructions URL" do app na Meta: precisa ser pública e explicar como
 * a pessoa pede a exclusão dos dados recebidos pelos produtos da Meta. Leva S: pedido pelo
 * próprio chat, a rotina única de exclusão e a lista de supressão.
 */
export default function DataDeletionPage() {
  const { brand, email } = company;
  const subject = encodeURIComponent("Exclusão de dados");
  return (
    <LegalPage title="Exclusão de dados" updatedAt="5 de outubro de 2026" intro={`Como pedir que a ${brand} apague os seus dados pessoais, inclusive os recebidos pelo WhatsApp, pelo Instagram e por outros produtos da Meta.`}>
      <Section title="Se você conversou com um assistente">
        <p>
          Os assistentes pertencem às empresas que os usam, e elas decidem sobre os dados das conversas. Você pode pedir a exclusão de três jeitos:
        </p>
        <ul>
          <li>
            <strong>No próprio chat:</strong> escreva &quot;apaga meus dados&quot; na conversa (no site, no WhatsApp ou no Instagram) e confirme. O pedido vai para a empresa responsável e é concluído em até 15 dias. No WhatsApp e no Instagram, você recebe a confirmação por ali quando a conversa ainda estiver aberta (até 24 horas depois da sua última mensagem).
          </li>
          <li><strong>Com a empresa</strong> com quem você falou.</li>
          <li>
            <strong>Por e-mail</strong>, para nós, informando o número de telefone ou o e-mail usado na conversa, o nome da empresa ou o site onde conversou e a data aproximada. Localizamos os registros e os apagamos junto com a empresa responsável.
          </li>
        </ul>
      </Section>

      <Section title="O que é apagado">
        <ul>
          <li>As suas conversas com aquele assistente, com as mensagens e os arquivos que você enviou.</li>
          <li>A sua ficha de contato, os contatos que você deixou (leads), as perguntas registradas e a sua resposta à pergunta de maioridade.</li>
          <li>Os registros técnicos das integrações do assistente ligados a você. Quando a empresa conectou os próprios sistemas, ela recebe um aviso automático para apagar as cópias dela.</li>
        </ul>
        <p>
          Depois disso, o seu número entra na lista de supressão: a empresa não envia mais mensagens iniciadas por ela para você por aquele canal. A lista guarda só um código do número (hash), o canal e a data, por 5 anos, como prova. Se você escrever de novo, a conversa começa do zero.
        </p>
      </Section>

      <Section title="Se você tem uma conta na plataforma">
        <ul>
          <li>
            <strong>Conversas e contatos:</strong> apague uma conversa pelo painel; apague os dados de um contato pelo e-mail ou telefone em Clientes, na aba Leads; e confirme em Segurança os pedidos que os contatos fizeram pelo chat.
          </li>
          <li><strong>Dados de um cliente:</strong> ao excluir um cliente, a chave de criptografia dele é apagada, e o que ela protegia fica ilegível. Antes, você pode exportar as conversas, os contatos e os leads dele.</li>
          <li><strong>WhatsApp:</strong> desconecte o número no painel do assistente ou remova o acesso da {brand} nas configurações da sua conta Meta (Configurações do negócio › Integrações). O token de acesso é apagado e deixamos de receber mensagens.</li>
          <li><strong>Instagram:</strong> desconecte a conta no painel do assistente ou remova o acesso nas configurações do Instagram (Configurações › Apps e sites). O token de acesso é apagado e deixamos de receber as mensagens diretas.</li>
          <li><strong>Conta inteira:</strong> envie o pedido pelo e-mail abaixo, a partir do e-mail cadastrado. Apagamos a conta, os assistentes, as conversas e os contatos.</li>
        </ul>
      </Section>

      <Section title="Como pedir por e-mail">
        <p>
          Envie um e-mail para <a href={`mailto:${email}?subject=${subject}`}>{email}</a> com o assunto &quot;Exclusão de dados&quot;. Confirmamos o recebimento e concluímos a exclusão em até 15 dias. Podemos pedir uma confirmação simples de identidade para evitar exclusões indevidas.
        </p>
      </Section>

      <Section title="O que pode ser mantido">
        <p>
          Guardamos apenas o que a lei exige ou o que prova o atendimento: registros fiscais de pagamento; registros de acesso (IP, data e hora) pelos 6 meses do Marco Civil da Internet, inclusive os do chat do site, sob sigilo; a lista de supressão, por 5 anos e só com o código do número; a auditoria da conta, sem conteúdo de conversas, por 1 ano; e o registro do pedido de exclusão, sem os seus dados. Detalhes na <Link href="/privacidade">Política de Privacidade</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
