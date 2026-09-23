"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu as MenuIcon, X, LogOut } from "lucide-react";
import { SidebarNav } from "@/components/sidebar-nav";
import { cn } from "@/lib/utils";

interface Props {
  agency: { name: string; logo_url: string | null; brand_color: string; initials: string };
  planName: string;
  trialDays: number | null;
  usage: number;
  limit: number;
  usageLabel: string; // "1.240 / 2.000"
  children: React.ReactNode;
}

/**
 * Casca do painel em dois tamanhos:
 *  - celular e tablet (< lg): barra no topo com botão hambúrguer + menu lateral deslizante;
 *  - desktop (lg+): sidebar completa.
 */
export function PanelShell({ agency, planName, trialDays, usage, limit, usageLabel, children }: Props) {
  const [open, setOpen] = useState(false);
  const pct = Math.min(100, Math.round((usage / Math.max(1, limit)) * 100));

  const brandBlock = (
    <Link href="/painel/clientes" onClick={() => setOpen(false)} className="flex min-w-0 items-center gap-2.5 px-2 py-1">
      {agency.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={agency.logo_url} alt="" className="h-7 w-7 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="display flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-ink" style={{ background: agency.brand_color === "#1f4e3d" ? "#e9a23b" : agency.brand_color }}>{agency.initials}</span>
      )}
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold">{agency.name}</span>
        <span className="block text-[11px] text-[#9aa39e]">Plano {planName}{trialDays !== null ? ` · ${trialDays} dias` : ""}</span>
      </span>
    </Link>
  );

  const usageBlock = (
    <div className="flex flex-col gap-2 rounded-[10px] bg-[#262c29] px-3 py-3.5 text-xs text-[#c8cfcb]">
      <div className="flex justify-between"><span>Conversas do mês</span><span className="font-semibold text-ground tabular">{usageLabel}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#3a423e]"><div className="h-full bg-brand-tint" style={{ width: `${pct}%` }} /></div>
      <Link href="/painel/cobranca" onClick={() => setOpen(false)} className="font-semibold text-brand-tint">Ver plano</Link>
    </div>
  );

  const signOut = (
    <form action="/auth/signout" method="post" className="px-2 pt-2">
      <button type="submit" className="flex items-center gap-2 text-xs text-[#9aa39e] hover:text-ground"><LogOut size={14} />Sair</button>
    </form>
  );

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      {/* barra do celular */}
      <header className="sticky top-0 z-40 flex items-center gap-2 bg-ink px-3 py-2.5 text-ground lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menu" aria-expanded={open} className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-[#262c29]">
          <MenuIcon size={20} />
        </button>
        <div className="min-w-0 flex-1">{brandBlock}</div>
        <Link href="/painel/cobranca" className="rounded-full bg-[#262c29] px-2.5 py-1 text-[11px] font-semibold text-[#c8cfcb] tabular">{pct}%</Link>
      </header>

      {/* menu deslizante (celular) */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Fechar menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/50" />
          <aside className="menu-in absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col gap-1.5 bg-ink p-4 text-ground shadow-2xl">
            <div className="flex items-center justify-between pb-3">
              {brandBlock}
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[#262c29]"><X size={18} /></button>
            </div>
            <SidebarNav onNavigate={() => setOpen(false)} />
            <div className="mt-auto flex flex-col gap-2">{usageBlock}{signOut}</div>
          </aside>
        </div>
      )}

      {/* sidebar do desktop */}
      {/* altura da tela e presa no topo: em página longa ela não estica junto com o conteúdo */}
      <aside className={cn("hidden w-60 shrink-0 flex-col gap-1.5 bg-ink p-4 text-ground lg:sticky lg:top-0 lg:flex lg:h-dvh lg:overflow-y-auto")}>
        <div className="pb-4 pt-1">{brandBlock}</div>
        <SidebarNav />
        <div className="mt-auto">{usageBlock}</div>
        {signOut}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-5 px-4 py-5 sm:px-6 sm:py-7 md:gap-6 lg:px-9">{children}</main>
    </div>
  );
}
