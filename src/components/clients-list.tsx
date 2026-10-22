"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRight, ExternalLink, Plus, Search } from "lucide-react";
import { BotFace } from "@/components/bot-face";
import { Menu } from "@/components/ui/menu";
import { EditDialog } from "@/components/ui/setting-row";
import { NewBotFields } from "@/components/new-bot-fields";
import type { ActionResult } from "@/lib/action-result";
import type { ClientOption } from "@/lib/panel";
import { cn } from "@/lib/utils";

export interface ClientListItem {
  id: string;
  name: string;
  site: string | null;
  priceCents: number | null;
  bots: Array<{ id: string; name: string; live: boolean; color: string | null; face: unknown }>;
  conversations: number;
  leads: number;
  waiting: number;
}

type Filter = "todos" | "esperando" | "fora_do_ar";
type Sort = "nome" | "conversas" | "leads" | "valor";

const norm = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const fmt = (n: number) => n.toLocaleString("pt-BR");
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * A lista de clientes (redesenho, etapa 5): busca pelo nome ou site, filtros (esperando a equipe, sem
 * chatbot no ar) e a ordem. Cada cliente mostra os rostos dos chatbots, quantos estão no ar, os
 * números dos 30 dias e, para quem configura, quanto você cobra.
 */
export function ClientsList({
  items,
  canConfig,
  newBot,
}: {
  items: ClientListItem[];
  canConfig: boolean;
  /** criar chatbot para um cliente da lista, num modal (quem configura) */
  newBot: { action: (fd: FormData) => Promise<ActionResult | void>; clients: ClientOption[]; suggestedName: string } | null;
}) {
  const router = useRouter();
  const [newBotFor, setNewBotFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [sort, setSort] = useState<Sort>("nome");
  const counts = { todos: items.length, esperando: items.filter((c) => c.waiting > 0).length, fora_do_ar: items.filter((c) => !c.bots.some((b) => b.live)).length };
  const q = norm(query.trim());
  const shown = items
    .filter((c) => (filter === "esperando" ? c.waiting > 0 : filter === "fora_do_ar" ? !c.bots.some((b) => b.live) : true))
    .filter((c) => !q || norm(`${c.name} ${c.site ?? ""} ${c.bots.map((b) => b.name).join(" ")}`).includes(q))
    .sort((a, b) => (sort === "conversas" ? b.conversations - a.conversations : sort === "leads" ? b.leads - a.leads : sort === "valor" ? (b.priceCents ?? 0) - (a.priceCents ?? 0) : a.name.localeCompare(b.name, "pt-BR")));
  const chips: Array<[Filter, string]> = [
    ["todos", "Todos"],
    ["esperando", "Esperando a equipe"],
    ["fora_do_ar", "Sem chatbot no ar"],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-72">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar clientes" placeholder="Buscar pelo nome, site ou chatbot" className="input pl-9" />
        </label>
        <div role="group" aria-label="Filtrar" className="flex flex-wrap gap-1.5">
          {chips.map(([k, label]) =>
            k !== "todos" && counts[k] === 0 ? null : (
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
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          Ordenar
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="input w-auto py-1.5 text-[13px]">
            <option value="nome">Nome</option>
            <option value="conversas">Mais conversas</option>
            <option value="leads">Mais leads</option>
            {canConfig && <option value="valor">Maior valor</option>}
          </select>
        </label>
      </div>

      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,2.4fr)_1fr_0.8fr_0.8fr_0.9fr_64px] gap-3 border-b border-line-2 bg-raised/40 px-[18px] py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted lg:grid">
          <span>Cliente</span>
          <span>Chatbots</span>
          <span>Conversas</span>
          <span>Leads</span>
          <span>{canConfig ? "Você cobra" : ""}</span>
          <span />
        </div>
        {shown.map((c) => {
          const live = c.bots.filter((b) => b.live).length;
          return (
            <div key={c.id} className="group relative flex items-center gap-3 border-b border-line-2 px-4 py-3 transition-colors duration-[120ms] last:border-0 hover:bg-raised/40 lg:grid lg:grid-cols-[minmax(0,2.4fr)_1fr_0.8fr_0.8fr_0.9fr_64px] lg:px-[18px]">
              {/* a linha inteira abre o cliente; o menu fica por cima */}
              <Link href={`/painel/clientes/${c.id}`} className="absolute inset-0" aria-label={`Abrir ${c.name}`} />
              <span className="pointer-events-none flex min-w-0 flex-1 items-center gap-3">
                <Faces bots={c.bots} name={c.name} />
                <span className="min-w-0 leading-tight">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-[15px] font-medium text-ink">{c.name}</span>
                    {c.waiting > 0 && <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-semibold text-amber-ink">{c.waiting} esperando</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">{c.site?.replace(/^https?:\/\//, "") || "sem site"}</span>
                  {/* no celular, os números embaixo do nome */}
                  <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted lg:hidden">
                    <span>{c.bots.length ? `${live} de ${c.bots.length} no ar` : "sem chatbot"}</span>
                    <span className="tabular">{fmt(c.conversations)} conversas</span>
                    <span className="tabular">{fmt(c.leads)} leads</span>
                    {canConfig && c.priceCents ? <span className="tabular">{brl(c.priceCents)}/mês</span> : null}
                  </span>
                </span>
              </span>
              <span className="pointer-events-none hidden text-sm lg:block">
                {c.bots.length ? (
                  <>
                    <span className={cn("inline-flex items-center gap-1.5", live ? "text-ink" : "text-muted")}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-brand" : "bg-line-strong")} />
                      {live} de {c.bots.length} no ar
                    </span>
                  </>
                ) : (
                  <span className="text-muted">sem chatbot</span>
                )}
              </span>
              <span className="tabular pointer-events-none hidden text-sm text-ink lg:block">{fmt(c.conversations)}</span>
              <span className="tabular pointer-events-none hidden text-sm text-ink lg:block">{fmt(c.leads)}</span>
              <span className="tabular pointer-events-none hidden text-sm text-ink lg:block">{!canConfig ? "" : c.priceCents ? `${brl(c.priceCents)}/mês` : "—"}</span>
              <span className="relative z-[1] flex shrink-0 items-center justify-end gap-1">
                <Menu
                  label={`Mais ações de ${c.name}`}
                  items={[
                    { label: "Abrir o cliente", icon: ChevronRight, onSelect: () => router.push(`/painel/clientes/${c.id}`) },
                    ...(newBot ? [{ label: "Novo chatbot para este cliente", icon: Plus, onSelect: () => setNewBotFor(c.id) }] : []),
                    ...(c.site ? [{ label: "Abrir o site", icon: ExternalLink, href: /^https?:\/\//.test(c.site) ? c.site : `https://${c.site}`, external: true }] : []),
                  ]}
                />
                <ChevronRight size={16} className="pointer-events-none hidden text-muted transition-transform duration-[120ms] group-hover:translate-x-0.5 lg:block" />
              </span>
            </div>
          );
        })}
        {items.length > 0 && shown.length === 0 && <p className="px-5 py-6 text-center text-sm text-muted">{query.trim() ? <>Nenhum cliente com &ldquo;{query.trim()}&rdquo;.</> : "Nenhum cliente neste filtro."}</p>}
      </div>
      {newBot && (
        <EditDialog
          open={newBotFor !== null}
          onClose={() => setNewBotFor(null)}
          title={`Novo chatbot${newBotFor ? ` para ${items.find((c) => c.id === newBotFor)?.name ?? "o cliente"}` : ""}`}
          description="O site e os documentos você adiciona no próximo passo."
          action={newBot.action}
          saveLabel="Criar e configurar"
        >
          <NewBotFields clients={newBot.clients} defaultClientId={newBotFor ?? undefined} suggestedName={newBot.suggestedName} idPrefix="ml" />
        </EditDialog>
      )}
    </div>
  );
}

/** O rosto do chatbot do cliente (o primeiro no ar) e, com mais de um, o "+N"; sem chatbot, as iniciais. */
function Faces({ bots, name }: { bots: ClientListItem["bots"]; name: string }) {
  if (!bots.length)
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-raised text-[12px] font-semibold text-ink-2">
        {name
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase() ?? "")
          .join("")}
      </span>
    );
  const first = bots.find((b) => b.live) ?? bots[0];
  return (
    <span className="relative shrink-0">
      <BotFace color={first.color} face={first.face} size={36} title={first.name} className={cn(!first.live && "opacity-55")} />
      {bots.length > 1 && <span className="tabular absolute -bottom-1 -right-1.5 rounded-full bg-raised px-1 text-[10px] font-semibold leading-[15px] text-ink-2 shadow-[0_0_0_2px_var(--color-panel)]">+{bots.length - 1}</span>}
    </span>
  );
}
