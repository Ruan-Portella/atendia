import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { brl, num } from "@/lib/plans";
import { getBotStats } from "@/lib/panel";
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
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const [{ data }, stats] = await Promise.all([
    supabase.from("clients").select("id, name, site, price_cents, bots(id, status)").eq("agency_id", agency.id).order("name"),
    getBotStats(supabase, daysAgoIso(30)),
  ]);
  const clients = (data ?? []) as ClientRow[];
  const total = clients.reduce((s, c) => s + (c.price_cents ?? 0), 0) / 100;
  const sum = (c: ClientRow, k: "conversations" | "leads") => c.bots.reduce((s, b) => s + stats.of(b.id)[k], 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-[28px]">Clientes</h1>
          <p className="text-sm text-muted">{clients.length} cliente{clients.length === 1 ? "" : "s"} · {brl(total)}/mês em contratos (segundo o que você informou).</p>
        </div>
        <Link href="/painel/clientes/novo" className="btn-primary w-full sm:w-auto"><Plus size={15} />Novo cliente</Link>
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
                  <span className="block truncate font-semibold">{c.name}</span>
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
