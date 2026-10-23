import { notFound } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
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
    <AuthShell headline="Mais segurança: o código do app autenticador protege a sua conta.">
      <MfaRecoveryToken token={token} view={view} />
    </AuthShell>
  );
}
