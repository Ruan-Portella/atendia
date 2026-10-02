"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: "/admin", label: "Visão geral", exact: true },
  { href: "/admin/clientes", label: "Clientes" },
  { href: "/admin/custos", label: "Custos" },
  { href: "/admin/receita", label: "Receita" },
  { href: "/admin/qualidade", label: "Qualidade" },
  { href: "/admin/avaliacao", label: "Avaliação da IA" },
  { href: "/admin/operacao", label: "Operação" },
  { href: "/admin/conformidade", label: "Conformidade" },
];

/** Navegação do backoffice (rola de lado no celular). */
export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="-mx-1 flex min-w-0 gap-1 overflow-x-auto">
      {ITEMS.map(({ href, label, exact }) => {
        const active = exact ? path === href : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors duration-[120ms]", active ? "bg-ink font-semibold text-ground" : "font-medium text-muted hover:bg-ground hover:text-ink")}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
