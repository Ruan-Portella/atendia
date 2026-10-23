import Link from "next/link";
import { Compass } from "lucide-react";
import { RedirectCountdown } from "@/components/redirect-countdown";
import { createClient } from "@/lib/supabase/server";
import { getMemberSession } from "@/lib/member";

export const metadata = { title: "Página não encontrada", robots: { index: false } };

/** Para onde voltar: quem está logado vai para o painel (ou para a área do cliente), não para o site. */
async function homeFor(): Promise<{ href: string; label: string; where: string }> {
  const { data } = await (await createClient()).auth.getClaims().catch(() => ({ data: null }));
  if (!data?.claims?.sub) return { href: "/", label: "Ir para o início agora", where: "o início" };
  if ((await getMemberSession())?.memberships.length) return { href: "/cliente", label: "Ir para a área do cliente", where: "a área do cliente" };
  return { href: "/painel", label: "Ir para o painel agora", where: "o painel" };
}

/** 404 geral do site: explica e volta sozinho (para o painel, se a pessoa estiver logada). */
export default async function NotFound() {
  const home = await homeFor();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-ground px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Compass size={26} /></span>
      <h1 className="text-2xl font-normal sm:text-[28px]">Não encontramos esta página</h1>
      <p className="max-w-sm text-sm text-muted">O endereço pode estar errado ou a página mudou de lugar. Voltando para {home.where} em <RedirectCountdown href={home.href} /> s.</p>
      <Link href={home.href} className="btn-primary">{home.label}</Link>
    </main>
  );
}
