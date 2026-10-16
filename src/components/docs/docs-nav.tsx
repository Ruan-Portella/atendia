"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Páginas da documentação, na ordem do menu (C pública, parte 6). */
export const DOCS_PAGES = [
  { href: "/docs", title: "Visão geral" },
  { href: "/docs/comeco-rapido", title: "Começo rápido" },
  { href: "/docs/acoes", title: "Ações" },
  { href: "/docs/mensagens-ricas", title: "Mensagens ricas" },
  { href: "/docs/webhooks", title: "Webhooks" },
  { href: "/docs/api", title: "Referência da API" },
  { href: "/docs/conceitos", title: "Conceitos" },
  { href: "/docs/seguranca", title: "Segurança" },
  { href: "/docs/identificar-usuarios", title: "Identificar usuários" },
  { href: "/docs/campanhas", title: "Campanhas e consentimento" },
  { href: "/docs/exemplos", title: "Exemplos" },
] as const;

/** O que ainda vai entrar (sem link até a página existir). */
// Plataformas (bot modelo, provisionamento, webview): leva D'
export const DOCS_SOON = ["Plataformas"] as const;

/** Menu da documentação: coluna no computador, faixa que rola para o lado no celular. */
export function DocsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Documentação" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {DOCS_PAGES.map((p) => {
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
      <div className="hidden flex-col gap-1 pt-4 lg:flex">
        <span className="px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Em breve</span>
        {DOCS_SOON.map((t) => (
          <span key={t} className="px-3 py-1 text-sm text-muted">
            {t}
          </span>
        ))}
      </div>
    </nav>
  );
}
