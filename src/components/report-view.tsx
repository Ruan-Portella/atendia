import Link from "next/link";
import { ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { change, fmtBRL, periodLabel, periodRange, shiftPeriod, type ClientReport } from "@/lib/report";
import { initials, relativeTime } from "@/lib/utils";
import { num } from "@/lib/plans";
import { DailyBars } from "@/components/daily-bars";
import { PrintButton } from "@/components/print-button";

export const brandColor = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#1f4e3d");

/** Barra do topo com a marca da agência (portal e área do cliente). */
export function AgencyHeader({ agency, children }: { agency: ClientReport["agency"]; children?: React.ReactNode }) {
  const color = brandColor(agency.brand_color);
  const wa = agency.support_whatsapp ? `https://wa.me/${agency.support_whatsapp.replace(/\D/g, "")}` : null;
  return (
    <header className="border-b border-line bg-panel">
      <div className="mx-auto flex max-w-[980px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          {agency.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agency.logo_url} alt="" className="h-8 w-8 rounded-lg object-contain" />
          ) : (
            <span className="display flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-bold text-white" style={{ background: color }}>{initials(agency.name)}</span>
          )}
          <span className="display truncate text-base font-bold">{agency.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {children}
          {wa && <a href={wa} target="_blank" rel="noopener" className="btn-primary" style={{ background: color }}><MessageCircle size={15} />Falar com a agência</a>}
        </div>
      </div>
    </header>
  );
}

/**
 * Relatório do mês de um cliente: números, gráfico, contatos e conversas.
 * `basePath` = "/c/TOKEN" (link público) ou "/cliente/ID" (área logada); links de mês e de
 * conversa são montados a partir dele. `db` já precisa estar limitado a este cliente.
 */
