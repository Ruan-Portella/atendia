import { AvailabilityCard } from "@/components/availability-card";
import { SignatureCard } from "@/components/signature-card";
import { isSignatureFormat } from "@/lib/signature";
import { requireAgency } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ROLE_HINTS, ROLE_LABELS, attendantOf, scopesOf } from "@/lib/team";
import { DEFAULT_ENTRY_NOTICE } from "@/lib/handoff-hours";
import { isOurAvatarUrl } from "@/lib/attendants";
import { ProfileForm } from "@/components/profile-form";
import { MfaSection } from "@/app/painel/(configuracoes)/seguranca/mfa-section";
import { ThemeChoice } from "@/components/theme";
import { TeamWhatsAppCard } from "@/components/team-whatsapp-card";
import { noticeStatus } from "@/lib/team-whatsapp";
import { PushCard } from "@/components/push-card";
import { PUSH_KIND_LABEL, agencyPushKinds, listPushDevices, pushConfigured, pushPrefs, vapidPublicKey } from "@/lib/push";
import { removeMyPushDevice, requestEmailChange, saveMyPushPrefs, setMyAvailability, setMySignature, subscribeMyPush, testMyPush, unsubscribeMyPush, updateMyProfile } from "./actions";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata = { title: "Meu perfil" };

/**
 * Meu perfil (leva B1'): nome de exibição e foto (o que o contato vê quando você atende), quem é
 * você na equipe (papel e escopo) e o seu segundo fator, que todo papel usa ao abrir conversa de
 * chatbot em modo dados sensíveis.
 */
export default async function ProfilePage({ searchParams }: PageProps<"/painel/perfil">) {
  const { agency, member, role, email } = await requireAgency();
  const sp = await searchParams;
  // trocar o e-mail: quem tem o app autenticador troca só com o código feito nesta sessão
  const { data: aal } = await (await createClient()).auth.mfa.getAuthenticatorAssuranceLevel();
  const emailNeedsMfa = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2";
  // um cliente que a pessoa atende, só para a prévia do anúncio
  const { data: sample } = await (await createClient()).from("clients").select("name").order("name").limit(1).maybeSingle();
  let scope = "Todos os clientes da agência";
  if (member.scope === "selected") {
    const s = (await scopesOf(createAdminClient(), [member.id])).get(member.id) ?? { clientIds: [], botIds: [] };
    // nomes pela sessão: só o que a pessoa enxerga
    const supabase = await createClient();
    const [{ data: clients }, { data: bots }] = await Promise.all([
      s.clientIds.length ? supabase.from("clients").select("name").in("id", s.clientIds) : Promise.resolve({ data: [] }),
      s.botIds.length ? supabase.from("bots").select("name, client_name").in("id", s.botIds) : Promise.resolve({ data: [] }),
    ]);
    const names = [...(clients ?? []).map((c) => String(c.name)), ...(bots ?? []).map((b) => `${b.name} (${b.client_name})`)];
    scope = names.length ? names.join(", ") : "Nenhum cliente ainda";
  }
  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-normal sm:text-[28px]">Meu perfil</h1>
        <p className="text-sm text-muted">Como você aparece para os contatos e como entra no painel de {agency.name}.</p>
      </div>
      <ProfileForm
        action={updateMyProfile}
        folder={member.id}
        name={attendantOf(member).name}
        avatar={isOurAvatarUrl(member.avatar_url) ? member.avatar_url : null}
        entryExample={DEFAULT_ENTRY_NOTICE}
        company={(sample?.name as string | undefined) ?? "sua empresa cliente"}
      />
      <section className="card flex flex-col gap-3 p-5">
        <div>
          <h2 className="text-base font-medium">Aparência</h2>
          <p className="text-sm text-muted">O tema vale para este navegador. O escuro é o padrão.</p>
        </div>
        <ThemeChoice className="max-w-[420px]" />
      </section>
      <section className="card flex flex-col gap-3 p-6 text-sm">
        <div className="grid gap-1 sm:grid-cols-[140px_1fr]">
          <span className="text-muted">E-mail</span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="font-semibold">{email}</span>
            {sp.email === "trocado" && <span className="text-xs text-brand">E-mail confirmado. Daqui em diante, entre com ele.</span>}
            <details className="text-xs">
              <summary className="cursor-pointer text-muted hover:text-ink">Trocar o e-mail de acesso</summary>
              {emailNeedsMfa ? (
                <p className="mt-2 text-muted">
                  Você tem o app autenticador: para trocar o e-mail, <a href={`/painel/verificar?next=${encodeURIComponent("/painel/perfil")}`} className="font-semibold text-brand hover:underline">faça a verificação</a> antes.
                </p>
              ) : (
                <ActionForm action={requestEmailChange} className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input name="email" type="email" required autoComplete="email" placeholder="novo@empresa.com.br" className="input" />
                  <SubmitButton className="btn-ghost shrink-0" pendingLabel="Enviando…">Pedir a troca</SubmitButton>
                </ActionForm>
              )}
              <p className="mt-1.5 text-muted">A troca vale depois do link de confirmação (no e-mail novo e, se pedir, no atual). O dono da agência é avisado.</p>
            </details>
          </div>
        </div>
        <div className="grid gap-1 sm:grid-cols-[140px_1fr]">
          <span className="text-muted">Papel</span>
          <span><span className="font-semibold">{ROLE_LABELS[role]}</span>{role !== "owner" && <span className="block text-xs text-muted">{ROLE_HINTS[role]}</span>}</span>
        </div>
        <div className="grid gap-1 sm:grid-cols-[140px_1fr]"><span className="text-muted">Escopo</span><span>{scope}</span></div>
        {role !== "owner" && <p className="text-xs text-muted">Para mudar o papel ou o escopo, fale com o dono ou um administrador da agência.</p>}
      </section>
      <AvailabilityCard available={member.available !== false} action={setMyAvailability} />
      <SignatureCard value={isSignatureFormat(member.signature) ? member.signature : null} action={setMySignature} />
      <TeamWhatsAppCard status={await noticeStatus(createAdminClient(), member.id)} role={role} />
      {pushConfigured() && (
        <PushCard
          publicKey={vapidPublicKey()!}
          devices={await listPushDevices(createAdminClient(), { type: "agency_member", id: member.id })}
          kinds={agencyPushKinds(role).map((k) => ({ kind: k, label: PUSH_KIND_LABEL[k] }))}
          prefs={await pushPrefs(createAdminClient(), { type: "agency_member", id: member.id })}
          subscribe={subscribeMyPush}
          unsubscribe={unsubscribeMyPush}
          remove={removeMyPushDevice}
          savePrefs={saveMyPushPrefs}
          test={testMyPush}
        />
      )}
      <MfaSection enrollHref={`/painel/verificar?next=${encodeURIComponent("/painel/perfil")}`} />
    </div>
  );
}
