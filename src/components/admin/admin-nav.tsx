"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BadgeDollarSign, Building2, ClipboardCheck, FileText, FlaskConical, Gauge, KeyRound, LayoutDashboard, ListOrdered, Map, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS: Array<{ href: string; label: string; exact?: boolean; icon: typeof Gauge }> = [
  { href: "/admin", label: "Visão geral", exact: true, icon: LayoutDashboard },
  { href: "/admin/clientes", label: "Agências", icon: Building2 },
  { href: "/admin/custos", label: "Custos", icon: Wallet },
  { href: "/admin/receita", label: "Receita", icon: BadgeDollarSign },
  { href: "/admin/notas", label: "Notas fiscais", icon: FileText },
  { href: "/admin/qualidade", label: "Qualidade", icon: Sparkles },
  { href: "/admin/avaliacao", label: "Avaliação da IA", icon: FlaskConical },
  { href: "/admin/operacao", label: "Operação", icon: Gauge },
  { href: "/admin/status", label: "Status", icon: Activity },
  { href: "/admin/segundo-fator", label: "Segundo fator", icon: KeyRound },
  { href: "/admin/lista-de-espera", label: "Lista de espera", icon: ListOrdered },
  { href: "/admin/conformidade", label: "Conformidade", icon: ShieldCheck },
  { href: "/admin/roadmap", label: "Roadmap", icon: Map },
];

/**
 * Navegação do backoffice. Redesenho (23/10/2026), no molde do menu do painel: no computador, a
 * coluna com os ícones; no celular, as pílulas que rolam de lado. `vertical` escolhe o jeito.
 */
export function AdminNav({ vertical = false }: { vertical?: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Backoffice" className={vertical ? "flex flex-col gap-0.5" : "-mx-1 flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]"}>
      {ITEMS.map(({ href, label, exact, icon: Icon }) => {
        const active = exact ? path === href : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 whitespace-nowrap text-sm transition-colors duration-[120ms]",
              vertical ? "rounded-[10px] px-2.5 py-2" : "rounded-full px-3 py-1.5",
              active ? (vertical ? "bg-raised font-medium text-ink" : "bg-ink font-medium text-ground") : "text-ink-2 hover:bg-raised/60 hover:text-ink",
            )}
          >
            {vertical && <Icon size={16} className={cn("shrink-0", active ? "text-brand" : "text-muted")} />}
            {label}
          </Link>
        );
      })}
      {vertical && (
        <span className="mt-3 flex items-center gap-2 px-2.5 text-[11px] text-muted">
          <ClipboardCheck size={13} />
          Só a equipe do BoaVoz
        </span>
      )}
    </nav>
  );
}
