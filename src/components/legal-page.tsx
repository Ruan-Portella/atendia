import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { company, LEGAL_UPDATED_AT } from "@/lib/company";

/** Casca das páginas públicas de termos, privacidade e exclusão de dados. */
export function LegalPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-line px-5 py-4 sm:px-6 sm:py-5 lg:px-16 xl:px-24">
        <Logo />
        <Link href="/" className="text-sm font-medium">Voltar ao site</Link>
      </header>
      <main className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-5 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-3">
          <span className="eyebrow">Última atualização: {LEGAL_UPDATED_AT}</span>
          <h1 className="text-3xl font-bold leading-[1.1] md:text-[40px]">{title}</h1>
          {intro && <p className="text-[17px] leading-relaxed text-ink-2">{intro}</p>}
        </div>
        {children}
      </main>
      <LegalFooter />
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 text-[15px] leading-relaxed text-ink-2 [&_a]:font-medium [&_a]:text-brand [&_a]:underline [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-ink">
      <h2 className="display text-xl font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** Rodapé com a identificação da empresa: é onde a Meta procura nome, CNPJ e contato. */
export function LegalFooter() {
  return (
    <footer className="flex flex-col gap-3 border-t border-line px-6 py-6 text-[13px] text-muted md:flex-row md:justify-between lg:px-16 xl:px-24">
      <div className="flex flex-col gap-0.5">
        {/* MEI não tem nome fantasia: a frase liga a marca à razão social para quem confere (Meta) */}
        <span className="font-medium text-ink-2">{company.legalName ? `${company.brand} é operada por ${company.legalName}` : company.brand}</span>
        {company.cnpj && <span>CNPJ {company.cnpj}</span>}
        {company.address && <span>{company.address}</span>}
      </div>
      <nav className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/termos">Termos</Link>
        <Link href="/privacidade">Privacidade</Link>
        <Link href="/exclusao-de-dados">Exclusão de dados</Link>
        <a href={`mailto:${company.email}`}>{company.email}</a>
      </nav>
    </footer>
  );
}
