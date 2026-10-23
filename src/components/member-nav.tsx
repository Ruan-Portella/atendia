"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Abas da área do cliente: só as que a agência liberou e o papel permite (leva B1'). O gestor vê
 * tudo; o atendente, só as conversas e o próprio perfil.
 */
export function MemberNav({ clientId, manager, handoff, knowledge, hours, waiting }: { clientId: string; manager: boolean; handoff: boolean; knowledge: boolean; hours: boolean; waiting: number }) {
  const path = usePathname();
  const base = `/cliente/${clientId}`;
  const tab = (href: string, label: string, badge = 0) => ({ href, label, active: href === base ? path === base : path.startsWith(href), badge });
  const tabs = [
    ...(manager ? [tab(base, "Relatório")] : []),
    // Caixa de entrada (parte 3): o atendimento aberto, em filas; Conversas fica com o histórico
    ...(handoff ? [tab(`${base}/caixa`, "Caixa de entrada", waiting)] : []),
    tab(`${base}/conversas`, "Conversas"),
    ...(manager && knowledge ? [tab(`${base}/aprender`, "Ensinar o assistente")] : []),
    ...(manager && hours ? [tab(`${base}/horario`, "Horário")] : []),
    ...(manager ? [tab(`${base}/equipe`, "Equipe"), tab(`${base}/canais`, "Canais"), tab(`${base}/privacidade`, "Privacidade")] : []),
    tab(`${base}/perfil`, "Meu perfil"),
    tab(`${base}/ajuda`, "Ajuda"),
  ];
  return (
    // redesenho (23/10/2026): as abas em pílulas, como no painel
    <nav className="mx-auto flex max-w-[980px] gap-1 overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:px-6 print:hidden">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined} className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition-colors duration-[120ms]", t.active ? "bg-ink font-medium text-ground" : "text-ink-2 hover:bg-raised hover:text-ink")}>
          {t.label}
          {t.badge ? <span className={cn("rounded-full px-1.5 font-mono text-[11px] font-medium", t.active ? "bg-amber text-ground" : "bg-amber-soft text-amber-ink")}>{t.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
