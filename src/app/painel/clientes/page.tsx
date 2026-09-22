import Link from "next/link";
import { ChevronRight, Plus, UserPlus } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { brl, num } from "@/lib/plans";
import { getBotStats, getPendingHandoffs, resolvedPct } from "@/lib/panel";
import { PendingHandoffs } from "@/components/pending-handoffs";
import { Kpi } from "@/components/kpi";
import { daysAgoIso, initials } from "@/lib/utils";

export const metadata = { title: "Clientes" };

interface ClientRow {
  id: string;
  name: string;
  site: string | null;
  price_cents: number | null;
  bots: Array<{ id: string; status: string }>;
}

export default async function ClientesPage() {
  const { agency, plan } = await requireAgency();
  const supabase = await createClient();
  const [{ data }, stats, pending] = await Promise.all([
    supabase.from("clients").select("id, name, site, price_cents, bots(id, status, is_demo)").eq("agency_id", agency.id).eq("bots.is_demo", false).order("name"),
    getBotStats(supabase, daysAgoIso(30)),
    getPendingHandoffs(supabase),
  ]);
  const waitingBy = (c: ClientRow) => pending.filter((h) => h.bots?.client_id === c.id).length;
  const clients = (data ?? []) as ClientRow[];
  const total = clients.reduce((s, c) => s + (c.price_cents ?? 0), 0) / 100;
  const sum = (c: ClientRow, k: "conversations" | "leads" | "needsHuman") => c.bots.reduce((s, b) => s + stats.of(b.id)[k], 0);
  // Números só dos chatbots de clientes (demos ficam de fora)
  const all = { conversations: 0, needsHuman: 0, leads: 0 };
  for (const c of clients) for (const k of ["conversations", "needsHuman", "leads"] as const) all[k] += sum(c, k);
  const botCount = clients.reduce((n, c) => n + c.bots.length, 0);
  const pct = resolvedPct(all);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-[28px]">Clientes</h1>
          <p className="text-sm text-muted">{clients.length} cliente{clients.length === 1 ? "" : "s"} · {botCount} de {plan.bots} chatbots do plano. Abra um cliente para ver os chatbots, leads e conversas dele.</p>
        </div>
        <div className="flex w-full gap-2.5 sm:w-auto">
          <Link href="/painel/clientes/novo" className="btn-ghost flex-1 sm:flex-none"><UserPlus size={15} />Novo cliente</Link>
          <Link href="/painel/bots/novo" className="btn-primary flex-1 sm:flex-none"><Plus size={15} />Novo chatbot</Link>
        </div>
      </div>

      <PendingHandoffs items={pending} />

      <div className="grid grid-cols-2 gap-3 sm:gap-3.5 xl:grid-cols-4">
        <Kpi label="Conversas (30 dias)" value={num(all.conversations)} sub="em todos os clientes" />
        <Kpi label="Leads capturados" value={num(all.leads)} sub="nome + contato entregues" />
        <Kpi label="Resolvidas sem humano" value={`${pct}%`} sub={`${100 - pct}% pediram atendente`} />
        <div className="flex flex-col gap-1.5 rounded-xl bg-brand px-4 py-3.5 text-ground sm:px-[18px] sm:py-4">
          <span className="text-xs font-semibold uppercase tracking-[0.06em] text-[#c7d9d1]">Você fatura dos clientes</span>
          <span className="display text-2xl font-bold leading-tight tabular sm:text-[30px]">{brl(total)}</span>
          <span className="text-[13px] text-[#c7d9d1]">por mês · plano {brl(plan.priceBrl)}</span>
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[2.2fr_1fr_1fr_1fr_1fr_20px] gap-3 border-b border-line bg-ground px-[18px] py-3 text-xs font-semibold uppercase tracking-[0.06em] text-muted lg:grid">
          <span>Cliente</span><span>Chatbots</span><span>Conversas (30d)</span><span>Leads (30d)</span><span>Você cobra</span><span />
        </div>
        {clients.map((c) => {
          const live = c.bots.filter((b) => b.status === "live").length;
          return (
            <Link key={c.id} href={`/painel/clientes/${c.id}`} className="flex flex-col gap-2 border-b border-line-2 px-4 py-3.5 text-sm transition-colors duration-[120ms] last:border-0 hover:bg-ground lg:grid lg:grid-cols-[2.2fr_1fr_1fr_1fr_1fr_20px] lg:items-center lg:gap-3 lg:px-[18px]">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand">{initials(c.name)}</span>
                <span className="min-w-0 leading-tight">
                  <span className="flex items-center gap-2 truncate font-semibold">{c.name}{waitingBy(c) > 0 && <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-semibold text-amber-ink">{waitingBy(c)} esperando</span>}</span>
                  <span className="block truncate text-xs text-muted">{c.site?.replace(/^https?:\/\//, "") ?? "sem site"}</span>
                </span>
              </span>
              <span className="flex flex-wrap gap-x-3 gap-y-1 pl-[40px] text-xs text-muted lg:contents lg:pl-0">
                <span className="tabular lg:text-sm lg:text-ink">{c.bots.length} chatbot{c.bots.length === 1 ? "" : "s"}{c.bots.length ? <span className="text-muted"> · {live} no ar</span> : null}</span>
                <span className="tabular lg:text-sm lg:text-ink">{num(sum(c, "conversations"))}<span className="lg:hidden"> conversas</span></span>
                <span className="tabular lg:text-sm lg:text-ink">{num(sum(c, "leads"))}<span className="lg:hidden"> leads</span></span>
                <span className="tabular lg:text-sm lg:text-ink">{c.price_cents ? `${brl(c.price_cents / 100)}/mês` : "—"}</span>
                <ChevronRight size={16} className="hidden text-muted lg:block" />
              </span>
            </Link>
          );
        })}
        {clients.length === 0 && (
          <div className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm text-muted">Nenhum cliente ainda. Crie um cliente e adicione quantos chatbots ele precisar, ou converta uma demo.</p>
            <Link href="/painel/clientes/novo" className="btn-primary"><Plus size={15} />Criar o primeiro cliente</Link>
          </div>
        )}
      </div>
    </>
  );
}
