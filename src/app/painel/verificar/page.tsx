import { redirect } from "next/navigation";
import { requireAgency } from "@/lib/agency";
import { hasMfa, safeMfaNext } from "@/lib/agency-mfa";
import { MfaForm } from "@/components/mfa-form";
import { recordAgencyMfa } from "../actions";

export const metadata = { title: "Verificação em duas etapas" };

/**
 * Segundo fator da agência: exigido em Segurança, nas exportações e nas conversas em modo dados
 * sensíveis. Na primeira vez, cadastra o app autenticador aqui mesmo.
 */
export default async function AgencyVerifyPage({ searchParams }: PageProps<"/painel/verificar">) {
  await requireAgency();
  const sp = await searchParams;
  const next = safeMfaNext(typeof sp.next === "string" ? sp.next : null);
  if (await hasMfa()) redirect(next);
  return (
    <div className="flex justify-center py-6">
      <div className="card flex w-full max-w-[420px] flex-col gap-4 p-6">
        <div>
          <h1 className="text-xl font-bold">Verificação em duas etapas</h1>
          <p className="text-sm text-muted">Esta área pede o código do app autenticador (Segurança, exportação de dados e conversas em modo dados sensíveis). O resto do painel continua sem o código.</p>
        </div>
        <MfaForm friendlyName="Painel BoaVoz" next={next} submitLabel="Continuar" onResult={recordAgencyMfa} />
      </div>
    </div>
  );
}
