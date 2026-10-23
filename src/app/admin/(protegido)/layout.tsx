import { requireAdmin } from "@/lib/platform-admin";
import { AdminNav } from "@/components/admin/admin-nav";
import { AppTheme } from "@/components/app-theme";
import { LogoMark } from "@/components/logo";

export const metadata = { title: { default: "Backoffice", template: "%s · Backoffice" } };

/** Backoffice da plataforma: só admins (PLATFORM_ADMIN_EMAILS) com a segunda etapa feita. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireAdmin();
  // redesenho (23/10/2026), no molde do painel: a coluna do menu no computador; no celular, o topo com as pílulas
  return (
    <div className="flex min-h-dvh flex-col bg-ground lg:flex-row">
      <AppTheme />
      <aside className="hidden w-[232px] shrink-0 flex-col gap-4 bg-panel p-3 shadow-[inset_-1px_0_0_var(--color-line)] lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <span className="flex items-center gap-2.5 px-2 pt-1">
          <LogoMark size={26} />
          <span className="leading-tight">
            <span className="display block text-[15px] font-bold">BoaVoz</span>
            <span className="block text-[11px] text-muted">Backoffice</span>
          </span>
        </span>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AdminNav vertical />
        </div>
        <span className="truncate px-2 text-[11px] text-muted" title={s.email}>
          {s.email}
        </span>
      </aside>
      <header className="sticky top-0 z-30 flex flex-col gap-2 border-b border-line bg-panel/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <span className="flex items-center gap-2">
          <LogoMark size={22} />
          <span className="display text-sm font-bold">BoaVoz · Backoffice</span>
        </span>
        <AdminNav />
      </header>
      <main className="flex w-full min-w-0 flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-9 lg:py-8">{children}</main>
    </div>
  );
}
