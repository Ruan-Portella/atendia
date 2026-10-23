import { requirePermission } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { InviteMemberButton, type ScopeClient } from "@/components/team-forms";
import { TeamList, type TeamRow } from "@/components/team-list";
import { HowItWorks } from "@/components/ui/form-section";
import { MEMBER_COLS, ROLE_LABELS, inviteOpen, lastAccessOf, memberName, scopesOf, type AgencyMember, type InvitableRole } from "@/lib/team";
import { relativeTime } from "@/lib/utils";
import { endTeamMemberSessions, inviteTeamMember, reinviteTeamMember, removeTeamMember, updateTeamMember } from "./actions";

export const metadata = { title: "Equipe" };

const dateBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/**
 * Equipe (leva B1'): quem trabalha na agência, com papel e escopo. Dono e administrador veem;
 * dar ou tirar o papel de administrador é só do dono. Uma agência ativa por usuário. Redesenho,
 * etapa 5: cada pessoa numa linha, com as ações no menu "…" (TeamList).
 */
export default async function TeamPage() {
  const { agency, role, member: me } = await requirePermission("team");
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

  const used = members.filter((m) => m.accepted_at || inviteOpen(m)).length;
  const isOwner = role === "owner";

  const scopeText = (m: AgencyMember) => {
    if (m.scope === "all") return "Todos os clientes";
    const s = scopes.get(m.id) ?? { clientIds: [], botIds: [] };
    const names = [...s.clientIds.map((id) => clientName.get(id) ?? "cliente removido"), ...s.botIds.map((id) => botName.get(id) ?? "chatbot removido")];
    return names.length ? names.join(", ") : "Nenhum cliente";
  };

  const list: TeamRow[] = members.map((m) => {
    const pending = !m.accepted_at;
    // o dono não muda; administrador só o dono mexe; ninguém se remove
    const canManage = m.role !== "owner" && m.id !== me.id && (isOwner || m.role !== "admin");
    const s = scopes.get(m.id) ?? { clientIds: [], botIds: [] };
    const seen = m.user_id ? lastAccess.get(m.user_id) : null;
    return {
      id: m.id,
      name: memberName(m),
      email: m.email,
      avatar: m.avatar_url ?? null,
      you: m.id === me.id,
      role: m.role,
      roleLabel: ROLE_LABELS[m.role],
      scope: scopeText(m),
      access: seen ? relativeTime(seen) : null,
      invite: pending ? (inviteOpen(m) ? { state: "open", until: dateBR(m.invite_expires_at!) } : { state: "expired" }) : null,
      canManage,
      canEndSessions: canManage && !pending && Boolean(m.user_id),
      defaults: { role: (m.role === "owner" ? "admin" : m.role) as InvitableRole, scope: m.scope, clientIds: s.clientIds, botIds: s.botIds },
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-normal sm:text-[28px]">Equipe e papéis</h1>
            <p className="text-sm text-muted">
              {used} {used === 1 ? "pessoa" : "pessoas"} na equipe, sem limite. Cada pessoa entra com o próprio e-mail e vê só o que o papel e o escopo dela permitem.
            </p>
          </div>
          <InviteMemberButton action={inviteTeamMember} clients={clients} allowAdmin={isOwner} />
        </div>
        <HowItWorks label="O que cada papel faz">
          <p>
            <strong className="text-ink">Dono:</strong> tudo, inclusive a cobrança e o papel de administrador.
          </p>
          <p>
            <strong className="text-ink">Administrador:</strong> clientes, chatbots, equipe, marca e domínio, Segurança e exportações. Não vê a cobrança.
          </p>
          <p>
            <strong className="text-ink">Editor:</strong> configura os clientes e chatbots do escopo (base, personalidade, canais, área do cliente) e atende as conversas.
          </p>
          <p>
            <strong className="text-ink">Atendente:</strong> só as conversas dos clientes e chatbots do escopo: assumir, responder e devolver para a IA.
          </p>
          <p className="text-xs">Quem já tem uma conta no BoaVoz não entra em outra com o mesmo e-mail: peça outro e-mail à pessoa. Conversas de chatbot em modo dados sensíveis pedem o segundo fator a qualquer papel.</p>
        </HowItWorks>
      </div>

      <TeamList rows={list} clients={clients} allowAdmin={isOwner} update={updateTeamMember} reinvite={reinviteTeamMember} endSessions={endTeamMemberSessions} remove={removeTeamMember} />
    </div>
  );
}
