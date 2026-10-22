import Link from "next/link";
import { ArrowRight, Check, Mail } from "lucide-react";
import { requirePermission } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { getBotStats, resolvedPct } from "@/lib/panel";
import { num } from "@/lib/plans";
import { periodLabel } from "@/lib/report";
import { BotFace } from "@/components/bot-face";
import { Kpi } from "@/components/kpi";
import { cn, daysAgoIso } from "@/lib/utils";

export const metadata = { title: "Relatórios" };

interface ClientRow {
  id: string;
  name: string;
  report_email: string | null;
  report_last_period: string | null;
  portal_token: string | null;
}

/**
 * Relatórios (redesenho, etapa 4): os números de cada cliente lado a lado (últimos 30 dias e os
 * atendimentos do mês) e se o relatório mensal e o link do cliente estão ligados. O detalhe e o
 * envio ficam no cliente (Ajustes → Relatório e portal).
 */
export default async function RelatoriosPage() {
  const { bots: quotas } = await requirePermission("config");
  const supabase = await createClient();
  const [{ data: clientRows }, { data: botRows }, stats] = await Promise.all([
    supabase.from("clients").select("id, name, report_email, report_last_period, portal_token").order("name"),
    supabase.from("bots").select("id, client_id, appearance, face").eq("is_demo", false).eq("is_template", false).order("created_at"),
    getBotStats(supabase, daysAgoIso(30)),
  ]);
  const clients = (clientRows ?? []) as ClientRow[];
  const bots = (botRows ?? []) as Array<{ id: string; client_id: string | null; appearance: { color?: string } | null; face: unknown }>;
  const quotaOf = new Map(quotas.map((q) => [q.botId, q]));
  const rows = clients.map((c) => {
    const own = bots.filter((b) => b.client_id === c.id);
    const s = own.reduce((t, b) => {
      const x = stats.of(b.id);
      return { conversations: t.conversations + x.conversations, needsHuman: t.needsHuman + x.needsHuman, leads: t.leads + x.leads };
    }, { conversations: 0, needsHuman: 0, leads: 0 });
    const used = own.reduce((t, b) => t + (quotaOf.get(b.id)?.used ?? 0), 0);
    const quota = own.reduce((t, b) => t + (quotaOf.get(b.id)?.quota ?? 0), 0);
    return { c, own, s, pct: resolvedPct(s), used, quota };
  });
  const all = rows.reduce((t, r) => ({ conversations: t.conversations + r.s.conversations, needsHuman: t.needsHuman + r.s.needsHuman, leads: t.leads + r.s.leads }), { conversations: 0, needsHuman: 0, leads: 0 });
  const withReport = clients.filter((c) => c.report_email).length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-light sm:text-[30px]">Relatórios</h1>
        <p className="text-sm text-muted">Os números de cada cliente nos últimos 30 dias e o relatório que ele recebe todo dia 1º.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Conversas" value={num(all.conversations)} sub="todos os clientes, 30 dias" />
        <Kpi label="Leads" value={num(all.leads)} sub="nome e contato entregues" />
        <Kpi label="Sem humano" value={`${resolvedPct(all)}%`} sub="resolvidas pela IA" />
        <Kpi label="Com relatório" value={`${withReport} de ${clients.length}`} sub="recebem o resumo do mês" />
      </div>

      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_minmax(0,1.6fr)_24px] gap-3 border-b border-line px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted lg:grid">
          <span>Cliente</span><span className="text-right">Conversas</span><span className="text-right">Leads</span><span className="text-right">Sem humano</span><span className="text-right">Atendimentos</span><span>Relatório</span><span />
        </div>
        {rows.length === 0 && <p className="p-6 text-sm text-muted">Nenhum cliente ainda.</p>}
        {rows.map(({ c, own, s, pct, used, quota }, k) => (
          <Link key={c.id} href={`/painel/clientes/${c.id}?tab=relatorio`} className="group grid grid-cols-2 items-center gap-x-3 gap-y-2 border-b border-line-2 px-4 py-3 text-sm transition-colors duration-[120ms] last:border-0 hover:bg-raised/50 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_minmax(0,1.6fr)_24px]" style={{ animation: `rise-in var(--dur-base) var(--ease-out) ${Math.min(k, 12) * 25}ms both` }}>
            <span className="col-span-2 flex min-w-0 items-center gap-2.5 lg:col-span-1">
              <span className="flex shrink-0 items-center">
                {own.length ? own.slice(0, 3).map((b, i) => <BotFace key={b.id} color={b.appearance?.color} face={b.face} size={24} className={cn("outline-2 outline-panel", i > 0 && "-ml-2")} />) : <span className="h-6 w-6 rounded-[8px] bg-raised" />}
              </span>
              <span className="truncate font-medium text-ink">{c.name}</span>
            </span>
            <span className="font-mono text-[13px] tabular lg:text-right"><span className="text-muted lg:hidden">Conversas </span>{num(s.conversations)}</span>
            <span className="font-mono text-[13px] tabular lg:text-right"><span className="text-muted lg:hidden">Leads </span>{num(s.leads)}</span>
            <span className={cn("font-mono text-[13px] tabular lg:text-right", s.conversations && pct < 70 ? "text-amber-ink" : "")}><span className="text-muted lg:hidden">Sem humano </span>{pct}%</span>
            <span className="font-mono text-[13px] tabular lg:text-right"><span className="text-muted lg:hidden">Atendimentos </span>{num(used)}{quota ? <span className="text-muted"> / {num(quota)}</span> : null}</span>
            <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] lg:col-span-1">
              {c.report_email ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-brand" title={c.report_email}><Mail size={11} />por e-mail</span>
              ) : (
                <span className="rounded-full bg-raised px-2 py-0.5 text-muted">sem e-mail</span>
              )}
              {c.portal_token && <span className="inline-flex items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-ink-2"><Check size={11} />link</span>}
              {c.report_last_period && <span className="text-muted">último: <span className="capitalize">{periodLabel(c.report_last_period)}</span></span>}
            </span>
            <ArrowRight size={15} className="hidden text-muted transition-transform duration-[120ms] group-hover:translate-x-0.5 group-hover:text-ink lg:block" />
          </Link>
        ))}
      </div>
    </div>
  );
}
