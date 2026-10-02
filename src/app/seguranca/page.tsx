import { LegalPage, Section } from "@/components/legal-page";
import { company, companyIdentity } from "@/lib/company";
import { securityEmail } from "@/lib/security-contact";

export const metadata = { title: "Segurança" };

/** Canal de vulnerabilidades: como reportar uma falha de segurança (e o que prometemos em troca). */
export default function SecurityPage() {
  const email = securityEmail();
  const operator = companyIdentity();
  return (
    <LegalPage title="Segurança" updatedAt="2 de outubro de 2026" intro={`Encontrou uma falha de segurança na ${company.brand}? Conte para a gente antes de divulgar: a gente corrige e avisa você.`}>
      <Section title="Como reportar">
        <p>
          Escreva para <a href={`mailto:${email}?subject=Falha%20de%20seguran%C3%A7a`}>{email}</a> com o assunto &ldquo;Falha de segurança&rdquo;. Conte o que encontrou, onde (endereço da página ou da API), o passo a passo para reproduzir e o impacto que você imagina. Prints e vídeos ajudam.
        </p>
      </Section>
      <Section title="O que prometemos">
        <ul>
          <li>Confirmar o recebimento em até 3 dias úteis.</li>
          <li>Avaliar com prioridade e manter você informado até a correção.</li>
          <li>Não tomar medida legal contra quem pesquisar de boa-fé e seguir as regras abaixo.</li>
          <li>Dar o crédito pela descoberta, se você quiser. Ainda não temos programa de recompensa.</li>
        </ul>
      </Section>
      <Section title="Regras para pesquisar">
        <ul>
          <li>Use só contas e dados seus. Não acesse, altere nem apague dados de outras pessoas; se esbarrar em um, pare e conte para a gente.</li>
          <li>Nada de ataque de negação de serviço, spam, engenharia social com a nossa equipe ou com clientes, nem testes no WhatsApp ou no Instagram de clientes.</li>
          <li>Não divulgue a falha até ela ser corrigida (combinamos a data com você).</li>
        </ul>
      </Section>
      <Section title="Incidentes">
        <p>
          Se um incidente de segurança afetar dados pessoais, avisamos as agências e as empresas atendidas envolvidas e, quando a lei exige, a Autoridade Nacional de Proteção de Dados (ANPD) e as pessoas afetadas.{operator ? ` Responsável: ${operator}.` : ""}
        </p>
      </Section>
    </LegalPage>
  );
}
