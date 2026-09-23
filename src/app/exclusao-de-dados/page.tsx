import Link from "next/link";
import { LegalPage, Section } from "@/components/legal-page";
import { company } from "@/lib/company";

export const metadata = { title: "Exclusão de dados" };

/**
 * "Data deletion instructions URL" do app na Meta: precisa ser pública e explicar como
 * a pessoa pede a exclusão dos dados recebidos pelos produtos da Meta.
 */
export default function DataDeletionPage() {
  const { brand, email } = company;
  const subject = encodeURIComponent("Exclusão de dados");
  return (
    <LegalPage title="Exclusão de dados" intro={`Como pedir que a ${brand} apague os seus dados pessoais, inclusive os recebidos pelo WhatsApp, pelo Instagram e por outros produtos da Meta.`}>
      <Section title="Se você tem uma conta na plataforma">
        <ul>
          <li><strong>Conversas e contatos:</strong> apague uma conversa específica pelo painel, ou apague tudo de um cliente em Clientes, na opção de exclusão LGPD.</li>
          <li><strong>WhatsApp:</strong> desconecte o número no painel do assistente ou remova o acesso da {brand} nas configurações da sua conta Meta (Configurações do negócio › Integrações). O token de acesso é apagado e deixamos de receber mensagens.</li>
          <li><strong>Instagram:</strong> desconecte a conta no painel do assistente ou remova o acesso nas configurações do Instagram (Configurações › Apps e sites). O token de acesso é apagado e deixamos de receber as mensagens diretas.</li>
          <li><strong>Conta inteira:</strong> envie o pedido pelo e-mail abaixo, a partir do e-mail cadastrado. Apagamos a conta, os assistentes, as conversas e os contatos.</li>
        </ul>
      </Section>

      <Section title="Se você conversou com um assistente">
        <p>
          Os assistentes pertencem às empresas que os usam, e elas decidem sobre os dados das conversas. O caminho mais rápido é pedir a exclusão à empresa com quem você falou. Você também pode escrever para nós informando:
        </p>
        <ul>
          <li>o número de telefone ou o e-mail usado na conversa;</li>
          <li>o nome da empresa ou o site onde conversou;</li>
          <li>a data aproximada da conversa.</li>
        </ul>
        <p>Localizamos os registros e os apagamos junto com a empresa responsável.</p>
      </Section>

      <Section title="Como pedir">
        <p>
          Envie um e-mail para <a href={`mailto:${email}?subject=${subject}`}>{email}</a> com o assunto &quot;Exclusão de dados&quot;. Confirmamos o recebimento e concluímos a exclusão em até 15 dias. Podemos pedir uma confirmação simples de identidade para evitar exclusões indevidas.
        </p>
      </Section>

      <Section title="O que pode ser mantido">
        <p>
          Guardamos apenas o que a lei exige, como registros fiscais de pagamento e registros de acesso pelo prazo do Marco Civil da Internet, e depois apagamos também. Detalhes na <Link href="/privacidade">Política de Privacidade</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
