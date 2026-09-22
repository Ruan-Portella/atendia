import Link from "next/link";
import { InactiveLink } from "@/components/inactive-link";

export const metadata = { title: { absolute: "Não encontrado" }, robots: { index: false } };

/** Na área do cliente: neutro (white-label), volta para a lista do próprio cliente. */
export default function MemberNotFound() {
  return (
    <div className="flex flex-1 flex-col">
      <InactiveLink title="Não encontramos isso" text="Pode ter sido removido, ou o seu acesso a esta parte foi alterado pela agência." />
      <Link href="/cliente" className="btn-primary mx-auto -mt-8 mb-12">Voltar para a área do cliente</Link>
    </div>
  );
}
