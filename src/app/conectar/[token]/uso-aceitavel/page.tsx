import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { NEUTRAL_ICONS } from "@/lib/white-label";
import { resolveConnectLink } from "@/lib/whatsapp-connect-link";
import { AcceptableUsePolicy } from "@/components/acceptable-use-policy";
import { AgencyHeader } from "@/components/report-view";

// só a marca da agência, como o link de conexão (a plataforma não aparece)
export const metadata = { title: { absolute: "Política de Uso Aceitável" }, robots: { index: false, follow: false }, icons: NEUTRAL_ICONS };

/** A Política de Uso Aceitável aceita no link de conexão (vale também depois do link usado ou vencido: é a cópia do aceite). */
export default async function LinkPolicyPage({ params }: PageProps<"/conectar/[token]/uso-aceitavel">) {
  const { token } = await params;
  const link = await resolveConnectLink(createAdminClient(), token);
  if (!link) notFound();
  return (
    <div className="min-h-full bg-ground">
      <AgencyHeader agency={link.agency} />
      <main className="mx-auto flex max-w-[760px] flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-bold sm:text-[28px]">Política de Uso Aceitável</h1>
        <AcceptableUsePolicy brand="plataforma" contact={<>por meio de {link.agency.name}</>} />
      </main>
    </div>
  );
}
