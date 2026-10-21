import { redirect } from "next/navigation";
import { memberHasMfa, requireMember } from "@/lib/member";
import { createClient } from "@/lib/supabase/server";
import { openRecoveryOf } from "@/lib/mfa-recovery";
import { MfaRecoveryRequest } from "@/components/mfa-recovery-request";
import { requestMemberMfaRecovery } from "../../../actions";

export const metadata = { title: { absolute: "Perdi o app autenticador" }, robots: { index: false, follow: false } };

/** Recuperação do segundo fator na área do cliente (white-label: quem remove é "a equipe da agência"). */
export default async function MemberMfaRecoveryPage({ params }: PageProps<"/cliente/[id]/verificar/recuperar">) {
  const { id } = await params;
  const { email, member, admin } = await requireMember(id);
  if (await memberHasMfa()) redirect(`/cliente/${id}`);
  const { data } = await (await createClient()).auth.getClaims();
  const open = data?.claims?.sub ? await openRecoveryOf(admin, String(data.claims.sub)) : null;
  return (
    <div className="flex justify-center py-6">
      <MfaRecoveryRequest email={email} open={open} action={requestMemberMfaRecovery.bind(null, id)} backHref={`/cliente/${id}/verificar`} support={`a equipe de ${member.agency.name}`} notified={member.agency.name} />
    </div>
  );
}
