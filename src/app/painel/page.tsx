import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { brl, num } from "@/lib/plans";
import { appUrl, daysAgoIso, initials, relativeTime } from "@/lib/utils";
import { getBotStats, resolvedPct } from "@/lib/panel";
import { Kpi } from "@/components/kpi";
import { Status } from "@/components/status";
import { BotRowActions } from "@/components/bot-row-actions";
import { deleteBot } from "./actions";

export const metadata = { title: "Chatbots" };

interface BotListRow {
  id: string;
  name: string;
  client_name: string;
  client_id: string | null;
  client_site: string | null;
  status: string;
  is_demo: boolean;
  demo_slug: string | null;
  demo_views: number;
  public_key: string;
  appearance: { color?: string; avatar_text?: string };
  created_at: string;
}

export default async function BotsPage() {
  const { agency, plan } = await requireAgency();
  const supabase = await createClient();
  const since = daysAgoIso(30);

  // Contagens vêm agregadas do banco (bot_stats); antes baixávamos todas as conversas do mês.
  const [{ data: bots }, { data: clients }, stats] = await Promise.all([
    supabase.from("bots").select("id, name, client_id, client_name, client_site, status, is_demo, demo_slug, demo_views, public_key, appearance, created_at").eq("agency_id", agency.id).order("is_demo").order("client_name").order("created_at"),
    supabase.from("clients").select("price_cents").eq("agency_id", agency.id),
    getBotStats(supabase, since),
  ]);

  const rows = (bots ?? []) as BotListRow[];
  const live = rows.filter((b) => !b.is_demo);
  const demos = rows.filter((b) => b.is_demo);
  const humanPct = resolvedPct(stats.total);
  const revenue = (clients ?? []).reduce((s, c) => s + (c.price_cents ?? 0), 0) / 100;
  const convBy = (id: string) => stats.of(id).conversations;
  const leadBy = (id: string) => stats.of(id).leads;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-[28px]">Chatbots</h1>
          <p className="text-sm text-muted">{live.length} de {plan.bots} no plano · {demos.length} demo{demos.length === 1 ? "" : "s"} aguardando resposta do cliente</p>
        </div>
        <div className="flex w-full gap-2.5 sm:w-auto">
          <Link href="/painel/demos" className="btn-ghost flex-1 sm:flex-none"><Sparkles size={15} />Gerar demo</Link>
          <Link href="/painel/bots/novo" className="btn-primary flex-1 sm:flex-none"><Plus size={15} />Novo chatbot</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-3.5 xl:grid-cols-4">
        <Kpi label="Conversas (30 dias)" value={num(stats.total.conversations)} sub="em todos os chatbots" />
        <Kpi label="Leads capturados" value={num(stats.total.leads)} sub="nome + contato entregues" />
        <Kpi label="Resolvidas sem humano" value={`${humanPct}%`} sub={`${100 - humanPct}% pediram atendente`} />
        <div className="flex flex-col gap-1.5 rounded-xl bg-brand px-4 py-3.5 text-ground sm:px-[18px] sm:py-4">
          <span className="text-xs font-semibold uppercase tracking-[0.06em] text-[#c7d9d1]">Você fatura dos clientes</span>
          <span className="display text-2xl font-bold leading-tight tabular sm:text-[30px]">{brl(revenue)}</span>
          <span className="text-[13px] text-[#c7d9d1]">{clients?.length ?? 0} cliente{clients?.length === 1 ? "" : "s"} · plano {brl(plan.priceBrl)}</span>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[2.2fr_1.4fr_1fr_1fr_1fr_1.1fr_auto] gap-3 border-b border-line bg-ground px-[18px] py-3 text-xs font-semibold uppercase tracking-[0.06em] text-muted lg:grid">
          <span>Chatbot</span><span>Cliente</span><span>Status</span><span>Conversas</span><span>Leads</span><span>Criado</span><span />
        </div>
        {rows.length === 0 && (
          <div className="flex flex-col items-start gap-3 p-8">
            <p className="text-sm text-ink-2">Nenhum chatbot ainda. O jeito mais rápido de começar é gerar uma demo com o site de um cliente ou prospect.</p>
            <Link href="/painel/demos" className="btn-primary"><Sparkles size={15} />Gerar a primeira demo</Link>
          </div>
        )}
        {rows.map((b) => (
          <div key={b.id} className={`flex flex-col gap-2.5 border-b border-line-2 px-4 py-3.5 text-sm last:border-0 lg:grid lg:grid-cols-[2.2fr_1.4fr_1fr_1fr_1fr_1.1fr_auto] lg:items-center lg:gap-3 lg:px-[18px] ${b.is_demo ? "bg-amber-soft/50" : ""}`}>
            {/* nome + ações (no celular as ações ficam na mesma linha do nome) */}
            <div className="flex items-center gap-2.5">
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: b.is_demo ? "#c9c3b5" : b.appearance?.color ?? "#1f4e3d" }}>{b.appearance?.avatar_text ?? initials(b.client_name)}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <Link href={`/painel/bots/${b.id}`} className="block truncate font-semibold">{b.is_demo ? "Demo" : b.name} · {b.client_name}</Link>
                <span className="block truncate text-xs text-muted">{b.client_site?.replace(/^https?:\/\//, "") ?? "sem site"}{b.is_demo ? ` · gerada ${relativeTime(b.created_at)}` : ""}{b.is_demo && b.demo_views > 3 ? ` · o prospect abriu ${b.demo_views} vezes` : ""}</span>
              </span>
              <span className="lg:hidden">
                <BotRowActions
                  bot={{ id: b.id, name: b.name, client_name: b.client_name, is_demo: b.is_demo, status: b.status }}
                  demoUrl={b.is_demo && b.demo_slug ? appUrl(`/demo/${b.demo_slug}`) : null}
                  embedSnippet={b.is_demo ? null : `<script src="${appUrl("/widget.js")}" data-key="${b.public_key}" async></script>`}
                  whatsappUrl={b.is_demo && b.demo_slug ? `https://wa.me/?text=${encodeURIComponent(`Olá! Montei um assistente de IA para o site de ${b.client_name}. Testa aqui: ${appUrl(`/demo/${b.demo_slug}`)}`)}` : null}
                  onDelete={deleteBot.bind(null, b.id)}
                />
              </span>
            </div>
            {/* no celular, uma linha de resumo; no desktop, as colunas */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted lg:contents">
              {b.is_demo || !b.client_id ? <span className="hidden text-muted lg:inline lg:text-sm">{b.is_demo ? "Prospect" : b.client_name}</span> : <Link href={`/painel/clientes/${b.client_id}`} className="hidden truncate text-ink hover:underline lg:inline lg:text-sm">{b.client_name}</Link>}
              <Status status={b.is_demo ? "demo" : b.status} />
              <span className="tabular lg:text-sm lg:text-ink">{num(convBy(b.id))}<span className="lg:hidden"> conversas</span></span>
              <span className="tabular lg:text-sm">{b.is_demo ? <span className="hidden lg:inline">—</span> : <>{num(leadBy(b.id))}<span className="lg:hidden"> leads</span></>}</span>
              <span className="hidden lg:inline lg:text-sm">{relativeTime(b.created_at)}</span>
              <span className="hidden items-center justify-end gap-2 lg:flex">
                <Link href={`/painel/bots/${b.id}`} className="text-[13px] font-semibold text-brand">{b.is_demo ? (b.demo_views > 3 ? "Converter" : "Enviar") : "Editar"}</Link>
                <BotRowActions
                  bot={{ id: b.id, name: b.name, client_name: b.client_name, is_demo: b.is_demo, status: b.status }}
                  demoUrl={b.is_demo && b.demo_slug ? appUrl(`/demo/${b.demo_slug}`) : null}
                  embedSnippet={b.is_demo ? null : `<script src="${appUrl("/widget.js")}" data-key="${b.public_key}" async></script>`}
                  whatsappUrl={b.is_demo && b.demo_slug ? `https://wa.me/?text=${encodeURIComponent(`Olá! Montei um assistente de IA para o site de ${b.client_name}. Testa aqui: ${appUrl(`/demo/${b.demo_slug}`)}`)}` : null}
                  onDelete={deleteBot.bind(null, b.id)}
                />
              </span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[13px] text-muted">Demos que o prospect abriu mais de 3 vezes aparecem em destaque: é hora de ligar.</p>
    </>
  );
}
