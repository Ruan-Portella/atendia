"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { DialogButton, SwitchField } from "@/components/ui/setting-row";
import { StatusPill } from "@/components/ui/form-section";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

/** Um chatbot na lista de uso (montado no servidor). */
export interface UsageRow {
  botId: string;
  name: string;
  clientId: string | null;
  clientName: string | null;
  size: string;
  /** tem IA (o Atendimento e o sem tamanho não têm cota de atendimentos) */
  ai: boolean;
  used: number;
  quota: number;
  state: "cheia" | "excedente" | "perto" | "ok";
  /** no lugar do excedente, quando não há: "sem IA" ou "escolha um tamanho" */
  note: string | null;
  messages: number;
  metaCost: string;
  /** "Com o uso do mês passado (420), o G sairia R$ 30,00 mais barato." */
  suggestion: string | null;
  overage: { enabled: boolean; cap: string; used: number; usedText: string; creditShort: boolean; suspended: "pico" | "ataque" | null } | null;
}

type Filter = "todos" | "atencao" | "excedente";
const fmt = (n: number) => n.toLocaleString("pt-BR");

/**
 * Uso por cliente e chatbot (redesenho, etapa 5): cada chatbot numa linha com a barra da cota, as
 * mensagens e o custo da Meta; o excedente (ligar e o teto) num modal. Filtros "Precisam de atenção"
 * (perto da cota ou só humano) e "No excedente"; com mais de 8 chatbots, a busca.
 */
