import Link from "next/link";
import { requireAgency } from "@/lib/agency";
import { num } from "@/lib/plans";
import { daysUntil, initials } from "@/lib/utils";
import { SidebarNav } from "@/components/sidebar-nav";

export default async function PainelLayout({ children }: LayoutProps<"/painel">) {
  const { agency, plan, usage } = await requireAgency();
  const pct = Math.min(100, Math.round((usage / Math.max(1, plan.conversations)) * 100));
  const trialDays = plan.id === "trial" ? daysUntil(agency.trial_ends_at) : null;

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="flex w-full flex-col gap-1.5 bg-ink p-4 text-ground md:min-h-screen md:w-60 md:shrink-0">
        <Link href="/painel" className="flex items-center gap-2.5 px-2 pb-4 pt-1">
          {agency.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agency.logo_url} alt="" className="h-7 w-7 rounded-lg object-cover" />
          ) : (
            <span className="display flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold text-ink" style={{ background: agency.brand_color === "#1f4e3d" ? "#e9a23b" : agency.brand_color }}>{initials(agency.name)}</span>
          )}
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold">{agency.name}</span>
            <span className="block text-[11px] text-[#9aa39e]">Plano {plan.name}{trialDays !== null ? ` · ${trialDays} dias` : ""}</span>
          </span>
        </Link>
        <SidebarNav />
        <div className="mt-auto flex flex-col gap-2 rounded-[10px] bg-[#262c29] px-3 py-3.5 text-xs text-[#c8cfcb]">
          <div className="flex justify-between"><span>Conversas do mês</span><span className="font-semibold text-ground tabular">{num(usage)} / {num(plan.conversations)}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#3a423e]"><div className="h-full bg-brand-tint" style={{ width: `${pct}%` }} /></div>
          <Link href="/painel/cobranca" className="font-semibold text-brand-tint">Ver plano</Link>
        </div>
        <form action="/auth/signout" method="post" className="px-2 pt-2">
          <button type="submit" className="text-xs text-[#9aa39e] hover:text-ground">Sair</button>
        </form>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-6 px-5 py-7 md:px-9">{children}</main>
    </div>
  );
}
