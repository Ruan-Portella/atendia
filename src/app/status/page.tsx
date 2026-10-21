import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { LegalFooter } from "@/components/legal-page";
import { createAdminClient } from "@/lib/supabase/admin";
import { LEVEL_LABEL, STATE_LABEL, loadStatusPage, type DayLevel, type ShownState, type StatusIncident } from "@/lib/status";
import { company } from "@/lib/company";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Status",
  description: `Como estão o painel, o chat do site, o WhatsApp, o Instagram, a IA e a API do ${company.brand} agora, e os incidentes recentes.`,
};

// a página é refeita a cada minuto (o estado muda a cada 5)
export const revalidate = 60;

const dt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dayBR = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });

const PILL: Record<ShownState, string> = {
  operando: "bg-brand-soft text-brand",
  manutencao: "bg-line-2 text-ink-2",
  instavel: "bg-amber-soft text-amber-ink",
  fora: "bg-danger-soft text-danger",
};
const BAR: Record<DayLevel, string> = { ok: "bg-brand", instavel: "bg-amber", fora: "bg-danger", sem_registro: "bg-line" };
const BAR_LABEL: Record<DayLevel, string> = { ok: "sem problemas", instavel: "instabilidade", fora: "fora do ar", sem_registro: "sem registro" };

const OVERALL: Record<ShownState, { text: string; cls: string }> = {
  operando: { text: "Tudo funcionando", cls: "bg-brand text-white" },
  manutencao: { text: "Manutenção em andamento", cls: "bg-ink-2 text-white" },
  instavel: { text: `Parte do ${company.brand} está instável`, cls: "bg-amber text-ink" },
  fora: { text: `Parte do ${company.brand} está fora do ar`, cls: "bg-danger text-white" },
};

function Incident({ i }: { i: StatusIncident }) {
  return (
    <article className="card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{i.title}</h3>
        <span className="text-xs text-muted">
          {LEVEL_LABEL[i.level]} · desde {dt(i.startedAt)}
          {i.resolvedAt ? ` · resolvido em ${dt(i.resolvedAt)}` : ""}
        </span>
      </div>
      <ol className="flex flex-col gap-1.5 border-l-2 border-line pl-3">
        {i.updates.map((u, n) => (
          <li key={n} className="text-sm">
            <span className="text-xs text-muted">{dt(u.at)}</span>
            <p className="whitespace-pre-line text-ink-2">{u.body}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}

/**
 * Página de status (antes do lançamento; post do X de 18/10, trazido em 21/10/2026): o estado de
 * cada parte do BoaVoz agora, os 90 dias e os incidentes. Também em status.boavoz.com.
 */
export default async function StatusPage() {
  const page = await loadStatusPage(createAdminClient());
  const overall = OVERALL[page.overall];
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6 lg:px-10">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="hidden text-sm font-semibold text-muted sm:inline">Status</span>
        </div>
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link href="/ajuda">Ajuda</Link>
          <Link href="/login">Entrar</Link>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-[880px] flex-1 flex-col gap-8 px-5 py-8 sm:px-6 lg:py-12">
        <div className="flex flex-col gap-3">
          <h1 className="display text-3xl font-bold sm:text-4xl">Status do {company.brand}</h1>
          <div className={cn("rounded-xl px-5 py-4 text-lg font-semibold", overall.cls)}>{overall.text}</div>
          <p className="text-xs text-muted">
            {page.checkedAt ? `Conferido em ${dt(page.checkedAt)}.` : "Ainda sem conferência."} O estado sai dos sinais do próprio sistema, a cada 5 minutos, e dos avisos da equipe.
          </p>
        </div>

        {page.open.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">Agora</h2>
            {page.open.map((i) => (
              <Incident key={i.id} i={i} />
            ))}
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Partes do {company.brand}</h2>
          <ul className="card flex flex-col divide-y divide-line-2">
            {page.components.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{c.label}</p>
                    <p className="text-xs text-muted">{c.description}</p>
                  </div>
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", PILL[c.state])}>
                    {STATE_LABEL[c.state]}
                    {c.since ? ` desde ${dt(c.since)}` : ""}
                  </span>
                </div>
                <div className="flex h-7 items-stretch gap-[2px]" role="img" aria-label={`${c.label}: os últimos 90 dias`}>
                  {c.days.map((d) => (
                    <span key={d.day} title={`${dayBR(d.day)}: ${BAR_LABEL[d.level]}`} className={cn("min-w-0 flex-1 rounded-[2px]", BAR[d.level])} />
                  ))}
                </div>
                <div className="flex justify-between text-[11px] text-muted">
                  <span>90 dias atrás</span>
                  <span>{c.uptime !== null ? `${(Math.floor(c.uptime * 10000) / 100).toLocaleString("pt-BR")}% no ar` : "sem registro ainda"}</span>
                  <span>hoje</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Incidentes recentes</h2>
          {page.past.length ? page.past.map((i) => <Incident key={i.id} i={i} />) : <p className="text-sm text-muted">Nenhum incidente nos últimos 90 dias.</p>}
        </section>

        <p className="text-sm text-muted">
          Algo fora do ar e não aparece aqui? Escreva para <a href={`mailto:${company.email}`} className="font-semibold text-ink underline">{company.email}</a>.
        </p>
      </main>
      <LegalFooter />
    </div>
  );
}
