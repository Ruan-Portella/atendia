import Link from "next/link";
import { ArrowRight, Camera, Check, Globe, MessageCircle, Palette } from "lucide-react";
import { BotFace } from "@/components/bot-face";
import { Kpi } from "@/components/kpi";
import { Status } from "@/components/status";
import { num } from "@/lib/plans";
import { cn, relativeTime } from "@/lib/utils";

export interface OverviewProps {
  botId: string;
  name: string;
  clientName: string;
  status: string;
  color: string;
  face: unknown;
  paused: boolean;
  readySources: number;
  /** quem configura vê o que falta e os links para ajustar */
  canConfig: boolean;
  stats: { conversations: number; leads: number; needsHuman: number };
  /** conversas esperando alguém da equipe agora */
  waiting: number;
  quota: { used: number; quota: number; sizeLabel: string } | null;
  /** o dono escolhe o tamanho (Cobrança) */
  canBill: boolean;
  site: { host: string; lastSeen: string | null } | null;
  /** null: o canal não está liberado para a conta */
  whatsapp: { label: string | null; connected: boolean } | null;
  instagram: { label: string | null; connected: boolean } | null;
  hasFace: boolean;
}

function ChannelRow({ icon: Icon, name, state, href, ok }: { icon: typeof Globe; name: string; state: string; href: string; ok: boolean }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-[12px] px-2.5 py-2 transition-colors duration-[120ms] hover:bg-raised/60">
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]", ok ? "bg-brand-soft text-brand" : "bg-raised text-muted")}>
        <Icon size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-ink">{name}</span>
        <span className="truncate text-[12.5px] text-muted">{state}</span>
      </span>
      <ArrowRight size={15} className="shrink-0 text-muted transition-transform duration-[120ms] group-hover:translate-x-0.5 group-hover:text-ink" />
    </Link>
  );
}

/**
 * Visão geral do chatbot (redesenho, etapa 3): o rosto, a situação, os números do mês, os canais e
 * o que falta para ele ficar pronto, cada coisa com o atalho para a seção onde se resolve.
 */
