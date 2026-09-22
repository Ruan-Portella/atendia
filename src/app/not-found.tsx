import Link from "next/link";
import { Compass } from "lucide-react";
import { RedirectCountdown } from "@/components/redirect-countdown";

export const metadata = { title: "Página não encontrada", robots: { index: false } };

/** 404 geral do site: explica e volta para o início sozinho. */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-ground px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Compass size={26} /></span>
      <h1 className="text-2xl font-bold sm:text-[28px]">Não encontramos esta página</h1>
      <p className="max-w-sm text-sm text-muted">O endereço pode estar errado ou a página mudou de lugar. Voltando para o início em <RedirectCountdown href="/" /> s.</p>
      <Link href="/" className="btn-primary">Ir para o início agora</Link>
    </main>
  );
}
