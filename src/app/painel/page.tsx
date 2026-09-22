import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { brl, num } from "@/lib/plans";
import { daysAgoIso, initials, relativeTime } from "@/lib/utils";
import { Status } from "@/components/status";

export const metadata = { title: "Chatbots" };

interface BotListRow {
  id: string;
  name: string;
  client_name: string;
  client_site: string | null;
  status: string;
  is_demo: boolean;
  demo_slug: string | null;
  demo_views: number;
  price_cents: number | null;
  appearance: { color?: string; avatar_text?: string };
  created_at: string;
}

export default async function BotsPage() {
  const { agency, plan } = await requireAgency();
  const supabase = await createClient();
  const since = daysAgoIso(30);

  const [{ data: bots }, { data: convs }, { data: leads }] = await Promise.all([
    supabase.from("bots").select("id, name, client_name, client_site, status, is_demo, demo_slug, demo_views, price_cents, appearance, created_at").eq("agency_id", agency.id).order("is_demo").order("created_at", { ascending: false }),
    supabase.from("conversations").select("id, bot_id, needs_human").gte("started_at", since),
    supabase.from("leads").select("id, bot_id").gte("created_at", since),
  ]);

  const rows = (bots ?? []) as BotListRow[];
  const live = rows.filter((b) => !b.is_demo);
  const demos = rows.filter((b) => b.is_demo);
  const convCount = convs?.length ?? 0;
  const leadCount = leads?.length ?? 0;
  const humanCount = convs?.filter((c) => c.needs_human).length ?? 0;
  const humanPct = convCount ? Math.round(100 - (humanCount / convCount) * 100) : 100;
  const revenue = live.reduce((s, b) => s + (b.price_cents ?? 0), 0) / 100;
  const convBy = (id: string) => convs?.filter((c) => c.bot_id === id).length ?? 0;
  const leadBy = (id: string) => leads?.filter((l) => l.bot_id === id).length ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold">Chatbots</h1>
          <p className="text-sm text-muted">{live.length} de {plan.bots} no plano · {demos.length} demo{demos.length === 1 ? "" : "s"} aguardando resposta do cliente</p>
        </div>
        <div className="flex gap-2.5">
          <Link href="/painel/demos" className="btn-ghost"><Sparkles size={15} />Gerar demo</Link>
          <Link href="/painel/bots/novo" className="btn-primary"><Plus size={15} />Novo chatbot</Link>
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Conversas (30 dias)" value={num(convCount)} sub="em todos os chatbots" />
        <Kpi label="Leads capturados" value={num(leadCount)} sub="nome + contato entregues" />
        <Kpi label="Resolvidas sem humano" value={`${humanPct}%`} sub={`${100 - humanPct}% pediram atendente`} />
        <div className="flex flex-col gap-1.5 rounded-xl bg-brand px-[18px] py-4 text-ground">
          <span className="text-xs font-semibold uppercase tracking-[0.06em] text-[#c7d9d1]">Você fatura dos clientes</span>
          <span className="display text-[30px] font-bold leading-tight tabular">{brl(revenue)}</span>
          <span className="text-[13px] text-[#c7d9d1]">{live.length} clientes · plano {brl(plan.priceBrl)}</span>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[2.2fr_1.4fr_1fr_1fr_1fr_1.1fr_0.8fr] gap-3 border-b border-line bg-ground px-[18px] py-3 text-xs font-semibold uppercase tracking-[0.06em] text-muted md:grid">
          <span>Chatbot</span><span>Cliente</span><span>Status</span><span>Conversas</span><span>Leads</span><span>Você cobra</span><span />
        </div>
        {rows.length === 0 && (
          <div className="flex flex-col items-start gap-3 p-8">
            <p className="text-sm text-ink-2">Nenhum chatbot ainda. O jeito mais rápido de começar é gerar uma demo com o site de um cliente ou prospect.</p>
            <Link href="/painel/demos" className="btn-primary"><Sparkles size={15} />Gerar a primeira demo</Link>
          </div>
        )}
        {rows.map((b) => (
          <div key={b.id} className={`grid grid-cols-1 gap-2 border-b border-line-2 px-[18px] py-3.5 text-sm last:border-0 md:grid-cols-[2.2fr_1.4fr_1fr_1fr_1fr_1.1fr_0.8fr] md:items-center md:gap-3 ${b.is_demo ? "bg-amber-soft/50" : ""}`}>
            <div className="flex items-center gap-2.5">
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: b.is_demo ? "#c9c3b5" : b.appearance?.color ?? "#1f4e3d" }}>{b.appearance?.avatar_text ?? initials(b.client_name)}</span>
              <span className="min-w-0 leading-tight">
                <Link href={`/painel/bots/${b.id}`} className="block truncate font-semibold">{b.is_demo ? "Demo" : b.name} · {b.client_name}</Link>
                <span className="block truncate text-xs text-muted">{b.client_site?.replace(/^https?:\/\//, "") ?? "sem site"}{b.is_demo ? ` · gerada ${relativeTime(b.created_at)}` : ""}{b.is_demo && b.demo_views > 3 ? ` · o prospect abriu ${b.demo_views} vezes` : ""}</span>
              </span>
            </div>
            <span className={b.is_demo ? "text-muted" : ""}>{b.is_demo ? "Prospect" : b.client_name}</span>
            <Status status={b.is_demo ? "demo" : b.status} />
            <span className="tabular">{num(convBy(b.id))}</span>
            <span className="tabular text-muted">{b.is_demo ? "—" : num(leadBy(b.id))}</span>
            <span className="tabular">{b.price_cents ? `${brl(b.price_cents / 100)}/mês` : <span className="text-muted">—</span>}</span>
            <Link href={`/painel/bots/${b.id}`} className="text-[13px] font-semibold text-brand md:text-right">{b.is_demo ? (b.demo_views > 3 ? "Converter" : "Enviar") : "Editar"}</Link>
          </div>
        ))}
      </div>
      <p className="text-[13px] text-muted">Demos que o prospect abriu mais de 3 vezes aparecem em destaque: é hora de ligar.</p>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card flex flex-col gap-1.5 px-[18px] py-4">
      <span className="kpi-label">{label}</span>
      <span className="display text-[30px] font-bold leading-tight tabular">{value}</span>
      <span className="text-[13px] text-muted">{sub}</span>
    </div>
  );
}
