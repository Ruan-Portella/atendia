"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, CircleUser, Inbox, LifeBuoy, LogOut, Megaphone, Milestone, MonitorSmartphone, Moon, Plus, Search, Settings, Sun, Users } from "lucide-react";
import { BotFace } from "@/components/bot-face";
import { Menu } from "@/components/ui/menu";
import { NoticeBell } from "@/components/notice-center";
import { chooseTema, useTema } from "@/components/theme";
import { DAY_TO_DAY, activeSettingsHref, allowed, firstSettingsHref } from "@/lib/nav";
import { can, type AgencyRole } from "@/lib/roles";
import { cn } from "@/lib/utils";

export interface SidebarClient {
  id: string;
  name: string;
  /** Cor do primeiro chatbot (o rosto do cliente no menu). */
  color: string | null;
  botIds: string[];
}

export interface SidebarPerson {
  name: string;
  email: string;
  avatarUrl: string | null;
}

interface Props {
  role: AgencyRole;
  packs?: string[];
  clients: SidebarClient[];
  clientCount: number;
  me: SidebarPerson;
  /** Vai logo acima do rodapé (o uso do mês). */
  extra?: React.ReactNode;
  /** Menu recolhido (só no computador): só os ícones, com o nome no title. */
  collapsed?: boolean;
  onNavigate?: () => void;
}

const ICONS = { inbox: Inbox, megaphone: Megaphone, users: Users } as const;
/** Quantos clientes cabem no menu; o resto fica em "Todos os clientes" e no Ir para. */
export const SIDEBAR_CLIENTS = 8;

/** Abre o Ir para (Ctrl K), que mora no PanelShell. */
export const openGoTo = () => window.dispatchEvent(new Event("bv-ir-para"));

/** Atendimentos esperando alguém da equipe: o HandoffWatcher avisa a cada consulta. */
function useWaiting() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const on = (e: Event) => setN(Number((e as CustomEvent<number>).detail) || 0);
    window.addEventListener("bv-esperando", on);
    return () => window.removeEventListener("bv-esperando", on);
  }, []);
  return n;
}

function itemClass(active: boolean, collapsed = false) {
  return cn(
    "group relative flex min-w-0 items-center rounded-[10px] text-sm transition-colors duration-[120ms]",
    collapsed ? "mx-auto h-10 w-10 justify-center" : "gap-2.5 px-2.5 py-2",
    active ? "bg-raised font-medium text-ink" : "text-ink-2 hover:bg-raised/60 hover:text-ink",
  );
}

const SectionLabel = ({ children, action, collapsed }: { children: React.ReactNode; action?: React.ReactNode; collapsed?: boolean }) =>
  collapsed ? (
    <div className="mx-auto my-2.5 h-px w-6 bg-line" aria-hidden />
  ) : (
    <div className="flex items-center justify-between px-2.5 pb-1 pt-4">
      <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted">{children}</span>
      {action}
    </div>
  );

/**
 * Navegação do painel (redesenho, etapa 1), no menu deslizante do celular e na barra do
 * computador: o dia a dia, os clientes como canais (com o rosto do chatbot) e, no rodapé,
 * Configurações, Ajuda e novidades e você (perfil, tema e sair). Recolhido, fica só com os ícones.
 */
