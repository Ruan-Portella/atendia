import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { LegalFooter } from "@/components/legal-page";
import { DocsNav } from "./docs-nav";

/*
 * Peças da documentação pública (/docs, C pública parte 6): a casca com o menu, a página, os
 * títulos com âncora, o bloco de código, a tabela e o aviso. Só servidor, sem dependência nova.
 */

/** Casca: cabeçalho, menu (coluna no computador, faixa no celular), conteúdo e rodapé. */
export function DocsShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6 lg:px-10">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="hidden text-sm font-semibold text-muted sm:inline">Documentação</span>
        </div>
        <Link href="/painel" className="text-sm font-medium">
          Entrar no painel
        </Link>
      </header>
      <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-6 px-5 py-6 sm:px-6 lg:flex-row lg:gap-10 lg:px-10 lg:py-10">
        <aside className="lg:sticky lg:top-6 lg:w-[220px] lg:shrink-0 lg:self-start">
          <DocsNav />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <LegalFooter />
    </div>
  );
}

const PROSE =
  "flex flex-col gap-4 text-[15px] leading-relaxed text-ink-2 [&_a]:font-medium [&_a]:text-brand [&_a]:underline [&_ol>li]:ml-5 [&_ol>li]:list-decimal [&_ul>li]:ml-5 [&_ul>li]:list-disc [&_li]:mt-1 [&_strong]:text-ink [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-white [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-px [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[13px] [&_:not(pre)>code]:text-ink";

/** Página: título, introdução e o conteúdo em prosa. */
export function DocPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <article className="flex max-w-[760px] flex-col gap-8">
      <div className="flex flex-col gap-3">
        <span className="eyebrow">Documentação · Integrações</span>
        <h1 className="text-3xl font-bold leading-[1.1] md:text-[40px]">{title}</h1>
        {intro && <p className="text-[17px] leading-relaxed text-ink-2">{intro}</p>}
      </div>
      <div className={PROSE}>{children}</div>
    </article>
  );
}

/** Título de seção com âncora (o link do título copia o endereço da seção). */
export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="display scroll-mt-6 pt-4 text-xl font-bold text-ink">
      <a href={`#${id}`} className="!text-ink !no-underline">
        {children}
      </a>
    </h2>
  );
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-6 pt-2 text-base font-bold text-ink">
      {children}
    </h3>
  );
}

/** Bloco de código (o texto vai como está; rola para o lado se for largo). */
export function Code({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-[#13241d]">
      <div className="border-b border-white/10 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[#9fd3bf]">{lang}</div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed text-[#e6efeb]">
        <code>{code.trim()}</code>
      </pre>
    </div>
  );
}

/** Tabela simples (rola para o lado no celular). */
export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full min-w-[520px] border-collapse text-left text-[14px]">
        <thead>
          <tr className="border-b border-line bg-ground">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line-2 align-top last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Aviso destacado (regra que costuma pegar quem integra). */
export function Note({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#cfe3d9] bg-brand-soft px-4 py-3 text-[14px] text-ink-2">
      {title && <div className="mb-1 font-semibold text-brand">{title}</div>}
      {children}
    </div>
  );
}

/** Links para as outras páginas, no fim de cada uma. */
export function NextSteps({ items }: { items: Array<{ href: string; title: string; text: string }> }) {
  return (
    <div className="grid gap-3 pt-2 sm:grid-cols-2">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="rounded-xl border border-line bg-white p-4 !no-underline hover:border-brand">
          <div className="font-semibold text-ink">{i.title} →</div>
          <div className="text-sm text-muted">{i.text}</div>
        </Link>
      ))}
    </div>
  );
}
