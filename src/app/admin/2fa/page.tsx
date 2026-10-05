import { notFound, redirect } from "next/navigation";
import { adminSession } from "@/lib/platform-admin";
import { MfaForm } from "@/components/mfa-form";
import { recordMfaResult } from "./actions";

export const metadata = { title: "Verificação · Backoffice" };

/** Segunda etapa do backoffice (fora do layout protegido, que exige a etapa feita). */
export default async function AdminMfaPage() {
  const s = await adminSession();
  if (!s) notFound();
  if (s.mfa) redirect("/admin");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground px-4 py-10">
      <div className="card flex w-full max-w-[400px] flex-col gap-4 p-6">
        <div>
          <p className="eyebrow">Backoffice BoaVoz</p>
          <h1 className="text-xl font-bold">Verificação em duas etapas</h1>
        </div>
        <MfaForm friendlyName="Backoffice BoaVoz" next="/admin" submitLabel="Entrar no backoffice" onResult={recordMfaResult} />
      </div>
    </main>
  );
}
