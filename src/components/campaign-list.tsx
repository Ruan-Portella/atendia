"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BarChart3, Pause, Play, Search, XCircle } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { Menu } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/form-section";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface CampaignListItem {
  id: string;
  name: string;
  kind: string;
  template: string;
  status: "draft" | "scheduled" | "sending" | "paused" | "finished" | "canceled";
  statusLabel: string;
  /** "para 23/10 às 9:00" (agendada) ou o motivo (pausada) */
  note: string | null;
  created: string;
  botName: string;
  clientName: string;
  clientId: string | null;
  delivered: number;
  read: number;
  audience: number;
}

type Filter = "todas" | "ativas" | "pausadas" | "terminadas";
const TONE = { sending: "ok", scheduled: "ok", paused: "warn", finished: "muted", canceled: "muted", draft: "muted" } as const;
const fmt = (n: number) => n.toLocaleString("pt-BR");
const norm = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * A lista de campanhas (redesenho, etapa 5): busca pelo nome, modelo, chatbot ou cliente; filtros pela
 * situação; cada campanha com a situação, o andamento (entregues e lidas do público) e o menu "…"
 * (relatório, pausar, retomar, cancelar). Clicar na linha abre o relatório.
 */
export function CampaignList({ items, showClient, changeCampaign }: { items: CampaignListItem[]; showClient: boolean; changeCampaign: (id: string, status: "paused" | "sending" | "canceled") => Promise<ActionResult> }) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todas");
  const [ask, setAsk] = useState<{ item: CampaignListItem; to: "paused" | "sending" | "canceled" } | null>(null);
  const [busy, start] = useTransition();
  const active = (c: CampaignListItem) => c.status === "sending" || c.status === "scheduled";
  const counts = { todas: items.length, ativas: items.filter(active).length, pausadas: items.filter((c) => c.status === "paused").length, terminadas: items.filter((c) => c.status === "finished" || c.status === "canceled").length };
  const q = norm(query.trim());
  const shown = items
    .filter((c) => (filter === "ativas" ? active(c) : filter === "pausadas" ? c.status === "paused" : filter === "terminadas" ? c.status === "finished" || c.status === "canceled" : true))
    .filter((c) => !q || norm(`${c.name} ${c.template} ${c.botName} ${c.clientName}`).includes(q));
  const chips: Array<[Filter, string]> = [
    ["todas", "Todas"],
    ["ativas", "Saindo ou agendadas"],
    ["pausadas", "Pausadas"],
    ["terminadas", "Terminadas"],
  ];
  const confirm = () => {
    if (!ask) return;
    const { item, to } = ask;
    start(async () => {
      const r = await changeCampaign(item.id, to);
      if (r.ok) {
        toast.success(r.message ?? "Pronto.");
        setAsk(null);
        router.refresh();
      } else toast.error(r.message);
    });
  };
  const QUESTION = {
    paused: { title: "Pausar", description: "O que já saiu continua valendo; o resto espera você retomar.", label: "Pausar", danger: false },
    sending: { title: "Retomar", description: "Os envios que faltam saem em até um minuto, com as mesmas conferências (aceite, SAIR e 18+).", label: "Retomar", danger: false },
    canceled: { title: "Cancelar", description: "O que faltava enviar não sai mais. Não dá para desfazer.", label: "Cancelar campanha", danger: true },
  } as const;

  if (!items.length) return <p className="card px-5 py-8 text-center text-sm text-muted">Nenhuma campanha ainda. Toque em &ldquo;Nova campanha&rdquo; para mandar a primeira.</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-72">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar campanhas" placeholder="Buscar campanhas" className="input pl-9" />
        </label>
        <div role="group" aria-label="Filtrar" className="flex flex-wrap gap-1.5">
          {chips.map(([k, label]) =>
            k !== "todas" && counts[k] === 0 ? null : (
              <button
                key={k}
                type="button"
                aria-pressed={filter === k}
                onClick={() => setFilter(k)}
                className={cn("rounded-full border px-3 py-1 text-[13px] font-medium transition-colors duration-[120ms]", filter === k ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:border-line-strong")}
              >
                {label} <span className="tabular text-xs opacity-70">{counts[k]}</span>
              </button>
            ),
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        {shown.map((c) => {
          const pct = c.audience ? Math.min(100, Math.round((c.delivered / c.audience) * 100)) : 0;
          const readPct = c.audience ? Math.min(100, Math.round((c.read / c.audience) * 100)) : 0;
          return (
            <div key={c.id} className="group relative flex items-center gap-3 border-b border-line-2 px-4 py-3 transition-colors duration-[120ms] last:border-0 hover:bg-raised/40 lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_40px] lg:px-[18px]">
              <Link href={`/painel/campanhas/${c.id}`} className="absolute inset-0" aria-label={`Abrir o relatório de ${c.name}`} />
              <span className="pointer-events-none min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-[15px] font-medium text-ink">{c.name}</span>
                  <StatusPill tone={TONE[c.status]}>{c.statusLabel}</StatusPill>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {c.kind} · <span className="font-mono">{c.template}</span> · criada {c.created}
                </span>
                {c.note && <span className={cn("mt-0.5 block truncate text-xs", c.status === "paused" ? "text-amber-ink" : "text-ink-2")}>{c.note}</span>}
                {/* no celular, o chatbot e o andamento embaixo */}
                <span className="mt-1 block text-xs text-muted lg:hidden">
                  {c.botName}
                  {showClient && c.clientName ? ` · ${c.clientName}` : ""} · {fmt(c.delivered)} entregues de {fmt(c.audience)}
                </span>
              </span>
              <span className="pointer-events-none hidden min-w-0 text-sm lg:block">
                <span className="block truncate text-ink-2">{c.botName}</span>
                {showClient && <span className="block truncate text-xs text-muted">{c.clientName}</span>}
              </span>
              <span className="pointer-events-none hidden flex-col gap-1.5 lg:flex">
                <span className="tabular text-xs text-ink-2">
                  {fmt(c.delivered)} entregues · {fmt(c.read)} lidas <span className="text-muted">de {fmt(c.audience)}</span>
                </span>
                {/* o andamento: entregues e, por cima, lidas */}
                <span className="relative h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-line-2" aria-hidden>
                  <span className="absolute inset-y-0 left-0 rounded-full bg-brand/45" style={{ width: `${pct}%` }} />
                  <span className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${readPct}%` }} />
                </span>
              </span>
              <span className="relative z-[1] flex shrink-0 justify-end">
                <Menu
                  label={`Mais ações de ${c.name}`}
                  items={[
                    { label: "Ver o relatório", icon: BarChart3, onSelect: () => router.push(`/painel/campanhas/${c.id}`) },
                    ...(active(c) ? [{ label: "Pausar", icon: Pause, onSelect: () => setAsk({ item: c, to: "paused" }) }] : []),
                    ...(c.status === "paused" ? [{ label: "Retomar", icon: Play, onSelect: () => setAsk({ item: c, to: "sending" }) }] : []),
                    ...(active(c) || c.status === "paused" ? [{ type: "separator" as const }, { label: "Cancelar a campanha", icon: XCircle, danger: true, onSelect: () => setAsk({ item: c, to: "canceled" }) }] : []),
                  ]}
                />
              </span>
            </div>
          );
        })}
        {shown.length === 0 && <p className="px-5 py-6 text-center text-sm text-muted">{query.trim() ? <>Nenhuma campanha com &ldquo;{query.trim()}&rdquo;.</> : "Nenhuma campanha neste filtro."}</p>}
      </div>
      <ConfirmModal
        open={Boolean(ask)}
        onClose={() => setAsk(null)}
        onConfirm={confirm}
        title={ask ? `${QUESTION[ask.to].title} ${ask.item.name}?` : ""}
        description={ask ? QUESTION[ask.to].description : ""}
        confirmLabel={ask ? QUESTION[ask.to].label : ""}
        danger={ask ? QUESTION[ask.to].danger : false}
        busy={busy}
      />
    </div>
  );
}
