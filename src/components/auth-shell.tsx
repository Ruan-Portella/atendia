import { Check } from "lucide-react";
import { Logo, LogoMark } from "@/components/logo";

const brand = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Boavoz";

const POINTS = ["Um assistente de IA com a sua marca no site, no WhatsApp e no Instagram", "A equipe assume a conversa quando precisa, numa caixa de entrada só", "Teste grátis, sem cartão: monte e converse antes de assinar"];

/**
 * A casca das telas de entrada (redesenho, 23/10/2026): no computador, o painel da marca à esquerda
 * (o que o BoaVoz faz, em três linhas) e o formulário à direita; no celular, só o logo e o formulário.
 */
export function AuthShell({ headline, children }: { headline: string; children: React.ReactNode }) {
  return (
    <main className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section aria-hidden className="relative hidden overflow-hidden bg-[linear-gradient(160deg,#0d4e35,#17845a_55%,#1f9a69)] p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <span className="flex items-center gap-2.5">
          <LogoMark size={32} />
          <span className="display text-[22px] font-bold tracking-[-0.02em]">{brand === "Boavoz" ? "boavoz" : brand}</span>
        </span>
        <div className="flex max-w-[440px] flex-col gap-6">
          <h2 className="text-[34px] font-normal leading-[1.1]" style={{ textWrap: "balance" }}>
            {headline}
          </h2>
          <ul className="flex flex-col gap-3">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3 text-[15px] leading-snug text-white/90">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <Check size={13} />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/60">Atendimento ao cliente com a sua marca.</p>
        <span className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-white/[0.06]" />
        <span className="pointer-events-none absolute -right-10 top-1/3 h-40 w-40 rounded-full bg-white/[0.05]" />
      </section>
      <section className="flex flex-col items-center justify-center gap-8 px-4 py-12 sm:py-16">
        <span className="lg:hidden">
          <Logo />
        </span>
        {children}
      </section>
    </main>
  );
}
