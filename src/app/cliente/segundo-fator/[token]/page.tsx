import { notFound } from "next/navigation";
import { MfaRecoveryToken } from "@/components/mfa-recovery-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadRecovery } from "@/lib/mfa-recovery";

export const metadata = { title: { absolute: "Recuperar o segundo fator" }, robots: { index: false, follow: false } };

/** O link do e-mail da recuperação do segundo fator na área do cliente (neutra, white-label; sem login). */
export default async function MemberRecoveryTokenPage({ params }: PageProps<"/cliente/segundo-fator/[token]">) {
  const { token } = await params;
  const view = await loadRecovery(createAdminClient(), token);
  if (!view || view.area !== "cliente") notFound();
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-ground px-4 py-12">
      <MfaRecoveryToken token={token} view={view} />
    </main>
  );
}
