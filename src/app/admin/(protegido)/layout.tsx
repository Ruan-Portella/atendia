import { requireAdmin } from "@/lib/platform-admin";
import { AdminNav } from "@/components/admin/admin-nav";

export const metadata = { title: { default: "Backoffice", template: "%s · Backoffice" } };

/** Backoffice da plataforma: só admins (PLATFORM_ADMIN_EMAILS) com a segunda etapa feita. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireAdmin();
  return (
    <div className="min-h-dvh bg-ground">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
          <span className="display font-bold">BoaVoz · Backoffice</span>
          <AdminNav />
          <span className="ml-auto hidden text-xs text-muted sm:block">{s.email}</span>
        </div>
      </header>
      <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
