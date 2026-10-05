import { memberAttendant, requireMember, PORTAL_ROLE_LABELS } from "@/lib/member";
import { DEFAULT_ENTRY_NOTICE } from "@/lib/handoff-hours";
import { isOurAvatarUrl } from "@/lib/attendants";
import { ProfileForm } from "@/components/profile-form";
import { MfaSection } from "@/app/painel/seguranca/mfa-section";
import { memberUpdateProfile, recordMemberMfaRemoved } from "../../actions";

export const metadata = { title: { absolute: "Meu perfil" }, robots: { index: false, follow: false } };

/**
 * Meu perfil no portal (leva B1'): nome de exibição e foto (o contato vê quando a pessoa atende)
 * e o segundo fator, pedido nas conversas em modo dados sensíveis e ao confirmar pedidos do titular.
 */
export default async function MemberProfilePage({ params }: PageProps<"/cliente/[id]/perfil">) {
  const { id } = await params;
  const { email, member } = await requireMember(id);
  const verify = `/cliente/${id}/verificar?next=${encodeURIComponent(`/cliente/${id}/perfil`)}`;
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Meu perfil</h1>
        <p className="text-sm text-muted">{email} · {PORTAL_ROLE_LABELS[member.role]} em {member.clientName}</p>
      </div>
      <ProfileForm
        action={memberUpdateProfile.bind(null, id)}
        folder={member.memberId}
        name={memberAttendant(member, email).name}
        avatar={isOurAvatarUrl(member.avatarUrl) ? member.avatarUrl : null}
        entryExample={DEFAULT_ENTRY_NOTICE}
        company={member.clientName}
      />
      <MfaSection
        onRemoved={recordMemberMfaRemoved.bind(null, id)}
        verifyHref={verify}
        enrollHref={verify}
        text="Código do app autenticador (Google Authenticator, Authy, 1Password…), pedido uma vez por sessão nas conversas de assistente em modo dados sensíveis e para confirmar pedidos de exclusão de dados."
      />
    </>
  );
}
