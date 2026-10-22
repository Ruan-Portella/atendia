import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { FirstAccessForm } from "@/components/first-access-form";
import { requireAgency } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { NOTICE_CONSENT_FIRST_ACCESS, noticeStatus } from "@/lib/team-whatsapp";
import { firstName } from "@/lib/authors";
import { company } from "@/lib/company";

export const metadata = { title: "Primeiro acesso" };

/**
 * Primeiro acesso (Entrada e docs, parte 1): o dono responde como vai usar o BoaVoz antes do
 * painel (o layout do painel traz para cá enquanto agencies.profile é null). Com ?editar, muda
 * depois; o painel muda só o perfil num modal (ProfileButton, em Marca e nos primeiros passos).
 */
export default async function FirstAccessPage({ searchParams }: PageProps<"/comecar">) {
  const [{ agency, member, role, email }, sp] = await Promise.all([requireAgency(), searchParams]);
  // só o dono responde; quem entra por convite chega numa conta pronta
  if (role !== "owner") redirect("/painel/clientes");
  if (agency.profile && sp.editar === undefined) redirect("/painel/clientes");
  const notice = await noticeStatus(createAdminClient(), member.id).catch(() => null);
  // o nome tirado só do e-mail (cadastro sem nome) não é sugerido: a pessoa escreve o dela
  const unlessGuessed = (name: string | null | undefined, guess: string) => (name && name !== guess ? name : "");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-16">
      <Logo />
      <FirstAccessForm
        brand={company.brand}
        profile={agency.profile}
        accountName={unlessGuessed(agency.name, email.split("@")[0])}
        displayName={unlessGuessed(member.display_name, firstName(null, email))}
        askPhone={Boolean(notice?.available && notice.status === null)}
        consent={NOTICE_CONSENT_FIRST_ACCESS}
      />
    </main>
  );
}
