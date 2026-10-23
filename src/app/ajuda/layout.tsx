import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { LegalFooter } from "@/components/legal-page";

/*
 * Central de ajuda de quem usa o painel (Lançamento, parte 2): aberta sem login, só no domínio do
 * BoaVoz (no domínio da agência, o proxy mostra a página neutra). O cliente da agência tem os
 * guias dele dentro do portal, com a marca da agência.
 */
export const metadata: Metadata = {
  title: { default: "Central de ajuda", template: "%s · Central de ajuda BoaVoz" },
  description: "Como usar o painel do BoaVoz: chatbots, canais, atendimento, equipe, campanhas e cobrança.",
};

export default function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6 lg:px-10">
        <div className="flex items-center gap-3">
          <Logo />
          <Link href="/ajuda" className="hidden text-sm font-semibold text-muted hover:text-ink sm:inline">
            Central de ajuda
          </Link>
        </div>
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link href="/docs" className="hidden sm:inline">
            Documentação
          </Link>
          <Link href="/painel">Entrar no painel</Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1040px] flex-1 px-4 py-8 sm:px-6 lg:py-12">{children}</main>
      <LegalFooter />
    </div>
  );
}
