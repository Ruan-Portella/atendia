"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { SidebarNav, openGoTo, type SidebarClient, type SidebarPerson } from "@/components/sidebar-nav";
import { NoticeBell, NoticeCenter } from "@/components/notice-center";
import { can, type AgencyRole } from "@/lib/roles";
import { MENU_COOKIE } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface Props {
  agency: { name: string; logo_url: string | null; brand_color: string; initials: string };
  /** papel de quem está logado: o menu e o bloco de uso seguem o que ele pode ver */
  role: AgencyRole;
  /** Pacotes da conta: o menu mostra o que depende deles (os modelos, do Plataforma). */
  packs?: string[];
  /** vê todos os clientes da conta */
  wholeAccount?: boolean;
  /** "Conta grátis", "Assinatura" ou "Pagamento atrasado". */
  accountLabel: string;
  usage: number;
  limit: number;
  usageLabel: string; // "1.240 / 2.000"
  /** Clientes no menu (os primeiros) e o total. */
  clients?: SidebarClient[];
  clientCount?: number;
  me?: SidebarPerson;
  /** O Ir para (Ctrl K): fica montado aqui e abre pelo atalho ou pelo botão do menu. */
  goTo?: React.ReactNode;
  /** O menu do computador começa recolhido (o cookie da pessoa). */
  menuCollapsed?: boolean;
  children: React.ReactNode;
  /** Os avisos (plano, pausa, suspensão, segurança…): ficam nos Avisos, atrás do sino. */
  notices?: React.ReactNode;
}

/**
 * Casca do painel em dois tamanhos (redesenho, etapa 1):
 *  - celular e tablet (< lg): barra no topo com o menu, a conta e a busca; o menu desliza;
 *  - desktop (lg+): barra lateral fixa com a navegação inteira.
 */
export function PanelShell({ agency, role, packs = [], wholeAccount = true, accountLabel, usage, limit, usageLabel, clients = [], clientCount = 0, me = { name: "Você", email: "", avatarUrl: null }, goTo, menuCollapsed = false, children, notices }: Props) {
  const [open, setOpen] = useState(false);
  // recolher o menu do computador (redesenho): só os ícones; a escolha fica no navegador
  const [collapsed, setCollapsed] = useState(menuCollapsed);
  const toggleMenu = () => setCollapsed((c) => !c);
  useEffect(() => {
    document.cookie = `${MENU_COOKIE}=${collapsed ? "fechado" : "aberto"}; path=/; max-age=31536000; samesite=lax`;
  }, [collapsed]);
  // Ctrl B (⌘B no Mac): recolhe e abre o menu no computador; no celular, abre e fecha o menu deslizante
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "b") return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      if (window.matchMedia("(min-width: 1024px)").matches) setCollapsed((c) => !c);
      else setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const pct = Math.min(100, Math.round((usage / Math.max(1, limit)) * 100));

  const brandBlock = (small = false) => (
    <Link href="/painel/clientes" onClick={() => setOpen(false)} title={small ? agency.name : undefined} className={cn("flex min-w-0 items-center gap-2.5 rounded-[12px] py-1 transition-colors duration-[120ms] hover:bg-raised/60", small ? "justify-center px-1" : "px-1.5")}>
      {agency.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={agency.logo_url} alt="" className="h-8 w-8 shrink-0 rounded-[10px] object-cover" />
      ) : (
        <span className="display flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[13px] font-semibold text-white" style={{ background: agency.brand_color === "#1f4e3d" ? "#17845a" : agency.brand_color }}>{agency.initials}</span>
      )}
      <span className={small ? "sr-only" : "min-w-0 leading-tight"}>
        <span className="block truncate text-sm font-semibold text-ink">{agency.name}</span>
        <span className="block font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">{accountLabel}</span>
      </span>
    </Link>
  );

  // cota do mês: quem configura acompanha; uso e custo (cobrança) é do dono
  const usageBlock = can(role, "config") ? (
    <div className="flex flex-col gap-2 rounded-[12px] bg-field px-3 py-3 text-xs text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div className="flex items-baseline justify-between gap-2"><span>Atendimentos do mês</span><span className="font-mono text-[11px] text-ink tabular">{usageLabel}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-raised"><div className="h-full origin-left rounded-full bg-brand [animation:bv-grow_var(--dur-slow)_var(--ease-out)]" style={{ width: `${pct}%` }} /></div>
      {can(role, "billing") && <Link href="/painel/cobranca/uso" onClick={() => setOpen(false)} className="font-medium text-brand hover:text-brand-2">Uso e custo</Link>}
    </div>
  ) : null;

  const nav = (small: boolean) => <SidebarNav role={role} packs={packs} wholeAccount={wholeAccount} clients={clients} clientCount={clientCount} me={me} extra={usageBlock} collapsed={small} onNavigate={() => setOpen(false)} />;

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      {/* barra do celular */}
      <header className="sticky top-0 z-40 flex h-[60px] items-center gap-1.5 bg-panel/95 px-2.5 text-ink shadow-[inset_0_-1px_0_var(--color-line)] backdrop-blur lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menu" aria-expanded={open} className="btn-icon h-10 w-10">
          <MenuIcon size={20} />
        </button>
        <div className="min-w-0 flex-1">{brandBlock()}</div>
        <NoticeBell className="h-10 w-10" />
        <button type="button" onClick={openGoTo} aria-label="Ir para" className="btn-icon h-10 w-10">
          <Search size={18} />
        </button>
      </header>

      {/* menu deslizante (celular) */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Fechar menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-scrim [animation:fade-in_var(--dur-base)_var(--ease-out)]" />
          <aside className="menu-in absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col gap-3 bg-panel p-3 text-ink shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              {brandBlock()}
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="btn-icon h-9 w-9"><X size={18} /></button>
            </div>
            {nav(false)}
          </aside>
        </div>
      )}

      {/* barra lateral do computador: altura da tela e presa no topo */}
      <aside className={cn("hidden shrink-0 flex-col gap-3 bg-panel p-3 text-ink shadow-[inset_-1px_0_0_var(--color-line)] transition-[width] duration-[220ms] ease-[var(--ease-out)] lg:sticky lg:top-0 lg:flex lg:h-dvh", collapsed ? "w-[68px] px-2" : "w-[256px]")}>
        <div className={cn("flex items-center gap-1 pt-1", collapsed && "flex-col")}>
          <div className="min-w-0 flex-1">{brandBlock(collapsed)}</div>
          <button type="button" onClick={toggleMenu} aria-label={collapsed ? "Abrir o menu" : "Recolher o menu"} aria-keyshortcuts="Control+B" title={collapsed ? "Abrir o menu (Ctrl B)" : "Recolher o menu (Ctrl B)"} aria-expanded={!collapsed} className="btn-icon h-8 w-8 shrink-0">
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        {nav(collapsed)}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex min-w-0 flex-1 flex-col gap-5 px-4 py-5 sm:px-6 sm:py-7 md:gap-6 lg:px-9">{children}</main>
      </div>
      {goTo}
      <NoticeCenter>{notices}</NoticeCenter>
    </div>
  );
}
