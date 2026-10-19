import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { LegalFooter } from "@/components/legal-page";
import { DocsNav } from "./docs-nav";
import { ApiExample } from "./api-example";
import { PACKS } from "@/lib/plans";
import { curlOf, examplesFor, fetchOf, responseOf } from "@/lib/docs-examples";

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
        <aside className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:w-[220px] lg:shrink-0 lg:self-start lg:overflow-y-auto">
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
export function DocPage({ title, intro, eyebrow = "Documentação · Integrações", children }: { title: string; intro?: ReactNode; eyebrow?: string; children: ReactNode }) {
  return (
    <article className="flex max-w-[760px] flex-col gap-8">
      <div className="flex flex-col gap-3">
        <span className="eyebrow">{eyebrow}</span>
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

/**
 * Exemplo de uma rota (cURL e JavaScript, com o botão de copiar, e a resposta), da mesma fonte da
 * coleção do Postman: docs/postman/gerar_colecao.py.
 */
export function Example({ page, id }: { page: string; id: string }) {
  const [ex] = examplesFor(page, [id]);
  return <ApiExample title={ex.title} curl={curlOf(ex)} js={fetchOf(ex)} status={ex.status} response={responseOf(ex)} />;
}

/** O que a chave precisa para as rotas da página: a permissão e o pacote da conta. */
export function Access({ permission, extra }: { permission: string; extra?: ReactNode }) {
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-white px-4 py-3 text-[14px] sm:grid-cols-[auto_1fr] sm:gap-x-4">
      <span className="font-semibold text-ink">Permissão da chave</span>
      <span>
        <code>{permission}</code>
        {extra && <> · {extra}</>}
      </span>
      <span className="font-semibold text-ink">Pacote</span>
      <span>
        {PACKS.integracoes.name} (R$ {PACKS.integracoes.priceBrl} por mês, por conta). Sem ele, a API responde <code>403 plan_not_allowed</code>.
      </span>
    </div>
  );
}

/** Título de uma rota: o método e o caminho, com âncora. */
export function Route({ id, method, path }: { id: string; method: string; path: string }) {
  return (
    <h3 id={id} className="flex scroll-mt-6 flex-wrap items-center gap-2 pt-4 text-base font-bold text-ink">
      <span className="rounded-md bg-brand px-2 py-0.5 font-mono text-[12px] font-semibold text-ground">{method}</span>
      <a href={`#${id}`} className="font-mono text-[15px] !text-ink !no-underline">
        {path}
      </a>
    </h3>
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
