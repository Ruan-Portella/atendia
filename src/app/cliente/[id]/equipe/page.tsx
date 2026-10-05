import { requireMember, PORTAL_ROLE_LABELS, isPortalRole } from "@/lib/member";
import { relativeTime } from "@/lib/utils";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
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
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Equipe</h1>
        <p className="text-sm text-muted">
          Quem entra na área do cliente de {member.clientName}. Atendentes veem só as conversas{member.allowHandoff ? " e respondem os contatos" : ""}; gestores veem também relatório, canais, privacidade e a equipe. Para incluir outro gestor, fale com {member.agency.name}.
        </p>
      </div>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="text-base font-bold">Convidar atendente</h2>
        <ActionForm action={memberInvite.bind(null, id)} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="invite-email" className="label">E-mail</label>
            <input id="invite-email" name="email" type="email" required maxLength={200} className="input" placeholder="recepcao@suaempresa.com.br" />
          </div>
          <SubmitButton pendingLabel="Enviando convite…" className="btn-primary">Convidar</SubmitButton>
        </ActionForm>
        <p className="text-xs text-muted">A pessoa recebe um link de entrada por e-mail, sem senha. Cada acesso vale 7 dias; depois ela pede um link novo.</p>
      </section>

      <section className="card overflow-hidden">
        {people.map((p) => {
          const agent = p.role === "agent";
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-4 py-3 text-sm last:border-0">
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate font-medium">{p.display_name ?? p.email}{p.id === member.memberId ? <span className="font-normal text-muted"> (você)</span> : null}</span>
                {p.display_name && <span className="block truncate text-xs text-muted">{p.email}</span>}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${agent ? "bg-ground text-ink-2" : "bg-brand-soft text-brand"}`}>{isPortalRole(p.role) ? PORTAL_ROLE_LABELS[p.role] : p.role}</span>
              <span className="text-xs text-muted">{p.last_login_at ? `entrou ${relativeTime(p.last_login_at)}` : "ainda não entrou"}</span>
              {agent && p.id !== member.memberId && (
                <>
                  <ConfirmAction action={memberResendLink.bind(null, id, p.id)} title="Reenviar o link?" description={<>Um link novo de acesso vai para <strong className="text-ink">{p.email}</strong>.</>} confirmLabel="Reenviar" danger={false} className="text-xs font-semibold text-brand hover:underline">Reenviar link</ConfirmAction>
                  <ConfirmAction action={memberRemove.bind(null, id, p.id)} title="Tirar o acesso?" description={<><strong className="text-ink">{p.email}</strong> não consegue mais entrar na área do cliente.</>} confirmLabel="Tirar acesso" className="text-xs font-semibold text-danger hover:underline">Remover</ConfirmAction>
                </>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}
