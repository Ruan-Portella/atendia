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

export function SidebarNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-row flex-wrap gap-1 md:flex-col">
      {ITEMS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? path === href || path.startsWith("/painel/bots") : path.startsWith(href);
        return (
          <Link key={href} href={href} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm", active ? "bg-[#2f3733] font-semibold text-ground" : "font-medium text-[#c8cfcb] hover:bg-[#262c29]")}>
            <Icon size={16} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
