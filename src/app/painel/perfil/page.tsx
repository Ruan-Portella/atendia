import { SIGNATURE_FORMATS, SIGNATURE_LABEL, isSignatureFormat } from "@/lib/signature";
import { Bell, Headset, Mail, MessageCircle, Palette, PenLine, ShieldCheck, UserRound, Users } from "lucide-react";
import { AutoSwitch, SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { StatusPill } from "@/components/ui/form-section";
import { initials } from "@/lib/utils";
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
  const me = attendantOf(member);
  const avatar = isOurAvatarUrl(member.avatar_url) ? member.avatar_url : null;
  const signature = isSignatureFormat(member.signature) ? member.signature : null;
  const available = member.available !== false;
  // redesenho (23/10/2026): o cabeçalho com a foto, o papel e o escopo; cada ajuste numa linha que abre um modal
  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <div className="flex items-center gap-4">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover shadow-[inset_0_0_0_1px_var(--color-line)]" />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-raised text-lg font-semibold text-ink">{initials(me.name)}</span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-normal sm:text-[28px]">{me.name}</h1>
          <p className="truncate text-sm text-muted">{email} · {agency.name}</p>
        </div>
      </div>
      {sp.email === "trocado" && <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">E-mail confirmado. Daqui em diante, entre com ele.</p>}

      <SettingGroup title="Como os contatos te veem">
        <SettingRow icon={<UserRound size={18} />} title="Nome e foto" summary={`${me.name}${avatar ? " · com foto" : " · sem foto"}`} description="O que o contato vê quando você atende, no anúncio de entrada e nas suas mensagens." size="lg" footer="close">
          <ProfileForm action={updateMyProfile} folder={member.id} name={me.name} avatar={avatar} entryExample={DEFAULT_ENTRY_NOTICE} company={(sample?.name as string | undefined) ?? "sua empresa cliente"} />
        </SettingRow>
        <SettingRow icon={<PenLine size={18} />} title="Minha assinatura" summary={signature ? SIGNATURE_LABEL[signature] : "O do chatbot"} description="Como o seu nome aparece nas suas mensagens pelo WhatsApp e pelo Instagram. Vale nos chatbots que não travam o formato; nos outros, vale o que o chatbot define." action={setMySignature}>
          <fieldset className="flex flex-col gap-2">
            <legend className="label">Formato</legend>
            {[["chatbot", "O do chatbot"] as const, ...SIGNATURE_FORMATS.map((f) => [f, SIGNATURE_LABEL[f]] as const)].map(([v, l]) => (
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
          summary={available ? "Nos setores com rodízio, as conversas vêm para você enquanto o painel estiver aberto" : "Ausente: o rodízio dos setores pula você (as conversas que já são suas continuam)"}
          trailing={<AutoSwitch checked={available} action={setMyAvailability.bind(null, true)} offAction={setMyAvailability.bind(null, false)} label="Disponível para atender" />}
        />
      </SettingGroup>

      <SettingGroup title="Conta">
        <SettingRow icon={<Mail size={18} />} title="E-mail de acesso" summary={email} description="A troca vale depois do link de confirmação (no e-mail novo e, se pedir, no atual). O dono da agência é avisado." action={emailNeedsMfa ? undefined : requestEmailChange} saveLabel="Pedir a troca" footer={emailNeedsMfa ? "close" : "save"}>
          {emailNeedsMfa ? (
            <p className="text-sm text-ink-2">
              Você tem o app autenticador: para trocar o e-mail,{" "}
              <a href={`/painel/verificar?next=${encodeURIComponent("/painel/perfil")}`} className="font-semibold text-brand hover:underline">
                faça a verificação
              </a>{" "}
              antes.
            </p>
          ) : (
            <div>
              <label htmlFor="new-email" className="label">
                E-mail novo
              </label>
              <input id="new-email" name="email" type="email" required autoComplete="email" placeholder="novo@empresa.com.br" className="input" />
            </div>
          )}
        </SettingRow>
        <SettingRow icon={<ShieldCheck size={18} />} title="Papel" badge={<StatusPill tone="ok">{ROLE_LABELS[role]}</StatusPill>} summary={role === "owner" ? "Você é o dono da conta" : `${ROLE_HINTS[role]} Para mudar, fale com o dono ou um administrador.`} />
        <SettingRow icon={<Users size={18} />} title="Escopo" summary={scope} />
        <SettingRow icon={<Palette size={18} />} title="Tema" summary="Escuro, claro ou o do aparelho: vale para este navegador" footer="close">
          <ThemeChoice />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Avisos">
        <SettingRow icon={<MessageCircle size={18} />} title="Avisos no WhatsApp" summary="Pedidos de atendente e alertas da conta pelo WhatsApp da equipe" size="lg" footer="close">
          <TeamWhatsAppCard status={await noticeStatus(createAdminClient(), member.id)} role={role} />
        </SettingRow>
        {pushConfigured() && (
          <SettingRow icon={<Bell size={18} />} title="Avisos no celular e no navegador" summary="Os aparelhos que recebem os avisos e o que cada um recebe" size="lg" footer="close">
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
          </SettingRow>
        )}
      </SettingGroup>

      <section className="flex flex-col gap-2">
        <h3 className="kpi-label px-1">Segundo fator</h3>
        <MfaSection bare enrollHref={`/painel/verificar?next=${encodeURIComponent("/painel/perfil")}`} />
      </section>
    </div>
  );
}
