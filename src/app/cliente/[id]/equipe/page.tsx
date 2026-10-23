import { UserPlus } from "lucide-react";
import { DialogButton, SettingGroup } from "@/components/ui/setting-row";
import { RowMenu } from "@/components/integrations/row-menu";
import { initials } from "@/lib/utils";
import { requireMember, PORTAL_ROLE_LABELS, isPortalRole } from "@/lib/member";
import { relativeTime } from "@/lib/utils";
import { memberInvite, memberRemove, memberResendLink } from "../../actions";

export const metadata = { title: { absolute: "Equipe" }, robots: { index: false, follow: false } };

/**
 * Equipe do portal (leva B1'): o gestor convida atendentes, que entram com um link no e-mail e
 * veem só as conversas. Gestores novos vêm da agência.
 */
export default async function MemberTeamPage({ params }: PageProps<"/cliente/[id]/equipe">) {
  const { id } = await params;
  const { member, admin } = await requireMember(id, "manager");
  const { data } = await admin.from("client_members").select("id, email, role, display_name, last_login_at").eq("client_id", id).order("created_at");
  const people = (data ?? []) as Array<{ id: string; email: string; role: string; display_name: string | null; last_login_at: string | null }>;
  // redesenho (23/10/2026, no molde da Equipe do painel): o Convidar num modal e cada pessoa numa linha com o "…"
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-normal">Equipe</h1>
          <p className="max-w-[560px] text-sm text-muted">
            Quem entra na área do cliente de {member.clientName}. Atendentes veem só as conversas{member.allowHandoff ? " e respondem os contatos" : ""}; gestores veem também relatório, canais, privacidade e a equipe. Para incluir outro gestor, fale com a agência.
          </p>
        </div>
        <DialogButton label="Convidar atendente" icon={<UserPlus size={15} />} className="btn-primary" title="Convidar atendente" description="A pessoa recebe um link de entrada por e-mail, sem senha. Cada acesso vale 7 dias; depois ela pede um link novo." action={memberInvite.bind(null, id)} saveLabel="Convidar">
          <div>
            <label htmlFor="invite-email" className="label">
              E-mail
            </label>
            <input id="invite-email" name="email" type="email" required maxLength={200} className="input" placeholder="recepcao@suaempresa.com.br" />
          </div>
        </DialogButton>
      </div>

      <SettingGroup title={`Pessoas · ${people.length}`}>
        {people.map((p) => {
          const agent = p.role === "agent";
          return (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-ink">{initials(p.display_name ?? p.email)}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-[15px] font-medium text-ink">
                    {p.display_name ?? p.email}
                    {p.id === member.memberId ? <span className="font-normal text-muted"> (você)</span> : null}
                  </span>
                  <span className={`rounded-full px-2 py-px text-[11.5px] font-medium ${agent ? "bg-raised text-ink-2" : "bg-brand-soft text-brand"}`}>{isPortalRole(p.role) ? PORTAL_ROLE_LABELS[p.role] : p.role}</span>
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-muted">
                  {p.display_name ? `${p.email} · ` : ""}
                  {p.last_login_at ? `entrou ${relativeTime(p.last_login_at)}` : "ainda não entrou"}
                </span>
              </span>
              {agent && p.id !== member.memberId && (
                <RowMenu
                  label={`Ações de ${p.email}`}
                  items={[
                    { label: "Reenviar o link", run: memberResendLink.bind(null, id, p.id), confirm: { title: "Reenviar o link?", description: `Um link novo de acesso vai para ${p.email}.`, confirmLabel: "Reenviar" } },
                    { label: "Tirar o acesso", danger: true, run: memberRemove.bind(null, id, p.id), confirm: { title: "Tirar o acesso?", description: `${p.email} não consegue mais entrar na área do cliente.`, confirmLabel: "Tirar acesso", danger: true } },
                  ]}
                />
              )}
            </div>
          );
        })}
      </SettingGroup>
    </>
  );
}
