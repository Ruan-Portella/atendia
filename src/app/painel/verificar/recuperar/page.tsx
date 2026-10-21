import { redirect } from "next/navigation";
import { requireAgency } from "@/lib/agency";
import { hasMfa } from "@/lib/agency-mfa";
import { createAdminClient } from "@/lib/supabase/admin";
import { openRecoveryOf } from "@/lib/mfa-recovery";
import { MfaRecoveryRequest } from "@/components/mfa-recovery-request";
import { requestAgencyMfaRecovery } from "../../actions";

export const metadata = { title: "Perdi o app autenticador" };

/** Recuperação do segundo fator pelo suporte (confirmação por e-mail e 48 horas de espera). */
export default async function AgencyMfaRecoveryPage() {
  const { userId, email, role } = await requireAgency();
  if (await hasMfa()) redirect("/painel/seguranca");
  const open = await openRecoveryOf(createAdminClient(), userId);
  return (
    <div className="flex justify-center py-6">
      <MfaRecoveryRequest email={email} open={open} action={requestAgencyMfaRecovery} backHref="/painel/verificar" support="o suporte do BoaVoz" notified={role === "owner" ? "Você, como dono da conta," : "O dono da agência"} />
    </div>
  );
}
