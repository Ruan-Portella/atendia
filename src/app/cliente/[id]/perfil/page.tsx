import { memberAttendant, requireMember, PORTAL_ROLE_LABELS } from "@/lib/member";
import { DEFAULT_ENTRY_NOTICE } from "@/lib/handoff-hours";
import { isOurAvatarUrl } from "@/lib/attendants";
import { ProfileForm } from "@/components/profile-form";
import { MfaSection } from "@/app/painel/(configuracoes)/seguranca/mfa-section";
import { memberPushPrefs, memberPushRemove, memberPushSubscribe, memberPushTest, memberPushUnsubscribe, memberSetAvailability, memberSetSignature, memberUpdateProfile, recordMemberMfaRemoved } from "../../actions";
import { PushCard } from "@/components/push-card";
import { CLIENT_PUSH_KINDS, PUSH_KIND_LABEL, listPushDevices, pushConfigured, pushPrefs, vapidPublicKey } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";
import { SIGNATURE_FORMATS, SIGNATURE_LABEL, isSignatureFormat } from "@/lib/signature";
import { Bell, Headset, Palette, PenLine, UserRound } from "lucide-react";
import { AutoSwitch, SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { initials } from "@/lib/utils";
import { ThemeChoice } from "@/components/theme";

export const metadata = { title: { absolute: "Meu perfil" }, robots: { index: false, follow: false } };

/**
 * Meu perfil no portal (leva B1'): nome de exibição e foto (o contato vê quando a pessoa atende)
 * e o segundo fator, pedido nas conversas em modo dados sensíveis e ao confirmar pedidos do titular.
 */
export default async function MemberProfilePage({ params }: PageProps<"/cliente/[id]/perfil">) {
  const { id } = await params;
  const { email, member } = await requireMember(id);
  const verify = `/cliente/${id}/verificar?next=${encodeURIComponent(`/cliente/${id}/perfil`)}`;
  const me = memberAttendant(member, email);
  const avatar = isOurAvatarUrl(member.avatarUrl) ? member.avatarUrl : null;
  const signature = isSignatureFormat(member.signature) ? member.signature : null;
  // redesenho (23/10/2026), no molde do Meu perfil do painel: o cabeçalho com a foto e os ajustes em linhas
  return (
    <>
      <div className="flex items-center gap-4">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover shadow-[inset_0_0_0_1px_var(--color-line)]" />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-raised text-lg font-semibold text-ink">{initials(me.name)}</span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-normal">{me.name}</h1>
          <p className="truncate text-sm text-muted">
            {email} · {PORTAL_ROLE_LABELS[member.role]} em {member.clientName}
          </p>
        </div>
      </div>

      <SettingGroup title="Como os contatos te veem">
        <SettingRow icon={<UserRound size={18} />} title="Nome e foto" summary={`${me.name}${avatar ? " · com foto" : " · sem foto"}`} description="O que o contato vê quando você atende." size="lg" footer="close">
          <ProfileForm action={memberUpdateProfile.bind(null, id)} folder={member.memberId} name={me.name} avatar={avatar} entryExample={DEFAULT_ENTRY_NOTICE} company={member.clientName} />
        </SettingRow>
        {member.allowHandoff && (
          <>
            <SettingRow icon={<PenLine size={18} />} title="Minha assinatura" summary={signature ? SIGNATURE_LABEL[signature] : "O do assistente"} description="Como o seu nome aparece nas suas mensagens pelo WhatsApp e pelo Instagram." action={memberSetSignature.bind(null, id)}>
              <fieldset className="flex flex-col gap-2">
                <legend className="label">Formato</legend>
                {[["chatbot", "O do assistente"] as const, ...SIGNATURE_FORMATS.map((f) => [f, SIGNATURE_LABEL[f]] as const)].map(([v, l]) => (
                  <label key={v} className="flex cursor-pointer items-center gap-2.5 rounded-[12px] border border-line px-3 py-2.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/60">
                    <input type="radio" name="signature" value={v} defaultChecked={(signature ?? "chatbot") === v} className="accent-brand" />
                    {l}
                  </label>
                ))}
              </fieldset>
            </SettingRow>
            <SettingRow
              icon={<Headset size={18} />}
              title="Disponível para atender"
              summary={member.available ? "Nos setores com rodízio, as conversas vêm para você enquanto a página estiver aberta" : "Ausente: o rodízio dos setores pula você"}
              trailing={<AutoSwitch checked={member.available} action={memberSetAvailability.bind(null, id, true)} offAction={memberSetAvailability.bind(null, id, false)} label="Disponível para atender" />}
            />
          </>
        )}
      </SettingGroup>

      <SettingGroup title="Preferências">
        <SettingRow icon={<Palette size={18} />} title="Tema" summary="Escuro, claro ou o do aparelho: vale para este navegador" footer="close">
          <ThemeChoice />
        </SettingRow>
        {member.allowHandoff && pushConfigured() && (
          <SettingRow icon={<Bell size={18} />} title="Avisos no celular e no navegador" summary="Os aparelhos que recebem os avisos e o que cada um recebe" size="lg" footer="close">
            <PushCard
              publicKey={vapidPublicKey()!}
              devices={await listPushDevices(createAdminClient(), { type: "client_member", id: member.memberId })}
              kinds={CLIENT_PUSH_KINDS.map((k) => ({ kind: k, label: PUSH_KIND_LABEL[k] }))}
              prefs={await pushPrefs(createAdminClient(), { type: "client_member", id: member.memberId })}
              subscribe={memberPushSubscribe.bind(null, id)}
              unsubscribe={memberPushUnsubscribe.bind(null, id)}
              remove={memberPushRemove.bind(null, id)}
              savePrefs={memberPushPrefs.bind(null, id)}
              test={memberPushTest.bind(null, id)}
            />
          </SettingRow>
        )}
      </SettingGroup>

      <section className="flex flex-col gap-2">
        <h3 className="kpi-label px-1">Segundo fator</h3>
        <MfaSection
          bare
          onRemoved={recordMemberMfaRemoved.bind(null, id)}
          verifyHref={verify}
          enrollHref={verify}
          text="Código do app autenticador (Google Authenticator, Authy, 1Password…), pedido uma vez por sessão nas conversas de assistente em modo dados sensíveis e para confirmar pedidos de exclusão de dados."
        />
      </section>
    </>
  );
}
