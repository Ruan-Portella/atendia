"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Users, Sparkles, Inbox, Palette, Share2, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/painel", label: "Chatbots", icon: Bot, exact: true },
  { href: "/painel/demos", label: "Demos", icon: Sparkles },
  { href: "/painel/leads", label: "Leads", icon: Inbox },
  { href: "/painel/clientes", label: "Clientes", icon: Users },
  { href: "/painel/marca", label: "Marca e domínio", icon: Palette },
  { href: "/painel/afiliados", label: "Afiliados", icon: Share2 },
  { href: "/painel/cobranca", label: "Cobrança", icon: CreditCard },
];

/**
 * Navegação do painel. `compact` esconde os rótulos entre md e lg (trilho de ícones do tablet);
 * no menu do celular e no desktop os rótulos aparecem.
 */
export function SidebarNav({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? path === href || path.startsWith("/painel/bots") : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            title={compact ? label : undefined}
            aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors duration-[120ms]", compact && "md:justify-center md:px-0 lg:justify-start lg:px-3", active ? "bg-[#2f3733] font-semibold text-ground" : "font-medium text-[#c8cfcb] hover:bg-[#262c29]")}
          >
            <Icon size={17} className="shrink-0" />
            <span className={cn(compact && "md:hidden lg:inline")}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
