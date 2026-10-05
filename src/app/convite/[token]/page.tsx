import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Logo } from "@/components/logo";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { INVITE_DAYS, ROLE_LABELS, activeMembership, inviteByToken, inviteOpen } from "@/lib/team";
import { acceptTeamInvite } from "../actions";

export const metadata = { title: "Convite para a equipe", robots: { index: false, follow: false } };

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-16">
      <Logo />
      <div className="card flex w-full max-w-[440px] flex-col gap-4 p-7">{children}</div>
    </main>
  );
}

/**
 * Link do convite (leva B1'): mostra de qual agência é e com que papel; para aceitar, a pessoa
 * entra (ou cria a conta) com o e-mail convidado. O token nunca vai para o log nem para outra página.
 */
export default async function InvitePage({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const db = createAdminClient();
  const invite = await inviteByToken(db, token);
  if (!invite || invite.removed_at) {
    return (
      <Card>
        <h1 className="text-xl font-bold">Este convite não vale mais</h1>
        <p className="text-sm text-muted">Ele foi cancelado ou trocado por um link novo. Peça para a agência convidar você de novo.</p>
      </Card>
    );
  }
  if (invite.accepted_at) {
    return (
      <Card>
        <h1 className="text-xl font-bold">Convite já aceito</h1>
        <p className="text-sm text-muted">Este convite já foi usado. Entre com o seu e-mail para abrir o painel.</p>
        <Link href="/login" className="btn-primary self-start">Entrar</Link>
      </Card>
    );
  }
  if (!inviteOpen(invite)) {
    return (
      <Card>
        <h1 className="text-xl font-bold">O convite venceu</h1>
        <p className="text-sm text-muted">O link vale por {INVITE_DAYS} dias. Peça para {invite.agency_name} convidar você de novo.</p>
      </Card>
    );
  }

  const next = `/convite/${token}`;
  const header = (
    <>
      <h1 className="text-xl font-bold">Convite para a equipe de {invite.agency_name}</h1>
      <p className="text-sm text-ink-2">
        Você foi convidado como <strong>{ROLE_LABELS[invite.role].toLowerCase()}</strong>, com o e-mail <strong>{invite.email}</strong>.
      </p>
    </>
  );

  const { data } = await (await createClient()).auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) {
    return (
      <Card>
        {header}
        <p className="text-sm text-muted">Para aceitar, entre com esse e-mail. Se ainda não tem conta no BoaVoz, crie uma com ele.</p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="btn-primary">Entrar</Link>
          <Link href={`/cadastro?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invite.email)}`} className="btn-ghost">Criar conta</Link>
        </div>
      </Card>
    );
  }

  const email = String(claims.email ?? "").toLowerCase();
  if (email !== invite.email) {
    return (
      <Card>
        {header}
        <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Você está logado como {email || "outra conta"}. Saia e entre com {invite.email} para aceitar.</p>
        <form action="/auth/signout" method="post">
          <input type="hidden" name="next" value={`/login?next=${encodeURIComponent(next)}`} />
          <button type="submit" className="btn-ghost">Sair e entrar com outro e-mail</button>
        </form>
      </Card>
    );
  }

  if (await activeMembership(db, claims.sub)) {
    return (
      <Card>
        {header}
        <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Este e-mail já está numa agência do BoaVoz, e cada usuário fica em uma agência só. Peça para {invite.agency_name} convidar outro e-mail seu.</p>
        <Link href="/painel/clientes" className="btn-ghost self-start">Voltar ao painel</Link>
      </Card>
    );
  }

  return (
    <Card>
      {header}
      <p className="text-sm text-muted">Ao aceitar, você entra no painel de {invite.agency_name} e vê só o que o seu papel permite.</p>
      <ActionForm action={acceptTeamInvite.bind(null, token)}>
        <SubmitButton pendingLabel="Entrando…" className="btn-primary">Aceitar e entrar na equipe</SubmitButton>
      </ActionForm>
    </Card>
  );
}
