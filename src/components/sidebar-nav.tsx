"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Sparkles, Palette, Share2, CreditCard, ShieldCheck, UsersRound, CircleUser, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { can, type AgencyRole, type Permission } from "@/lib/roles";

/** Itens do menu e quem vê cada um (equipe, leva B1'). */
const ITEMS: Array<{ href: string; label: string; icon: typeof Users; perm: Permission; also?: string }> = [
  { href: "/painel/clientes", label: "Clientes", icon: Users, perm: "attend", also: "/painel/bots" },
  { href: "/painel/integracoes", label: "Integrações", icon: Plug, perm: "integrations" },
  { href: "/painel/demos", label: "Demos", icon: Sparkles, perm: "config" },
  { href: "/painel/marca", label: "Marca e domínio", icon: Palette, perm: "brand" },
  { href: "/painel/equipe", label: "Equipe", icon: UsersRound, perm: "team" },
  { href: "/painel/seguranca", label: "Segurança", icon: ShieldCheck, perm: "security" },
  { href: "/painel/afiliados", label: "Afiliados", icon: Share2, perm: "billing" },
  { href: "/painel/cobranca", label: "Cobrança", icon: CreditCard, perm: "billing" },
  { href: "/painel/perfil", label: "Meu perfil", icon: CircleUser, perm: "attend" },
];

/** Navegação do painel (menu deslizante no celular/tablet, sidebar no desktop). */
export function SidebarNav({ role, onNavigate }: { role: AgencyRole; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.filter((i) => can(role, i.perm)).map(({ href, label, icon: Icon, also }) => {
        // chatbots moram dentro do cliente, então o editor de bot acende "Clientes"
        const active = path.startsWith(href) || (also ? path.startsWith(also) : false);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors duration-[120ms]", active ? "bg-[#2f3733] font-semibold text-ground" : "font-medium text-[#c8cfcb] hover:bg-[#262c29]")}
          >
            <Icon size={17} className="shrink-0" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
