import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getMemberSession } from "@/lib/member";
import { hostAgency } from "@/lib/domain-server";

export const metadata = { title: { absolute: "Área do cliente" }, robots: { index: false, follow: false } };

/** Depois do login: um cliente só → vai direto; vários (ex.: duas empresas) → escolhe. */
export default async function MemberHome() {
  const session = await getMemberSession();
  if (!session) redirect("/cliente/entrar");
  const host = await hostAgency();
  const list = session.memberships.filter((m) => host === undefined || m.agencyId === host?.id);
  if (list.length === 1) redirect(`/cliente/${list[0].clientId}`);
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col gap-4 px-4 py-12">
      <h1 className="text-2xl font-bold">Área do cliente</h1>
      {list.length === 0 ? (
        <p className="text-sm text-muted">O e-mail {session.email} não tem acesso a nenhum assistente aqui. Peça acesso para a agência que cuida do seu atendimento.</p>
      ) : (
        <div className="card overflow-hidden">
          {list.map((m) => (
            <Link key={m.clientId} href={`/cliente/${m.clientId}`} className="flex items-center gap-3 border-b border-line-2 px-4 py-3.5 text-sm last:border-0 hover:bg-ground">
              <span className="flex-1"><span className="block font-semibold">{m.clientName}</span><span className="text-xs text-muted">com {m.agency.name}</span></span>
              <ChevronRight size={16} className="text-muted" />
            </Link>
          ))}
        </div>
      )}
      <form action="/cliente/sair" method="post"><button type="submit" className="text-xs text-muted hover:underline">Sair ({session.email})</button></form>
    </main>
  );
}
