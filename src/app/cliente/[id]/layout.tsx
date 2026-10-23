import { memberCan, requireMember } from "@/lib/member";
import { getPendingHandoffs } from "@/lib/panel";
import { handoffStatus } from "@/lib/handoff-status";
import { AgencyMark, MemberMenuFoot, MemberMobileBar, MemberNav, type MemberNavProps } from "@/components/member-nav";
import { HandoffWatcher } from "@/components/handoff-watcher";
import { AppTheme } from "@/components/app-theme";

/**
 * Casca da área do cliente: marca da agência, abas conforme as permissões e o papel (gestor ou
 * atendente) e "Sair".
 * Formato de app: o menu fica fixo e só o conteúdo rola; assim a tela de conversa ocupa exatamente
 * o espaço que sobra (com rolagem só nas mensagens). Rodada 2 das telas (23/10/2026, a pedido do
 * usuário): no computador, o menu numa coluna à esquerda, como no painel, e o conteúdo na largura
 * toda; no celular, o topo com o botão do menu (que desliza da esquerda), como no painel.
 */
export default async function MemberLayout({ children, params }: LayoutProps<"/cliente/[id]">) {
  const { id } = await params;
  const { email, member, admin, botIds } = await requireMember(id);
  const pending = member.allowHandoff ? await getPendingHandoffs(admin, botIds) : [];
  const nav: MemberNavProps = { clientId: id, manager: memberCan(member, "manager"), handoff: member.allowHandoff, knowledge: member.allowKnowledge, hours: member.allowHours, waiting: pending.filter((p) => handoffStatus(p)?.waiting).length };
  const wa = member.agency.support_whatsapp ? `https://wa.me/${member.agency.support_whatsapp.replace(/\D/g, "")}` : null;
  return (
    <div className="flex h-dvh flex-col bg-ground lg:flex-row">
      <AppTheme />
      <aside className="hidden w-[232px] shrink-0 flex-col gap-4 bg-panel p-3 shadow-[inset_-1px_0_0_var(--color-line)] lg:flex print:hidden">
        <span className="flex min-w-0 items-center gap-2.5 px-2 pt-1">
          <AgencyMark agency={member.agency} />
          <span className="min-w-0 leading-tight">
            <span className="display block truncate text-[15px] font-bold">{member.agency.name}</span>
            <span className="block truncate text-[11px] text-muted">{member.clientName}</span>
          </span>
        </span>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MemberNav {...nav} />
        </div>
        <MemberMenuFoot agency={member.agency} email={email} wa={wa} />
      </aside>
      <MemberMobileBar agency={member.agency} clientName={member.clientName} email={email} wa={wa} nav={nav} />
      {member.allowHandoff && <HandoffWatcher endpoint={`/api/cliente/pending?clientId=${id}`} />}
      {/* `relative`: os elementos absolutos de dentro (texto só para leitor de tela, a Caixa) ficam presos a esta área, sem rolagem fantasma */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <main className="flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-9">{children}</main>
      </div>
    </div>
  );
}
