import { requirePermission } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EditMemberButton, InviteMemberButton, ReinviteButton, type ScopeClient } from "@/components/team-forms";
import { MEMBER_COLS, ROLE_LABELS, inviteOpen, lastAccessOf, memberLimit, memberName, scopesOf, type AgencyMember, type InvitableRole } from "@/lib/team";
import { initials, relativeTime } from "@/lib/utils";
import { inviteTeamMember, reinviteTeamMember, removeTeamMember, updateTeamMember } from "./actions";

export const metadata = { title: "Equipe" };

const dateBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/**
 * Equipe (leva B1'): quem trabalha na agência, com papel e escopo. Dono e administrador veem;
 * dar ou tirar o papel de administrador é só do dono. Uma agência ativa por usuário.
 */
export default async function TeamPage() {
  const { agency, plan, role, member: me } = await requirePermission("team");
  const db = createAdminClient();
  const supabase = await createClient();
  const [{ data: rows }, { data: clientRows }] = await Promise.all([
    db.from("agency_members").select(MEMBER_COLS).eq("agency_id", agency.id).is("removed_at", null).order("invited_at"),
    supabase.from("clients").select("id, name, bots(id, name, is_demo)").order("name"),
  ]);
  const members = ((rows ?? []) as AgencyMember[]).sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
  const [scopes, lastAccess] = await Promise.all([scopesOf(db, members.map((m) => m.id)), lastAccessOf(db, members.flatMap((m) => (m.user_id ? [m.user_id] : [])))]);
  const clients: ScopeClient[] = ((clientRows ?? []) as Array<{ id: string; name: string; bots: Array<{ id: string; name: string; is_demo: boolean }> }>).map((c) => ({ id: c.id, name: c.name, bots: c.bots.filter((b) => !b.is_demo).map((b) => ({ id: b.id, name: b.name })) }));
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const botName = new Map(clients.flatMap((c) => c.bots.map((b) => [b.id, `${b.name} (${c.name})`] as const)));

  const limit = memberLimit(plan.id);
  const used = members.filter((m) => m.accepted_at || inviteOpen(m)).length;
  const full = used >= limit ? `O plano ${plan.name} permite ${limit} pessoas, contando você e os convites pendentes.` : null;
  const isOwner = role === "owner";

  const scopeText = (m: AgencyMember) => {
    if (m.scope === "all") return "Todos os clientes";
    const s = scopes.get(m.id) ?? { clientIds: [], botIds: [] };
    const names = [...s.clientIds.map((id) => clientName.get(id) ?? "cliente removido"), ...s.botIds.map((id) => botName.get(id) ?? "chatbot removido")];
    return names.length ? names.join(", ") : "Nenhum cliente";
  };

  return (
    <div className="flex max-w-[960px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-[28px]">Equipe</h1>
          <p className="text-sm text-muted">
            {used} de {limit} membros do plano {plan.name}. Cada pessoa entra com o próprio e-mail e vê só o que o papel e o escopo dela permitem.
          </p>
        </div>
        <InviteMemberButton action={inviteTeamMember} clients={clients} allowAdmin={isOwner} full={full} />
      </div>

      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[2fr_1fr_1.6fr_1fr_auto] gap-3 border-b border-line bg-ground px-[18px] py-3 text-xs font-semibold uppercase tracking-[0.06em] text-muted lg:grid">
          <span>Pessoa</span><span>Papel</span><span>Escopo</span><span>Último acesso</span><span />
        </div>
        {members.map((m) => {
          const pending = !m.accepted_at;
          const open = pending && inviteOpen(m);
          // o dono não muda; administrador só o dono mexe; ninguém se remove
          const canManage = m.role !== "owner" && m.id !== me.id && (isOwner || m.role !== "admin");
          const s = scopes.get(m.id) ?? { clientIds: [], botIds: [] };
          const name = memberName(m);
          return (
            <div key={m.id} className="flex flex-col gap-2 border-b border-line-2 px-4 py-3.5 text-sm last:border-0 lg:grid lg:grid-cols-[2fr_1fr_1.6fr_1fr_auto] lg:items-center lg:gap-3 lg:px-[18px]">
              <span className="flex min-w-0 items-center gap-2.5">
                {m.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.avatar_url} alt="" className="h-[30px] w-[30px] shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand">{initials(name)}</span>
                )}
                <span className="min-w-0 leading-tight">
                  <span className="block truncate font-semibold">{name}{m.id === me.id ? <span className="font-normal text-muted"> (você)</span> : null}</span>
                  <span className="block truncate text-xs text-muted">{m.email}</span>
                </span>
              </span>
              <span className="pl-[40px] lg:pl-0">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.role === "owner" || m.role === "admin" ? "bg-brand-soft text-brand" : "bg-ground text-ink-2"}`}>{ROLE_LABELS[m.role]}</span>
              </span>
              <span className="pl-[40px] text-xs text-ink-2 lg:pl-0 lg:text-sm">{scopeText(m)}</span>
              <span className="pl-[40px] text-xs text-muted lg:pl-0">
                {pending
                  ? open
                    ? `Convite pendente · vale até ${dateBR(m.invite_expires_at!)}`
                    : "Convite vencido"
                  : m.user_id && lastAccess.get(m.user_id)
                    ? relativeTime(lastAccess.get(m.user_id)!)
                    : "—"}
              </span>
              <span className="flex flex-wrap gap-1.5 pl-[40px] lg:justify-end lg:pl-0">
                {canManage && pending && <ReinviteButton action={reinviteTeamMember.bind(null, m.id)} />}
                {canManage && !pending && (
                  <EditMemberButton
                    action={updateTeamMember.bind(null, m.id)}
                    clients={clients}
                    allowAdmin={isOwner}
                    name={name}
                    defaults={{ role: m.role as InvitableRole, scope: m.scope, clientIds: s.clientIds, botIds: s.botIds }}
                  />
                )}
                {canManage && (
                  <ConfirmAction
                    action={removeTeamMember.bind(null, m.id)}
                    title={pending ? "Cancelar este convite?" : `Remover ${name} da equipe?`}
                    description={pending ? `O link mandado para ${m.email} deixa de valer.` : `${name} perde o acesso ao painel na hora. O que a pessoa fez continua na auditoria.`}
                    confirmLabel={pending ? "Cancelar convite" : "Remover"}
                    className="btn-ghost text-xs text-danger"
                  >
                    {pending ? "Cancelar" : "Remover"}
                  </ConfirmAction>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="card flex flex-col gap-2 p-5 text-sm text-ink-2">
        <h2 className="text-base font-bold text-ink">O que cada papel faz</h2>
        <p><strong>Dono:</strong> tudo, inclusive cobrança, afiliados e o papel de administrador.</p>
        <p><strong>Administrador:</strong> clientes, chatbots, equipe, marca e domínio, Segurança e exportações. Não vê a cobrança.</p>
        <p><strong>Editor:</strong> configura os clientes e chatbots do escopo (base, personalidade, canais, área do cliente) e atende as conversas.</p>
        <p><strong>Atendente:</strong> só as conversas dos clientes e chatbots do escopo: assumir, responder e devolver para a IA.</p>
        <p className="text-xs text-muted">Quem já tem uma agência no BoaVoz não entra em outra com o mesmo e-mail: peça outro e-mail à pessoa. Conversas de chatbot em modo dados sensíveis pedem o segundo fator a qualquer papel.</p>
      </div>
    </div>
  );
}
