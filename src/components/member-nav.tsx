"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartColumn, CircleUser, Clock, GraduationCap, Inbox, LifeBuoy, MessagesSquare, Radio, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Abas da área do cliente: só as que a agência liberou e o papel permite (leva B1'). O gestor vê
 * tudo; o atendente, só as conversas e o próprio perfil. Rodada 2 das telas (23/10/2026, a pedido
 * do usuário: "igual o padrão interno"): no computador, a coluna com os ícones, como no painel; no
 * celular, as pílulas que rolam de lado. `vertical` escolhe o jeito.
 */
export function MemberNav({ clientId, manager, handoff, knowledge, hours, waiting, vertical = false }: { clientId: string; manager: boolean; handoff: boolean; knowledge: boolean; hours: boolean; waiting: number; vertical?: boolean }) {
  const path = usePathname();
  const base = `/cliente/${clientId}`;
  const tab = (href: string, label: string, icon: typeof Inbox, badge = 0) => ({ href, label, icon, active: href === base ? path === base : path.startsWith(href), badge });
  const tabs = [
    ...(manager ? [tab(base, "Relatório", ChartColumn)] : []),
    // Caixa de entrada (parte 3): o atendimento aberto, em filas; Conversas fica com o histórico
    ...(handoff ? [tab(`${base}/caixa`, "Caixa de entrada", Inbox, waiting)] : []),
    tab(`${base}/conversas`, "Conversas", MessagesSquare),
    ...(manager && knowledge ? [tab(`${base}/aprender`, "Ensinar o assistente", GraduationCap)] : []),
    ...(manager && hours ? [tab(`${base}/horario`, "Horário", Clock)] : []),
    ...(manager ? [tab(`${base}/equipe`, "Equipe", Users), tab(`${base}/canais`, "Canais", Radio), tab(`${base}/privacidade`, "Privacidade", ShieldCheck)] : []),
    tab(`${base}/perfil`, "Meu perfil", CircleUser),
    tab(`${base}/ajuda`, "Ajuda", LifeBuoy),
  ];
  return (
    <nav aria-label="Área do cliente" className={vertical ? "flex flex-col gap-0.5" : "-mx-1 flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] print:hidden"}>
      {tabs.map(({ href, label, icon: Icon, active, badge }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex shrink-0 items-center gap-2.5 whitespace-nowrap text-sm transition-colors duration-[120ms]",
            vertical ? "rounded-[10px] px-2.5 py-2" : "rounded-full px-3.5 py-1.5",
            active ? (vertical ? "bg-raised font-medium text-ink" : "bg-ink font-medium text-ground") : "text-ink-2 hover:bg-raised/60 hover:text-ink",
          )}
        >
          {vertical && <Icon size={16} className={cn("shrink-0", active ? "text-brand" : "text-muted")} />}
          <span className={vertical ? "min-w-0 flex-1 truncate" : undefined}>{label}</span>
          {badge ? <span className={cn("rounded-full px-1.5 font-mono text-[11px] font-medium", active && !vertical ? "bg-amber text-ground" : "bg-amber-soft text-amber-ink")}>{badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
