import Link from "next/link";
import { Logo } from "@/components/logo";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { audienceOf } from "@/lib/landing";
import { cn } from "@/lib/utils";

export const metadata = { title: "Lista de espera", description: "Entre na lista de espera do BoaVoz e receba o convite por ordem de chegada." };

/**
 * Lista de espera (24/10/2026): a página própria, para links diretos e para quem entrou no painel
 * sem convite com a lista ligada (?aguarde=1). ?para=negocio troca o perfil.
 */
export default async function WaitlistPage({ searchParams }: PageProps<"/lista-de-espera">) {
  const sp = await searchParams;
  const audience = audienceOf(sp.para);
  const waiting = sp.aguarde === "1";
  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-5 py-4 sm:px-6">
        <Logo />
        <Link href={audience === "business" ? "/?para=negocio" : "/"} className="text-sm font-medium text-ink-2 hover:text-ink">Conhecer o BoaVoz</Link>
      </header>
      <main className="relative flex flex-1 items-center overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,var(--color-brand-soft),transparent)]" aria-hidden />
        <div className="relative mx-auto flex w-full max-w-[640px] flex-col items-center gap-6 px-5 py-16 text-center sm:px-6">
          <span className="rounded-full border border-brand-line bg-panel px-3 py-1 text-xs font-semibold text-brand">Acesso antecipado · abrindo aos poucos</span>
          <h1 className="text-[34px] font-bold leading-[1.06] sm:text-5xl">{waiting ? "A sua conta ainda não foi liberada." : "Entre na lista de espera."}</h1>
          <p className="text-lg leading-relaxed text-ink-2">
            {waiting
              ? "Estamos abrindo o BoaVoz aos poucos, por convite. Se você já está na lista, é só esperar o e-mail; se ainda não está, deixe o e-mail abaixo para garantir o seu lugar."
              : "Estamos abrindo o BoaVoz aos poucos, por ordem de chegada. Deixe o e-mail e receba o convite quando for a sua vez."}
          </p>
          <nav aria-label="Para quem é" className="inline-flex rounded-full border border-line bg-panel p-1 text-sm font-medium">
            {(
              [
                ["agency", "/lista-de-espera", "Para a minha agência", "Agência"],
                ["business", "/lista-de-espera?para=negocio", "Para o meu negócio", "Meu negócio"],
              ] as const
            ).map(([a, href, label, short]) => (
              <Link key={a} href={waiting ? `${href}${href.includes("?") ? "&" : "?"}aguarde=1` : href} scroll={false} aria-current={a === audience ? "page" : undefined} className={cn("rounded-full px-4 py-1.5", a === audience ? "bg-ink text-ground" : "text-muted hover:text-ink")}>
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </nav>
          <WaitlistForm profile={audience} source={waiting ? "sem-convite" : "pagina-lista"} />
        </div>
      </main>
    </div>
  );
}
