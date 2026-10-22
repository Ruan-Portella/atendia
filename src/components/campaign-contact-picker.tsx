"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Search, Users } from "lucide-react";
import { campaignContactPicker, type PickContact } from "@/app/painel/campanhas/actions";
import { Modal } from "@/components/ui/modal";
import { displayPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

type Filter = "todos" | "aceitaram" | "leads";

/**
 * Escolher contatos que já existem (redesenho, etapa 5, a pedido do usuário em 22/10): a busca pelo
 * nome ou pelo telefone, os filtros (Todos, Aceitaram novidades, Leads) e, em cada um, se pode
 * receber. `mode` diz o que conta: o aceite (marketing) ou o SAIR dos lembretes e a primeira mensagem
 * (lembrete). Devolve os escolhidos em `onAdd`.
 */
export function ContactPicker({ botId, mode, chosen, onAdd, declared = true }: { botId: string; mode: "marketing" | "lembrete"; chosen: Set<string>; onAdd: (rows: PickContact[]) => void; declared?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(mode === "marketing" ? "aceitaram" : "todos");
  const [rows, setRows] = useState<PickContact[]>([]);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<string, PickContact>>(new Map());
  const [loading, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = (q: string, f: Filter, p: number) =>
    start(async () => {
      const r = await campaignContactPicker(botId, { q, filter: f, page: p });
      if (!r.ok) return setProblem(r.message);
      setProblem(null);
      setRows((cur) => (p === 0 ? r.rows : [...cur, ...r.rows]));
      setMore(r.more);
      setPage(p);
    });
  // abrir carrega a primeira página; a busca espera a pessoa parar de digitar
  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(query, filter, 0), query ? 300 : 0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, filter]);

  const why = (r: PickContact) =>
    mode === "marketing" ? (r.consent === "saiu" ? "Saiu das promoções (SAIR): fica de fora" : r.consent === "nao" ? "Não aceitou novidades: fica de fora" : null) : r.utilityOut ? "Saiu dos lembretes (SAIR): fica de fora" : !declared && !r.messaged ? "Nunca falou com o chatbot: fica de fora sem a declaração" : null;
  const toggle = (r: PickContact) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(r.id)) n.delete(r.id);
      else n.set(r.id, r);
      return n;
    });
  const close = () => {
    setOpen(false);
    setPicked(new Map());
  };
  const chips: Array<[Filter, string]> = [
    ["todos", "Todos"],
    ["aceitaram", "Aceitaram novidades"],
    ["leads", "Leads"],
  ];

  return (
    <>
      <button type="button" disabled={!botId} onClick={() => setOpen(true)} className="btn-ghost self-start">
        <Users size={15} /> Escolher contatos
      </button>
      <Modal
        open={open}
        onClose={close}
        title="Escolher contatos"
        description={mode === "marketing" ? "Os contatos do WhatsApp deste chatbot. Marketing só vai para quem aceitou novidades: os outros aparecem, mas ficam de fora." : "Os contatos do WhatsApp deste chatbot. O horário marcado da ficha do contato já vem na lista."}
        size="lg"
        footer={
          <>
            <button type="button" onClick={close} className="btn-ghost">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!picked.size}
              onClick={() => {
                onAdd([...picked.values()]);
                close();
              }}
              className="btn-primary"
            >
              {picked.size ? `Adicionar ${picked.size}` : "Adicionar"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              aria-label="Buscar contatos"
              placeholder="Buscar pelo nome ou pelo telefone"
              className="input pl-9"
            />
          </label>
          <div role="group" aria-label="Filtrar" className="flex flex-wrap gap-1.5">
            {chips.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cn("rounded-full border px-3 py-1 text-[13px] font-medium transition-colors duration-[120ms]", filter === k ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:border-line-strong")}>
                {label}
              </button>
            ))}
          </div>
          {problem && <p className="text-sm text-danger">{problem}</p>}
          <div className="flex max-h-[46vh] flex-col overflow-y-auto rounded-[14px] border border-line">
            {rows.map((r) => {
              const already = chosen.has(r.id);
              const on = picked.has(r.id);
              const reason = why(r);
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={already}
                  aria-pressed={on || already}
                  onClick={() => toggle(r)}
                  className={cn("flex items-center gap-3 border-b border-line-2 px-3 py-2.5 text-left transition-colors duration-[120ms] last:border-0 disabled:opacity-60", on ? "bg-brand-soft/50" : "hover:bg-raised/40")}
                >
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md", on || already ? "bg-brand text-on-brand" : "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]")}>{(on || already) && <Check size={13} strokeWidth={3} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="truncate text-sm font-medium text-ink">{r.name || "Sem nome"}</span>
                      {r.lead && <span className="rounded-full bg-raised px-1.5 py-px text-[11px] font-medium text-ink-2">lead</span>}
                      {already && <span className="text-[11px] text-muted">já está na lista</span>}
                    </span>
                    <span className="block truncate font-mono text-xs text-muted">{displayPhone(r.phone)}</span>
                    {reason ? <span className="block text-xs text-amber-ink">{reason}</span> : mode === "marketing" ? <span className="block text-xs text-brand">Aceitou novidades</span> : null}
                  </span>
                </button>
              );
            })}
            {!rows.length && !loading && <p className="px-4 py-6 text-center text-sm text-muted">{query.trim() ? `Nenhum contato com “${query.trim()}”.` : filter === "leads" ? "Nenhum lead com WhatsApp neste chatbot." : filter === "aceitaram" ? "Ninguém aceitou novidades ainda neste chatbot." : "Nenhum contato do WhatsApp ainda."}</p>}
            {loading && <p className="px-4 py-3 text-center text-xs text-muted">Carregando…</p>}
          </div>
          {more && !loading && (
            <button type="button" onClick={() => load(query, filter, page + 1)} className="self-center text-xs font-semibold text-brand hover:underline">
              Mostrar mais
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