export function SidebarNav({ role, packs = [], clients, clientCount, me, extra, collapsed = false, onNavigate }: Props) {
  const path = usePathname();
  const waiting = useWaiting();
  const tema = useTema();
  const signOut = useRef<HTMLFormElement>(null);
  const settingsHref = firstSettingsHref(role, packs);
  const inSettings = activeSettingsHref(path, role, packs) !== null;
  const openClient = clients.find((c) => path.startsWith(`/painel/clientes/${c.id}`) || c.botIds.some((b) => path.startsWith(`/painel/bots/${b}`)));
  const label = (text: string, cls = "min-w-0 flex-1 truncate") => <span className={collapsed ? "sr-only" : cls}>{text}</span>;

  const themeItem = (value: "escuro" | "claro" | "sistema", text: string, Icon: typeof Moon) => ({ label: text, icon: tema === value ? Check : Icon, onSelect: () => chooseTema(value) });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("mb-1 flex gap-1.5", collapsed ? "flex-col items-center" : "items-center")}>
        <button
          type="button"
          onClick={() => (onNavigate?.(), openGoTo())}
          title={collapsed ? "Ir para (Ctrl K)" : undefined}
          className={cn("flex items-center rounded-[10px] bg-field text-sm text-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors duration-[120ms] hover:text-ink", collapsed ? "h-10 w-10 justify-center" : "min-w-0 flex-1 gap-2 px-2.5 py-2 text-left")}
        >
          <Search size={15} className="shrink-0" />
          {label("Ir para…")}
          {!collapsed && <kbd className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">Ctrl K</kbd>}
        </button>
        {/* os avisos (cota, pagamento, canal, segurança…), que antes eram faixas fixas no topo */}
        <NoticeBell className="h-10 w-10 shrink-0" />
      </div>

      <nav aria-label="Principal" className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [scrollbar-width:thin]">
        <SectionLabel collapsed={collapsed}>Dia a dia</SectionLabel>
        <div className="flex flex-col gap-0.5">
          {DAY_TO_DAY.filter((i) => allowed(i, role, packs)).map((i) => {
            const Icon = ICONS[i.icon];
            // o editor do chatbot mora dentro do cliente: acende Clientes
            const active = (path.startsWith(i.href) || (i.href === "/painel/clientes" && path.startsWith("/painel/bots"))) && !openClient;
            return (
              <Link key={i.href} href={i.href} onClick={onNavigate} aria-current={active ? "page" : undefined} title={collapsed ? i.label : undefined} className={itemClass(active, collapsed)}>
                <Icon size={17} className={cn("shrink-0", active ? "text-brand" : "text-muted group-hover:text-ink-2")} />
                {label(i.label)}
                {i.icon === "inbox" && waiting > 0 && (
                  <span
                    key={waiting}
                    className={cn("rounded-full bg-amber font-mono font-medium text-ground [animation:bv-pop_var(--dur-slow)_var(--ease-spring)]", collapsed ? "absolute -right-0.5 -top-0.5 min-w-4 px-1 text-center text-[9.5px] leading-4" : "px-1.5 py-px text-[11px]")}
                    aria-label={`${waiting} esperando`}
                  >
                    {waiting}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {clients.length > 0 && (
          <>
            <SectionLabel
              collapsed={collapsed}
              action={
                can(role, "config") ? (
                  <Link href="/painel/clientes/novo" onClick={onNavigate} aria-label="Novo cliente" title="Novo cliente" className="btn-icon h-6 w-6">
                    <Plus size={14} />
                  </Link>
                ) : null
              }
            >
              Clientes
            </SectionLabel>
            <div className="flex flex-col gap-0.5">
              {clients.slice(0, SIDEBAR_CLIENTS).map((c) => {
                const active = openClient?.id === c.id;
                return (
                  <Link key={c.id} href={`/painel/clientes/${c.id}`} onClick={onNavigate} aria-current={active ? "page" : undefined} title={collapsed ? c.name : undefined} className={itemClass(active, collapsed)}>
                    <BotFace color={c.color} size={collapsed ? 24 : 20} alive={active} />
                    {label(c.name)}
                  </Link>
                );
              })}
              {clientCount > SIDEBAR_CLIENTS && (
                <Link href="/painel/clientes" onClick={onNavigate} title={collapsed ? `Todos os clientes (${clientCount})` : undefined} className={collapsed ? "mx-auto py-1 font-mono text-[11px] text-muted hover:text-ink" : "px-2.5 py-1.5 text-[13px] font-medium text-muted hover:text-ink"}>
                  {collapsed ? `+${clientCount - SIDEBAR_CLIENTS}` : `Todos os clientes (${clientCount})`}
                </Link>
              )}
            </div>
          </>
        )}
      </nav>

      {extra && !collapsed && <div className="mt-3">{extra}</div>}
      <div className="mt-3 flex flex-col gap-0.5 border-t border-line pt-3">
        {settingsHref && (
          <Link href={settingsHref} onClick={onNavigate} aria-current={inSettings ? "page" : undefined} title={collapsed ? "Configurações" : undefined} className={itemClass(inSettings, collapsed)}>
            <Settings size={17} className={cn("shrink-0", inSettings ? "text-brand" : "text-muted group-hover:text-ink-2")} />
            {label("Configurações", "")}
          </Link>
        )}
        <Menu
          align="left"
          label="Ajuda e novidades"
          triggerClassName={cn(itemClass(path.startsWith("/painel/roadmap"), collapsed), !collapsed && "w-full text-left")}
          trigger={
            <>
              <LifeBuoy size={17} className="shrink-0 text-muted group-hover:text-ink-2" />
              {label("Ajuda e novidades", "")}
            </>
          }
          items={[
            { label: "Central de ajuda", icon: LifeBuoy, href: "/ajuda" },
            { label: "Novidades e roadmap", icon: Milestone, href: "/painel/roadmap" },
          ]}
        />
        <Menu
          align="left"
          label="Você"
          triggerClassName={cn("mt-1 flex items-center rounded-[12px] text-left transition-colors duration-[120ms] hover:bg-raised/60", collapsed ? "mx-auto h-10 w-10 justify-center" : "w-full gap-2.5 px-2 py-2")}
          trigger={
            <>
              {me.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={me.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-[12px] font-semibold text-ink">{me.name.charAt(0).toUpperCase()}</span>
              )}
              <span className={collapsed ? "sr-only" : "min-w-0 flex-1 leading-tight"}>
                <span className="block truncate text-sm font-medium text-ink">{me.name}</span>
                <span className="block truncate text-[11.5px] text-muted">{me.email}</span>
              </span>
              {!collapsed && <ChevronsUpDown size={14} className="shrink-0 text-muted" />}
            </>
          }
          items={[
            { label: "Meu perfil", icon: CircleUser, href: "/painel/perfil" },
            { type: "separator" },
            themeItem("escuro", "Tema escuro", Moon),
            themeItem("claro", "Tema claro", Sun),
            themeItem("sistema", "Tema do aparelho", MonitorSmartphone),
            { type: "separator" },
            { label: "Sair", icon: LogOut, onSelect: () => signOut.current?.requestSubmit() },
          ]}
        />
        <form ref={signOut} action="/auth/signout" method="post" hidden />
      </div>
    </div>
  );
}