export function UsageList({ rows, removed, renewal, setOverage, resolveSpike }: { rows: UsageRow[]; removed: number; renewal: string; setOverage: (botId: string, fd: FormData) => Promise<ActionResult>; resolveSpike: (botId: string, verdict: "real" | "ataque") => Promise<ActionResult> }) {
  const [filter, setFilter] = useState<Filter>("todos");
  const [query, setQuery] = useState("");
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = norm(query.trim());
  const match = (r: UsageRow) => (filter === "atencao" ? r.state === "cheia" || r.state === "perto" : filter === "excedente" ? r.state === "excedente" || Boolean(r.overage?.enabled) : true) && (!q || norm(`${r.name} ${r.clientName ?? ""}`).includes(q));
  const shown = rows.filter(match);
  const counts = { atencao: rows.filter((r) => r.state === "cheia" || r.state === "perto").length, excedente: rows.filter((r) => r.state === "excedente" || r.overage?.enabled).length };
  const groups = [...new Map(shown.map((r) => [r.clientId ?? "", r.clientName ?? "Sem cliente"])).entries()].map(([id, name]) => ({ id, name, bots: shown.filter((r) => (r.clientId ?? "") === id) }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {rows.length > 8 && (
          <label className="relative w-full sm:w-64">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar chatbot ou cliente" placeholder="Buscar chatbot ou cliente" className="input pl-9" />
          </label>
        )}
        <div role="group" aria-label="Filtrar" className="flex flex-wrap gap-1.5">
          {(
            [
              ["todos", "Todos", rows.length],
              ["atencao", "Precisam de atenção", counts.atencao],
              ["excedente", "Com excedente", counts.excedente],
            ] as Array<[Filter, string, number]>
          ).map(([k, label, n]) =>
            k !== "todos" && !n ? null : (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cn("rounded-full border px-3 py-1 text-[13px] font-medium transition-colors duration-[120ms]", filter === k ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:border-line-strong", k === "atencao" && filter !== k && "text-amber-ink")}>
                {label} <span className="tabular text-xs opacity-70">{n}</span>
              </button>
            ),
          )}
        </div>
      </div>

      {groups.map((g) => {
        const used = g.bots.reduce((t, b) => t + b.used, 0);
        const quota = g.bots.reduce((t, b) => t + b.quota, 0);
        return (
          <section key={g.id || "sem"} className="flex flex-col gap-2">
            <h3 className="flex items-baseline justify-between gap-3 px-1">
              <span className="kpi-label">{g.name}</span>
              <span className="tabular text-xs text-muted">
                {fmt(used)} / {fmt(quota)} atendimentos
              </span>
            </h3>
            <ul className="card flex flex-col divide-y divide-line-2 overflow-hidden">
              {g.bots.map((b) => {
                const pct = b.quota ? Math.min(100, Math.round((b.used / b.quota) * 100)) : 0;
                return (
                  <li key={b.botId} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Link href={`/painel/bots/${b.botId}`} className="truncate text-[15px] font-medium text-ink hover:underline">
                            {b.name}
                          </Link>
                          <StatusPill tone={b.ai ? "ok" : "muted"}>{b.size}</StatusPill>
                          {b.state === "cheia" && <StatusPill tone="danger">só humano</StatusPill>}
                          {b.state === "excedente" && <StatusPill tone="warn">no excedente</StatusPill>}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {fmt(b.messages)} mensagens · Meta {b.metaCost}
                        </span>
                      </span>
                      {b.ai && b.quota > 0 && (
                        <span className="flex w-full flex-col gap-1 sm:w-56">
                          <span className={cn("tabular text-xs", b.state === "cheia" ? "font-medium text-danger" : b.state === "perto" || b.state === "excedente" ? "font-medium text-amber-ink" : "text-ink-2")}>
                            {fmt(b.used)} de {fmt(b.quota)} atendimentos
                          </span>
                          <span className="h-1.5 overflow-hidden rounded-full bg-line-2" aria-hidden>
                            <span className={cn("block h-full rounded-full", b.state === "cheia" ? "bg-danger" : b.state === "perto" || b.state === "excedente" ? "bg-amber" : "bg-brand")} style={{ width: `${pct}%` }} />
                          </span>
                        </span>
                      )}
                      {b.overage ? (
                        <DialogButton
                          label={b.overage.enabled ? `Excedente: ${b.overage.cap ? `até R$ ${b.overage.cap}` : "sem teto"}` : "Excedente desligado"}
                          className={cn("btn-ghost shrink-0 py-1.5 text-xs", b.overage.enabled ? "text-brand" : "text-muted")}
                          title={`Excedente de ${b.name}`}
                          description="Ligado, a cota cheia não para o chatbot: cada atendimento a mais usa o crédito da conta, na hora. O teto do mês é opcional, para um chatbot não gastar o crédito todo."
                          action={(fd) => setOverage(b.botId, fd)}
                        >
                          <SwitchField name="enabled" defaultChecked={b.overage.enabled} label="Excedente ligado" hint="Desligado, a cota cheia põe o chatbot no modo só humano até o mês virar." />
                          <div>
                            <label htmlFor={`cap-${b.botId}`} className="label">
                              Teto do mês (opcional)
                            </label>
                            <div className="relative w-40">
                              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">R$</span>
                              <input id={`cap-${b.botId}`} name="cap" defaultValue={b.overage.cap} placeholder="sem teto" inputMode="decimal" className="input pl-9" />
                            </div>
                            <p className="mt-1 text-xs text-muted">Vazio: o limite é o crédito da conta.</p>
                          </div>
                          {b.overage.enabled && <p className="rounded-[12px] bg-raised px-3 py-2 text-sm text-ink-2">Neste mês: {b.overage.usedText}.</p>}
                        </DialogButton>
                      ) : (
                        <span className="shrink-0 text-xs text-muted">{b.note}</span>
                      )}
                    </div>
                    {b.suggestion && <p className="text-xs text-amber-ink">{b.suggestion}</p>}
                    {b.overage?.enabled && b.overage.creditShort && (
                      <p className="text-xs text-danger">
                        Sem crédito para o próximo atendimento a mais.{" "}
                        <Link href="/painel/cobranca/credito" className="font-semibold underline">
                          Comprar crédito
                        </Link>
                      </p>
                    )}
                    {b.overage?.suspended === "ataque" && <p className="text-xs text-danger">Marcado como ataque: excedente suspenso até {renewal}.</p>}
                    {b.overage?.suspended === "pico" && (
                      <div className="flex flex-wrap items-center gap-2 rounded-[12px] bg-danger-soft px-3 py-2">
                        <span className="min-w-0 flex-1 text-xs font-medium text-danger">Pico no chat do site: o excedente foi suspenso. É gente de verdade?</span>
                        <ActionForm action={() => resolveSpike(b.botId, "real")}>
                          <SubmitButton className="btn-ghost py-1 text-xs" pendingLabel="Salvando…">
                            É tráfego real
                          </SubmitButton>
                        </ActionForm>
                        <ActionForm action={() => resolveSpike(b.botId, "ataque")}>
                          <SubmitButton className="btn-ghost py-1 text-xs text-danger" pendingLabel="Salvando…">
                            É ataque
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {removed > 0 && filter === "todos" && !q && <p className="px-1 text-xs text-muted">Chatbots excluídos neste mês: {fmt(removed)} atendimentos, que continuam no total.</p>}
      {shown.length === 0 && <p className="card px-5 py-8 text-center text-sm text-muted">{rows.length ? "Nenhum chatbot neste filtro." : "Nenhum chatbot ainda."}</p>}
    </div>
  );
}
