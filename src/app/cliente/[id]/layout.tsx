import { requireMember } from "@/lib/member";
import { getPendingHandoffs } from "@/lib/panel";
import { AgencyHeader } from "@/components/report-view";
import { MemberNav } from "@/components/member-nav";
import { HandoffWatcher } from "@/components/handoff-watcher";

/**
 * Casca da área do cliente: marca da agência, abas conforme as permissões e "Sair".
 * Formato de app: cabeçalho e abas ficam fixos e só o conteúdo rola; assim a tela de conversa
 * ocupa exatamente o espaço que sobra (com rolagem só nas mensagens).
 */
export default async function MemberLayout({ children, params }: LayoutProps<"/cliente/[id]">) {
  const { id } = await params;
  const { email, member, admin, botIds } = await requireMember(id);
  const pending = member.allowHandoff ? await getPendingHandoffs(admin, botIds) : [];
  return (
    <div className="flex h-dvh flex-col bg-ground">
      <AgencyHeader agency={member.agency}>
        <form action="/cliente/sair" method="post"><button type="submit" className="btn-ghost" title={email}>Sair</button></form>
      </AgencyHeader>
      <div className="border-b border-line bg-panel">
        <MemberNav clientId={id} handoff={member.allowHandoff} knowledge={member.allowKnowledge} waiting={pending.filter((p) => !p.takeover_at).length} />
      </div>
      {member.allowHandoff && <HandoffWatcher endpoint={`/api/cliente/pending?clientId=${id}`} />}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <main className="mx-auto flex w-full max-w-[980px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
