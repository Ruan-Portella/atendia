import { LegalPage } from "@/components/legal-page";
import { AcceptableUsePolicy } from "@/components/acceptable-use-policy";
import { company } from "@/lib/company";

export const metadata = { title: "Política de Uso Aceitável" };

/** Aceita na tela única de aceite, antes da primeira conexão do WhatsApp ou do Instagram. */
export default function AcceptableUsePage() {
  return (
    <LegalPage title="Política de Uso Aceitável" updatedAt="2 de outubro de 2026" intro={`O que pode e o que não pode ser feito com a ${company.brand}, principalmente no WhatsApp e no Instagram.`}>
      <AcceptableUsePolicy brand={company.brand} contact={<>pelo <a href={`mailto:${company.email}`}>{company.email}</a></>} />
    </LegalPage>
  );
}
