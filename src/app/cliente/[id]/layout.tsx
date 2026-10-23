import { LogOut, MessageCircle } from "lucide-react";
import { memberCan, requireMember } from "@/lib/member";
import { getPendingHandoffs } from "@/lib/panel";
import { handoffStatus } from "@/lib/handoff-status";
import { initials } from "@/lib/utils";
import { brandColor } from "@/components/report-view";
import { MemberNav } from "@/components/member-nav";
import { HandoffWatcher } from "@/components/handoff-watcher";
import { AppTheme } from "@/components/app-theme";

/** A marca da agência (logo ou as iniciais na cor dela) e o nome. */
function AgencyMark({ agency, size = 30 }: { agency: { name: string; logo_url: string | null; brand_color: string }; size?: number }) {
  return agency.logo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={agency.logo_url} alt="" className="shrink-0 rounded-lg object-contain" style={{ width: size, height: size }} />
  ) : (
    <span className="display flex shrink-0 items-center justify-center rounded-lg text-[12px] font-bold text-white" style={{ width: size, height: size, background: brandColor(agency.brand_color) }}>
      {initials(agency.name)}
    </span>
  );
}

/**
 * Casca da área do cliente: marca da agência, abas conforme as permissões e o papel (gestor ou
 * atendente) e "Sair".
 * Formato de app: o menu fica fixo e só o conteúdo rola; assim a tela de conversa ocupa exatamente
 * o espaço que sobra (com rolagem só nas mensagens). Rodada 2 das telas (23/10/2026, a pedido do
 * usuário): no computador, o menu numa coluna à esquerda, como no painel, e o conteúdo na largura
 * toda; no celular, o topo com a marca e as abas em pílulas.
 */
export default async function MemberLayout({ children, params }: LayoutProps<"/cliente/[id]">) {
  const { id } = await params;
  const { email, member, admin, botIds } = await requireMember(id);
  const pending = member.allowHandoff ? await getPendingHandoffs(admin, botIds) : [];
  const nav = { clientId: id, manager: memberCan(member, "manager"), handoff: member.allowHandoff, knowledge: member.allowKnowledge, hours: member.allowHours, waiting: pending.filter((p) => handoffStatus(p)?.waiting).length };
  const wa = member.agency.support_whatsapp ? `https://wa.me/${member.agency.support_whatsapp.replace(/\D/g, "")}` : null;
  const signOut = (
    <form action="/cliente/sair" method="post">
      <button type="submit" className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm text-ink-2 transition-colors duration-[120ms] hover:bg-raised/60 hover:text-ink" title={email}>
        <LogOut size={16} className="shrink-0 text-muted" />
        Sair
      </button>
    </form>
  );
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
          <MemberNav {...nav} vertical />
        </div>
        <div className="flex flex-col gap-1">
          {wa && (
            <a href={wa} target="_blank" rel="noopener" className="btn-primary mb-1 justify-center" style={{ background: brandColor(member.agency.brand_color) }}>
              <MessageCircle size={15} />
              Falar com a agência
            </a>
          )}
          {signOut}
          <span className="truncate px-2.5 text-[11px] text-muted" title={email}>
            {email}
          </span>
        </div>
      </aside>
      <header className="flex flex-col gap-2 border-b border-line bg-panel px-4 py-2.5 lg:hidden print:hidden">
        <span className="flex items-center gap-2">
          <AgencyMark agency={member.agency} size={26} />
          <span className="display min-w-0 flex-1 truncate text-sm font-bold">{member.agency.name}</span>
          {wa && (
            <a href={wa} target="_blank" rel="noopener" aria-label="Falar com a agência" title="Falar com a agência" className="btn-icon h-9 w-9">
              <MessageCircle size={17} />
            </a>
          )}
          <form action="/cliente/sair" method="post">
            <button type="submit" aria-label="Sair" title={`Sair (${email})`} className="btn-icon h-9 w-9">
              <LogOut size={17} />
            </button>
          </form>
        </span>
        <MemberNav {...nav} />
      </header>
      {member.allowHandoff && <HandoffWatcher endpoint={`/api/cliente/pending?clientId=${id}`} />}
      {/* `relative`: os elementos absolutos de dentro (texto só para leitor de tela) ficam presos a esta área, sem rolagem fantasma */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <main className="flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-9">{children}</main>
      </div>
    </div>
  );
}