export function BotOverview(p: OverviewProps) {
  const tab = (t: string) => `/painel/bots/${p.botId}?tab=${t}`;
  const resolved = p.stats.conversations ? Math.round(100 - (p.stats.needsHuman / p.stats.conversations) * 100) : 100;
  const channelOn = Boolean(p.site) || Boolean(p.whatsapp?.connected) || Boolean(p.instagram?.connected);
  const todo = [
    { done: p.readySources > 0, label: "Base de conhecimento com uma fonte pronta", hint: "site, PDF, planilha ou texto do negócio", href: tab("fontes") },
    { done: p.hasFace, label: "Rosto e aparência", hint: "a cor, os olhos e o balão do site", href: tab("aparencia") },
    { done: Boolean(p.quota && p.quota.sizeLabel !== "sem tamanho"), label: "Tamanho escolhido", hint: "sem tamanho, ele não liga nos canais", href: p.canBill ? "/painel/cobranca" : tab("visao") },
    { done: channelOn, label: "Um canal ligado", hint: "chat do site, WhatsApp ou Instagram", href: tab("instalacao") },
    { done: p.status === "live", label: "No ar", hint: "o botão Publicar, no alto", href: tab("visao") },
  ];
  const missing = todo.filter((t) => !t.done).length;
  const pct = p.quota && p.quota.quota > 0 ? Math.min(100, Math.round((p.quota.used / p.quota.quota) * 100)) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-5 rounded-[18px] bg-panel p-5 shadow-[inset_0_0_0_1px_var(--color-line),inset_0_1px_0_var(--highlight)]">
        <BotFace color={p.color} face={p.face} size={84} alive className="mt-4" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="truncate font-display text-[28px] font-light leading-tight">{p.name}</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>{p.clientName}</span>
            <Status status={p.status} />
            {p.paused && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">IA pausada</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {p.canConfig && (
              <Link href={tab("aparencia")} className="btn-ghost px-3 py-1.5 text-[13px]">
                <Palette size={14} />
                Mudar o rosto
              </Link>
            )}
            <Link href="/painel/caixa?fila=todas" className={cn("px-3 py-1.5 text-[13px]", p.waiting ? "btn-primary" : "btn-ghost")}>
              {p.waiting ? `${p.waiting} esperando na Caixa` : "Abrir a Caixa de entrada"}
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Conversas" value={num(p.stats.conversations)} sub="nos últimos 30 dias" />
        <Kpi label="Leads" value={num(p.stats.leads)} sub="nome e contato entregues" />
        <Kpi label="Sem humano" value={`${resolved}%`} sub={`${100 - resolved}% pediram atendente`} />
        <div className="card flex flex-col gap-1.5 px-4 py-3.5 sm:px-[18px] sm:py-4">
          <span className="kpi-label">Atendimentos do mês</span>
          <span className="font-mono text-[24px] leading-tight tracking-[-0.03em] tabular sm:text-[27px]">{p.quota ? num(p.quota.used) : "—"}</span>
          {p.quota && p.quota.quota > 0 ? (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-raised"><div className={cn("h-full origin-left rounded-full [animation:bv-grow_var(--dur-slow)_var(--ease-out)]", pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-amber" : "bg-brand")} style={{ width: `${pct}%` }} /></div>
              <span className="text-[13px] text-muted">de {num(p.quota.quota)} · tamanho {p.quota.sizeLabel}</span>
            </>
          ) : (
            <span className="text-[13px] text-muted">{p.quota ? `tamanho ${p.quota.sizeLabel}` : "sem tamanho"}</span>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card flex flex-col gap-2 p-4">
          <h3 className="px-2.5 pb-1 text-base font-medium">Canais</h3>
          <ChannelRow icon={Globe} name="Chat do site" ok={Boolean(p.site)} state={p.site ? `instalado em ${p.site.host}${p.site.lastSeen ? ` · visto ${relativeTime(p.site.lastSeen)}` : ""}` : "ainda não instalado: copie o código"} href={tab("instalacao")} />
          {p.whatsapp && <ChannelRow icon={MessageCircle} name="WhatsApp" ok={p.whatsapp.connected} state={p.whatsapp.connected ? (p.whatsapp.label ?? "conectado") : p.whatsapp.label ? `${p.whatsapp.label} · desconectado` : "não conectado"} href={tab("whatsapp")} />}
          {p.instagram && <ChannelRow icon={Camera} name="Instagram" ok={p.instagram.connected} state={p.instagram.connected ? (p.instagram.label ? `@${p.instagram.label}` : "conectado") : p.instagram.label ? `@${p.instagram.label} · desconectado` : "não conectado"} href={tab("instagram")} />}
        </section>

        {p.canConfig && (
          <section className="card flex flex-col gap-2 p-4">
            <div className="flex items-baseline justify-between gap-2 px-2.5 pb-1">
              <h3 className="text-base font-medium">{missing ? "O que falta" : "Tudo pronto"}</h3>
              <span className="font-mono text-[11px] text-muted">{todo.length - missing} de {todo.length}</span>
            </div>
            {todo.map((t, k) => (
              <Link key={t.label} href={t.href} className="group flex items-center gap-3 rounded-[12px] px-2.5 py-2 transition-colors duration-[120ms] hover:bg-raised/60" style={{ animation: `rise-in var(--dur-base) var(--ease-out) ${k * 60}ms both` }}>
                <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", t.done ? "bg-brand text-on-brand" : "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]")}>
                  {t.done && <Check size={14} strokeWidth={3} />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("text-sm", t.done ? "text-muted line-through decoration-line-strong" : "font-medium text-ink")}>{t.label}</span>
                  {!t.done && <span className="text-[12.5px] text-muted">{t.hint}</span>}
                </span>
                {!t.done && <ArrowRight size={15} className="shrink-0 text-muted transition-transform duration-[120ms] group-hover:translate-x-0.5 group-hover:text-ink" />}
              </Link>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
