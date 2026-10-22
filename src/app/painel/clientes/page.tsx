import Link from "next/link";
import { nextChoice, sizeMonthlyCents } from "@/lib/billing";
import { PACKS } from "@/lib/plans";
import { ArrowRight, Headset, Plus, UserPlus } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { can } from "@/lib/team";
import { createClient } from "@/lib/supabase/server";
import { brl, num } from "@/lib/plans";
import { getBotStats, getPendingHandoffs, resolvedPct } from "@/lib/panel";
import { ClientsList, type ClientListItem } from "@/components/clients-list";
import { handoffStatus } from "@/lib/handoff-status";
import { Kpi } from "@/components/kpi";
import { cn, daysAgoIso } from "@/lib/utils";

export const metadata = { title: "Clientes" };

interface ClientRow {
  id: string;
  name: string;
  site: string | null;
  price_cents: number | null;
  bots: Array<{ id: string; status: string; name: string; face: unknown; appearance: { color?: string } | null }>;
}

export default async function ClientesPage() {
  const { agency, packs, bots: sized, role, member } = await requireAgency();
  // a assinatura do mês que vem: tamanhos (sem os sob medida) e pacotes
  const subscriptionBrl = (sized.filter((b) => b.override === null).reduce((t, b) => t + sizeMonthlyCents(nextChoice(b)), 0) + packs.reduce((t, p) => t + PACKS[p].priceBrl * 100, 0)) / 100;
  // equipe (leva B1'): quem configura cria clientes e chatbots; o faturamento é do dono
  const canConfig = can(role, "config");
  const seesBilling = can(role, "billing");
  const supabase = await createClient();
  const [{ data }, stats, pending] = await Promise.all([
    supabase.from("clients").select("id, name, site, price_cents, bots(id, status, is_demo, name, face, appearance)").eq("agency_id", agency.id).eq("bots.is_demo", false).order("name"),
    getBotStats(supabase, daysAgoIso(30)),
    getPendingHandoffs(supabase),
  ]);
  const waitingBy = (c: ClientRow) => pending.filter((h) => h.bots?.client_id === c.id && handoffStatus(h)?.waiting).length;
  const clients = (data ?? []) as ClientRow[];
  const total = clients.reduce((s, c) => s + (c.price_cents ?? 0), 0) / 100;
  const sum = (c: ClientRow, k: "conversations" | "leads" | "needsHuman") => c.bots.reduce((s, b) => s + stats.of(b.id)[k], 0);
  // Números só dos chatbots de clientes (demos ficam de fora)
  const all = { conversations: 0, needsHuman: 0, leads: 0 };
  for (const c of clients) for (const k of ["conversations", "needsHuman", "leads"] as const) all[k] += sum(c, k);
  const botCount = clients.reduce((n, c) => n + c.bots.length, 0);
  const pct = resolvedPct(all);
  // quem espera a equipe: um atalho para a Caixa de entrada (a faixa grande saiu; redesenho, etapa 5)
  const waiting = pending.filter((h) => handoffStatus(h)?.waiting);
  const urgent = waiting.some((h) => handoffStatus(h)?.urgent);
  const items: ClientListItem[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    site: c.site,
    priceCents: c.price_cents,
    bots: c.bots.map((b) => ({ id: b.id, name: b.name, live: b.status === "live", color: b.appearance?.color ?? null, face: b.face })),
    conversations: sum(c, "conversations"),
    leads: sum(c, "leads"),
    waiting: waitingBy(c),
  }));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-normal sm:text-[28px]">Clientes</h1>
          <p className="text-sm text-muted">{clients.length} cliente{clients.length === 1 ? "" : "s"} · {botCount} chatbot{botCount === 1 ? "" : "s"}. Abra um cliente para ver os chatbots, leads e conversas dele.</p>
        </div>
        {canConfig && (
          <div className="flex w-full gap-2.5 sm:w-auto">
            {member.scope === "all" && <Link href="/painel/clientes/novo" className="btn-ghost flex-1 sm:flex-none"><UserPlus size={15} />Novo cliente</Link>}
            <Link href="/painel/bots/novo" className="btn-primary flex-1 sm:flex-none"><Plus size={15} />Novo chatbot</Link>
          </div>
        )}
      </div>

      {waiting.length > 0 && (
        <Link
          href="/painel/caixa?fila=todas"
          className={cn("group flex items-center gap-3 rounded-[14px] border px-4 py-2.5 text-sm transition-colors duration-[120ms]", urgent ? "border-danger-line bg-danger-soft text-danger" : "border-amber-line bg-amber-soft text-amber-ink")}
        >
          <Headset size={17} className="shrink-0" />
          <span className="min-w-0 flex-1 font-medium">
            {waiting.length === 1 ? "1 conversa esperando a equipe" : `${waiting.length} conversas esperando a equipe`}
            {urgent && " · tem pedido urgente"}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold">
            Abrir a Caixa <ArrowRight size={15} className="transition-transform duration-[120ms] group-hover:translate-x-0.5" />
          </span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-3.5 xl:grid-cols-4">
        <Kpi label="Conversas (30 dias)" value={num(all.conversations)} sub="em todos os clientes" />
        <Kpi label="Leads capturados" value={num(all.leads)} sub="nome + contato entregues" />
        <Kpi label="Resolvidas sem humano" value={`${pct}%`} sub={`${100 - pct}% pediram atendente`} />
        {seesBilling && (
          <div className="flex flex-col gap-1.5 rounded-[16px] bg-brand px-4 py-3.5 text-on-brand sm:px-[18px] sm:py-4">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-on-brand/75">Você fatura dos clientes</span>
            <span className="font-mono text-[24px] leading-tight tracking-[-0.03em] tabular sm:text-[27px]">{brl(total)}</span>
            <span className="text-[13px] text-on-brand/75">por mês · {subscriptionBrl ? `sua assinatura ${brl(subscriptionBrl)}` : "conta grátis"}</span>
          </div>
        )}
      </div>

      {/* redesenho, etapa 5: busca, filtros e ordem; os rostos dos chatbots em cada cliente */}
      {clients.length > 0 ? (
        <ClientsList items={items} canConfig={canConfig} canCreate={canConfig} />
      ) : (
        <div className="card flex flex-col items-start gap-3 p-6">
          {member.scope === "all" && canConfig ? (
            <>
              <p className="text-sm text-muted">Nenhum cliente ainda. Crie um cliente e adicione quantos chatbots ele precisar, ou converta uma demo.</p>
              <Link href="/painel/clientes/novo" className="btn-primary"><Plus size={15} />Criar o primeiro cliente</Link>
            </>
          ) : (
            <p className="text-sm text-muted">Nenhum cliente no seu escopo ainda. Peça para um administrador da agência liberar os clientes que você atende.</p>
          )}
        </div>
      )}
    </>
  );
}
