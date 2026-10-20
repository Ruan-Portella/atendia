"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Páginas da documentação, em grupos na ordem do menu (C pública, parte 6; molde novo da Entrada
 * e docs, parte 2: guias por perfil e uma página por assunto da API).
 */
export const DOCS_GROUPS = [
  {
    title: "Comece",
    pages: [
      { href: "/docs", title: "Visão geral" },
      { href: "/docs/guias/agencia", title: "Guia para agências" },
      { href: "/docs/guias/negocio", title: "Guia para o seu negócio" },
      { href: "/docs/guias/dev", title: "Guia para devs" },
      { href: "/docs/guias/plataforma", title: "Guia para plataformas" },
    ],
  },
  {
    title: "Integrações",
    pages: [
      { href: "/docs/comeco-rapido", title: "Primeira ação" },
      { href: "/docs/acoes", title: "Ações" },
      { href: "/docs/roteiros", title: "Roteiros" },
      { href: "/docs/mensagens-ricas", title: "Mensagens ricas" },
      { href: "/docs/webhooks", title: "Webhooks" },
      { href: "/docs/identificar-usuarios", title: "Identificar usuários" },
      { href: "/docs/apps", title: "Chat dentro de apps" },
      { href: "/docs/campanhas", title: "Campanhas e consentimento" },
      { href: "/docs/conceitos", title: "Conceitos" },
      { href: "/docs/seguranca", title: "Segurança" },
      { href: "/docs/exemplos", title: "Exemplos" },
    ],
  },
  {
    title: "API",
    pages: [
      { href: "/docs/api", title: "Chave, convenções e erros" },
      { href: "/docs/api/mensagens", title: "Mensagens" },
      { href: "/docs/api/conversas", title: "Conversas e pausa" },
      { href: "/docs/api/contatos", title: "Contatos e leads" },
      { href: "/docs/api/campanhas", title: "Campanhas e aceite" },
      { href: "/docs/api/pareamento", title: "Pareamento" },
      { href: "/docs/api/fontes", title: "Fontes" },
      { href: "/docs/api/provisionamento", title: "Lojas pela API" },
      { href: "/docs/api/cobranca", title: "Cobrança" },
    ],
  },
] as const;

/** Menu da documentação: coluna com grupos no computador, faixa que rola para o lado no celular. */
export function DocsNav() {
  const path = usePathname();
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const a = active.getBoundingClientRect();
    // a página aberta fica à vista: no celular o menu é uma faixa que rola para o lado; no
    // computador, uma coluna que rola por dentro quando não cabe na tela
    if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft += a.left - nav.getBoundingClientRect().left - (nav.clientWidth - a.width) / 2;
    const box = nav.parentElement;
    if (box && box.scrollHeight > box.clientHeight) box.scrollTop += a.top - box.getBoundingClientRect().top - (box.clientHeight - a.height) / 2;
  }, [path]);
  return (
    <nav ref={navRef} aria-label="Documentação" className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-4 lg:overflow-visible">
      {DOCS_GROUPS.map((g) => (
        <div key={g.title} className="flex shrink-0 gap-1 lg:flex-col">
          <span className="hidden px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted lg:block">{g.title}</span>
          {g.pages.map((p) => {
            const active = path === p.href;
            return (
              <Link
                key={p.href}
                href={p.href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${active ? "bg-brand-soft font-semibold text-brand" : "text-ink-2 hover:bg-white"}`}
              >
                {p.title}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
