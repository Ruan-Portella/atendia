"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { ChartColumn, CircleUser, Clock, GraduationCap, Inbox, LifeBuoy, LogOut, Menu as MenuIcon, MessageCircle, MessagesSquare, Radio, ShieldCheck, Users, X } from "lucide-react";
import { brandColor } from "@/lib/brand-color";
import { cn, initials } from "@/lib/utils";

export interface MemberNavProps {
  clientId: string;
  manager: boolean;
  handoff: boolean;
  knowledge: boolean;
  hours: boolean;
  waiting: number;
}

/**
 * Abas da área do cliente: só as que a agência liberou e o papel permite (leva B1'). O gestor vê
 * tudo; o atendente, só as conversas e o próprio perfil. Rodada 2 das telas (23/10/2026, a pedido
 * do usuário: "igual o padrão interno"): a coluna com os ícones, como no painel; no computador fica à
 * esquerda e, no celular, dentro do menu que desliza (MemberMobileBar).
 */
export function MemberNav({ clientId, manager, handoff, knowledge, hours, waiting, onNavigate }: MemberNavProps & { /** fecha o menu do celular ao escolher */ onNavigate?: () => void }) {
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
    <nav aria-label="Área do cliente" className="flex flex-col gap-0.5">
      {tabs.map(({ href, label, icon: Icon, active, badge }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          onClick={onNavigate}
          className={cn("flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[10px] px-2.5 py-2 text-sm transition-colors duration-[120ms]", active ? "bg-raised font-medium text-ink" : "text-ink-2 hover:bg-raised/60 hover:text-ink")}
        >
          <Icon size={16} className={cn("shrink-0", active ? "text-brand" : "text-muted")} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {badge ? <span className="rounded-full bg-amber-soft px-1.5 font-mono text-[11px] font-medium text-amber-ink">{badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** A marca da agência (o logo ou as iniciais na cor dela). */
export function AgencyMark({ agency, size = 30 }: { agency: { name: string; logo_url: string | null; brand_color: string }; size?: number }) {
  return agency.logo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={agency.logo_url} alt="" className="shrink-0 rounded-lg object-contain" style={{ width: size, height: size }} />
  ) : (
    <span className="display flex shrink-0 items-center justify-center rounded-lg text-[12px] font-bold text-white" style={{ width: size, height: size, background: brandColor(agency.brand_color) }}>
      {initials(agency.name)}
    </span>
  );
}

/** O "Falar com a agência", o Sair e o e-mail, no pé do menu. */
export function MemberMenuFoot({ agency, email, wa }: { agency: { brand_color: string }; email: string; wa: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      {wa && (
        <a href={wa} target="_blank" rel="noopener" className="btn-primary mb-1 justify-center" style={{ background: brandColor(agency.brand_color) }}>
          <MessageCircle size={15} />
          Falar com a agência
        </a>
      )}
      <form action="/cliente/sair" method="post">
        <button type="submit" className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm text-ink-2 transition-colors duration-[120ms] hover:bg-raised/60 hover:text-ink" title={email}>
          <LogOut size={16} className="shrink-0 text-muted" />
          Sair
        </button>
      </form>
      <span className="truncate px-2.5 text-[11px] text-muted" title={email}>
        {email}
      </span>
    </div>
  );
}

/**
 * O topo da área do cliente no celular e no tablet (rodada 2 das telas, 23/10/2026, a pedido do
 * usuário: "igual ao interno"): o botão do menu, a marca da agência e o WhatsApp dela; o menu
 * desliza da esquerda, como no painel.
 */
export function MemberMobileBar({ agency, clientName, email, wa, nav }: { agency: { name: string; logo_url: string | null; brand_color: string }; clientName: string; email: string; wa: string | null; nav: MemberNavProps }) {
  const [open, setOpen] = useState(false);
  const brand = (
    <span className="flex min-w-0 items-center gap-2.5">
      <AgencyMark agency={agency} size={30} />
      <span className="min-w-0 leading-tight">
        <span className="display block truncate text-sm font-bold">{agency.name}</span>
        <span className="block truncate text-[11px] text-muted">{clientName}</span>
      </span>
    </span>
  );
  return (
    <>
      <header className="flex h-[60px] shrink-0 items-center gap-1.5 bg-panel px-2.5 shadow-[inset_0_-1px_0_var(--color-line)] lg:hidden print:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menu" aria-expanded={open} className="btn-icon h-10 w-10">
          <MenuIcon size={20} />
        </button>
        <div className="min-w-0 flex-1">{brand}</div>
        {wa && (
          <a href={wa} target="_blank" rel="noopener" aria-label="Falar com a agência" title="Falar com a agência" className="btn-icon h-10 w-10">
            <MessageCircle size={18} />
          </a>
        )}
      </header>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Fechar menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-scrim [animation:fade-in_var(--dur-base)_var(--ease-out)]" />
          <aside className="menu-in absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col gap-4 bg-panel p-3 text-ink shadow-2xl">
            <div className="flex items-center justify-between gap-2 px-1 pt-1">
              {brand}
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="btn-icon h-9 w-9">
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <MemberNav {...nav} onNavigate={() => setOpen(false)} />
            </div>
            <MemberMenuFoot agency={agency} email={email} wa={wa} />
          </aside>
        </div>
      )}
    </>
  );
}
