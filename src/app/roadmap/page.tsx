import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { LegalFooter } from "@/components/legal-page";
import { RoadmapBoard } from "@/components/roadmap/roadmap-board";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadRoadmap } from "@/lib/roadmap";

export const metadata: Metadata = {
  title: "Roadmap",
  description: "O que o BoaVoz está fazendo e o que vem por aí: ideias, o que vamos fazer, o que está em construção e o que já está pronto.",
};

// as curtidas e a moderação também atualizam na hora (revalidatePath nas ações)
export const revalidate = 300;

/**
 * Roadmap público (Lançamento, parte 5): aberto, só no domínio do BoaVoz (no domínio da agência, o
 * proxy mostra a página neutra). Curtir e mandar ideias é no painel.
 */
export default async function RoadmapPage() {
  const items = await loadRoadmap(createAdminClient());
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6 lg:px-10">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="hidden text-sm font-semibold text-muted sm:inline">Roadmap</span>
        </div>
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link href="/ajuda" className="hidden sm:inline">
            Central de ajuda
          </Link>
          <Link href="/painel/roadmap">Entrar no painel</Link>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-8 px-5 py-8 sm:px-6 lg:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex max-w-[640px] flex-col gap-2">
            <h1 className="display text-3xl font-normal sm:text-4xl">O que vem por aí</h1>
            <p className="text-[15px] text-ink-2">
              O que estamos fazendo no BoaVoz, sem datas: a ordem muda com o que os clientes pedem. Quem tem conta curte o que mais quer e manda ideias pelo painel.
            </p>
          </div>
          <Link href="/painel/roadmap" className="btn-primary">Curtir e mandar ideias</Link>
        </div>
        <RoadmapBoard items={items} />
      </main>
      <LegalFooter />
    </div>
  );
}
