import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { MfaRecoveryToken } from "@/components/mfa-recovery-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadRecovery } from "@/lib/mfa-recovery";

export const metadata = { title: "Recuperar o segundo fator", robots: { index: false, follow: false } };

/** O link do e-mail da recuperação do segundo fator do painel (sem login: o link é a prova). */
export default async function PanelRecoveryTokenPage({ params }: PageProps<"/segundo-fator/[token]">) {
  const { token } = await params;
  const view = await loadRecovery(createAdminClient(), token);
  if (!view || view.area !== "painel") notFound();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-16">
      <Logo />
      <MfaRecoveryToken token={token} view={view} />
    </main>
  );
}