export async function ReportView({ db, report, basePath, today, monthPath = basePath }: { db: SupabaseClient; report: ClientReport; basePath: string; today: string; monthPath?: string }) {
  const { period } = report;
  const botIds = report.bots.map((b) => b.id);
  const botName = new Map(report.bots.map((b) => [b.id, b.name]));
  const { from, to } = periodRange(period);
  const [{ data: leads }, { data: conversations }] = botIds.length
    ? await Promise.all([
        db.from("leads").select("id, bot_id, conversation_id, name, phone, email, notes, created_at").in("bot_id", botIds).gte("created_at", from).lt("created_at", to).order("created_at", { ascending: false }).limit(300),
        db.from("conversations").select("id, bot_id, started_at, message_count, handoff_requested_at").in("bot_id", botIds).gte("started_at", from).lt("started_at", to).order("started_at", { ascending: false }).limit(50),
      ])
    : [{ data: [] }, { data: [] }];

  const color = brandColor(report.agency.brand_color);
  const month = periodLabel(period);
  const c = report.current;
  const vs = (d: number | null) => (d === null ? "sem mês anterior para comparar" : d === 0 ? "igual ao mês anterior" : `${d > 0 ? "+" : ""}${d}% vs. mês anterior`);
  const kpis = [
    { label: "Pessoas atendidas", value: num(c.conversations), sub: vs(change(c.conversations, report.previous.conversations)) },
    { label: "Contatos capturados", value: num(c.leads), sub: vs(change(c.leads, report.previous.leads)) },
    { label: "Resolvidas sem ajuda", value: `${report.resolvedPct}%`, sub: "sem precisar de alguém da equipe" },
    { label: "Perguntas respondidas", value: num(c.visitorMessages), sub: "mensagens de visitantes" },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.06em] text-muted">Assistente virtual</p>
          <h1 className="text-2xl font-bold sm:text-[30px]">{report.client.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <PrintButton />
          <nav aria-label="Mês do relatório" className="flex items-center gap-1 rounded-xl border border-line bg-panel p-1 print:hidden">
            <Link href={`${monthPath}?mes=${shiftPeriod(period, -1)}`} className="btn-icon" aria-label="Mês anterior"><ChevronLeft size={16} /></Link>
            <span className="min-w-[130px] text-center text-sm font-semibold capitalize">{month}</span>
            {period < today ? (
              <Link href={`${monthPath}?mes=${shiftPeriod(period, 1)}`} className="btn-icon" aria-label="Próximo mês"><ChevronRight size={16} /></Link>
            ) : (
              <span className="btn-icon opacity-30" aria-hidden="true"><ChevronRight size={16} /></span>
            )}
          </nav>
        </div>
        <span className="hidden text-sm font-semibold capitalize print:block">{month}</span>
      </div>

      <p className="text-[15px] text-ink-2">
        {c.conversations
          ? <>Em {month}{period === today ? " (até agora)" : ""}, o assistente atendeu <strong className="text-ink">{num(c.conversations)} pessoa{c.conversations === 1 ? "" : "s"}</strong> e capturou <strong className="text-ink">{num(c.leads)} contato{c.leads === 1 ? "" : "s"}</strong>, resolvendo {report.resolvedPct}% das conversas sozinho.</>
          : <>Nenhuma conversa em {month} ainda.</>}
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="card flex flex-col gap-1 px-4 py-3.5">
            <span className="kpi-label">{k.label}</span>
            <span className="display text-2xl font-bold tabular sm:text-[28px]">{k.value}</span>
            <span className="text-xs text-muted">{k.sub}</span>
          </div>
        ))}
      </div>

      {report.whatsapp && (
        <section className="card flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <MessageCircle size={17} style={{ color }} />
            <h2 className="text-base font-bold">WhatsApp</h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="kpi-label">Mensagens enviadas</span>
              <span className="display text-xl font-bold tabular">{num(report.whatsapp.sent)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="kpi-label">Cobradas pela Meta</span>
              <span className="display text-xl font-bold tabular">{num(report.whatsapp.billed)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="kpi-label">Custo estimado</span>
              <span className="display text-xl font-bold tabular">≈ {fmtBRL(report.whatsapp.estimate)}</span>
            </div>
          </div>
          <p className="text-xs text-muted">
            A Meta cobra as mensagens do WhatsApp direto no cartão cadastrado no Gerenciador do WhatsApp, não por aqui. O valor é uma estimativa pela tabela de referência{report.whatsapp.partial ? " e pode ficar um pouco abaixo do real" : ""}; o valor exato está na fatura da Meta.
          </p>
        </section>
      )}

      <section className="card flex flex-col gap-3 p-4 sm:p-5">
        <h2 className="text-base font-bold">Conversas por dia</h2>
        <DailyBars days={report.daily} color={color} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-bold">Contatos capturados <span className="font-normal text-muted">({(leads ?? []).length})</span></h2>
        <div className="card overflow-hidden">
          {(leads ?? []).length === 0 && <p className="p-5 text-sm text-muted">Nenhum contato neste mês.</p>}
          {(leads ?? []).map((l) => (
            <div key={l.id} className="flex flex-col gap-1 border-b border-line-2 px-4 py-3 text-sm last:border-0 sm:grid sm:grid-cols-[1fr_1.4fr_2fr_auto] sm:items-center sm:gap-3">
              <span className="font-semibold">{l.name ?? "Sem nome"}</span>
              <span className="text-ink-2">{[l.phone, l.email].filter(Boolean).join(" · ") || "—"}</span>
              <span className="truncate text-muted">{l.notes ?? ""}</span>
              <span className="flex items-center gap-3 text-xs text-muted">
                {new Date(l.created_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                {l.phone && <a href={`https://wa.me/${l.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener" className="font-semibold hover:underline print:hidden" style={{ color }}>WhatsApp</a>}
                {l.conversation_id && <Link href={`${basePath}/conversas/${l.conversation_id}`} className="font-semibold hover:underline print:hidden">Conversa</Link>}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 print:hidden">
        <h2 className="text-base font-bold">Últimas conversas</h2>
        <div className="card overflow-hidden">
          {(conversations ?? []).length === 0 && <p className="p-5 text-sm text-muted">Nenhuma conversa neste mês.</p>}
          {(conversations ?? []).map((cv) => (
            <Link key={cv.id} href={`${basePath}/conversas/${cv.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-4 py-3 text-sm last:border-0 hover:bg-ground">
              <span className="text-muted">{relativeTime(cv.started_at)}</span>
              {report.bots.length > 1 && <span className="font-medium">{botName.get(cv.bot_id)}</span>}
              <span>{cv.message_count} mensagens</span>
              {cv.handoff_requested_at && <span className="ml-auto rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber-ink">pediu atendente</span>}
            </Link>
          ))}
        </div>
      </section>

      <footer className="pt-2 text-center text-xs text-muted">Relatório preparado por {report.agency.name}.</footer>
    </>
  );
}
