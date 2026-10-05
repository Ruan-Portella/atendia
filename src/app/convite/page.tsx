import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Logo } from "@/components/logo";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { INVITE_DAYS, activeMembership, hadMembership, openInvitesFor } from "@/lib/team";
import { createOwnAgency } from "./actions";

export const metadata = { title: "Sua agência", robots: { index: false, follow: false } };

/**
 * Para quem entrou e não tem agência ativa (leva B1'): tem convite em aberto, saiu de uma equipe
 * ou está com o acesso pausado pelo plano. O painel não cria agência sozinho para essas pessoas.
 */
export default async function NoAgencyPage({ searchParams }: PageProps<"/convite">) {
  const sp = await searchParams;
  const { data } = await (await createClient()).auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  const email = String(claims.email ?? "").toLowerCase();
  const db = createAdminClient();
  const member = await activeMembership(db, claims.sub);
  if (member && !member.paused_by_plan_at) redirect("/painel/clientes");
  const invites = email ? await openInvitesFor(db, email) : [];
  const removed = !member && (await hadMembership(db, claims.sub));
  const names = [...new Set(invites.map((i) => i.agency_name))].join(", ");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-16">
      <Logo />
      <div className="card flex w-full max-w-[460px] flex-col gap-4 p-7">
        {member?.paused_by_plan_at || sp.pausado === "1" ? (
          <>
            <h1 className="text-xl font-bold">Seu acesso está pausado</h1>
            <p className="text-sm text-muted">O plano da agência mudou e passou do limite de pessoas na equipe. Nada foi apagado: fale com o dono da agência para liberar o seu acesso de novo.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">{invites.length ? "Você tem um convite" : "Você não está em nenhuma equipe"}</h1>
            {invites.length > 0 ? (
              <p className="text-sm text-ink-2">
                {names} convidou você ({email}) para a equipe. Para aceitar, abra o link do convite que chegou no seu e-mail (vale {INVITE_DAYS} dias). Se não encontrar, peça para a agência convidar de novo.
              </p>
            ) : (
              <p className="text-sm text-ink-2">{removed ? "A agência de que você fazia parte removeu o seu acesso." : "Sua conta ainda não tem uma agência."} Se for convidado de novo, o link chega no seu e-mail.</p>
            )}
            <div className="flex flex-col gap-2 border-t border-line-2 pt-4">
              <p className="text-sm text-muted">Prefere usar o BoaVoz na sua própria agência?{invites.length ? " Os convites em aberto deixam de valer: cada usuário fica em uma agência só." : ""}</p>
              <ActionForm action={createOwnAgency}>
                <SubmitButton pendingLabel="Criando…" className="btn-ghost">Criar minha agência (teste grátis)</SubmitButton>
              </ActionForm>
            </div>
          </>
        )}
        <form action="/auth/signout" method="post">
          <button type="submit" className="text-xs text-muted hover:underline">Sair</button>
        </form>
      </div>
    </main>
  );
}
