import Link from "next/link";
import { Inbox } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { BASE_QUEUES, inQueue, waitLabel, type InboxItem, type Queue } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { AutoRefresh } from "@/components/auto-refresh";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site", painel: "Teste", demo: "Demo" };
const STATE: Record<InboxItem["state"], string> = { aguardando: "esperando", sem_resposta: "sem resposta há 1 h", em_atendimento: "em atendimento", com_ia: "com a IA" };

/**
 * Caixa de entrada (parte 3), igual no painel e na área do cliente: as filas à esquerda, a lista
 * no meio e a conversa à direita. No celular, a lista ocupa a tela e a conversa abre por cima.
 */
export function InboxView({
  items,
  queue,
  queues,
  meId,
  selectedId,
  hrefFor,
  showClient,
  available,
  onAvailability,
  compact = false,
  contact,
  children,
}: {
  items: InboxItem[];
  queue: Queue;
  /** as filas de setor (as de base vêm sempre) */
  queues: Array<{ key: Queue; label: string; group?: string }>;
  meId: string;
  selectedId: string | null;
  /** o link de uma conversa na fila aberta (a página põe ?fila= e &c=) */
  hrefFor: (o: { queue: Queue; conversationId?: string }) => string;
  showClient: boolean;
  available: boolean;
  onAvailability: (available: boolean) => Promise<ActionResult>;
  /** sem a coluna das filas (a área do cliente é mais estreita): as filas ficam em botões em cima da lista */
  compact?: boolean;
  /** o painel do contato da conversa aberta: coluna à direita nas telas largas, senão uma faixa que abre */
  contact?: React.ReactNode;
  /** a conversa aberta (lado direito) */
  children?: React.ReactNode;
}) {
  const all: Array<{ key: Queue; label: string; group?: string }> = [...BASE_QUEUES, ...queues];
  const list = items.filter((i) => inQueue(i, queue, meId));
  const count = (q: Queue) => items.filter((i) => inQueue(i, q, meId)).length;
  const label = all.find((q) => q.key === queue)?.label ?? "Minhas";
  const selected = items.find((i) => i.id === selectedId);
  return (
    <div className="flex h-full min-h-0 flex-1">
      <AutoRefresh ms={10_000} />
      <aside className={cn("hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-panel p-3", !compact && "md:flex")}>
        <div className="flex items-center gap-2 px-2 pb-2 text-sm font-bold">
          <Inbox size={16} />
          Caixa de entrada
        </div>
        {all.map((q, k) => (
          <div key={q.key}>
            {q.group && q.group !== all[k - 1]?.group && <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{q.group}</p>}
            <Link href={hrefFor({ queue: q.key })} className={cn("flex items-center justify-between rounded-lg px-2 py-1.5 text-sm", q.key === queue ? "bg-brand-soft font-semibold text-brand" : "text-ink-2 hover:bg-ground")}>
              <span className="truncate">{q.label}</span>
              <span className="tabular text-xs text-muted">{count(q.key) || ""}</span>
            </Link>
          </div>
        ))}
        <div className="mt-auto border-t border-line-2 pt-3">
          <ActionForm action={onAvailability.bind(null, !available)}>
            <SubmitButton className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-ground" pendingLabel="Salvando…">
              <span className={cn("h-2 w-2 rounded-full", available ? "bg-brand" : "bg-muted")} aria-hidden />
              {available ? "Disponível" : "Ausente"}
              <span className="ml-auto text-xs text-muted">trocar</span>
            </SubmitButton>
          </ActionForm>
        </div>
      </aside>

      <section className={cn("flex w-full min-w-0 flex-col border-r border-line bg-ground md:w-[340px] md:shrink-0", selectedId && "hidden lg:flex")}>
        <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
          <h1 className="text-lg font-bold">{label}</h1>
          {/* no celular, as filas viram uma linha de botões */}
          <div className={cn("flex gap-1.5 overflow-x-auto pb-1", !compact && "md:hidden")}>
            {all.map((q) => (
              <Link key={q.key} href={hrefFor({ queue: q.key })} className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-semibold", q.key === queue ? "border-brand bg-brand-soft text-brand" : "border-line text-muted")}>
                {q.label} {count(q.key) || ""}
              </Link>
            ))}
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 && <li className="p-6 text-sm text-muted">Nada nesta fila agora.</li>}
          {list.map((i) => (
            <li key={i.id}>
              <Link href={hrefFor({ queue, conversationId: i.id })} className={cn("flex flex-col gap-1 border-b border-line-2 px-4 py-3 text-sm hover:bg-panel", i.id === selectedId && "bg-panel", i.urgent && "border-l-4 border-l-danger")}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{i.contact ?? (i.channel === "widget" ? "Visitante do site" : "Contato")}</span>
                  <span className={cn("tabular shrink-0 text-xs", i.waiting ? "font-semibold text-amber-ink" : "text-muted")}>{waitLabel(i.since)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                  <span>{CHANNEL[i.channel] ?? i.channel}</span>
                  <span>· {showClient ? `${i.clientName} · ` : ""}{i.botName}</span>
                  {i.sectorName && <span className="rounded-full bg-ground px-1.5 font-medium text-ink-2">{i.sectorName}</span>}
                  {i.ticketProtocol && <span className="rounded-full bg-brand-soft px-1.5 font-mono font-medium text-brand">chamado {i.ticketProtocol}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs">
                  <span className={i.urgent ? "font-semibold text-danger" : i.waiting ? "text-amber-ink" : i.state === "com_ia" ? "text-muted" : "text-brand"}>{i.urgent ? "urgente · " : ""}{i.aiPaused ? "IA pausada pela integração" : STATE[i.state]}</span>
                  {i.assignedId && <span className="text-muted">· {i.assignedId === meId ? "com você" : `com ${i.assignedName ?? "outra pessoa"}`}</span>}
                  {i.outsideHours && <span className="text-muted">· chegou fora do horário</span>}
                  {i.snoozedUntil && <span className="text-muted">· adiada até {new Date(i.snoozedUntil).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
                  {i.snoozeEnded && <span className="font-semibold text-ink-2">· voltou do adiamento</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className={cn("min-w-0 flex-1 flex-col bg-ground", selectedId ? "flex" : "hidden lg:flex")}>
        {selectedId ? (
          <>
            <Link href={hrefFor({ queue })} className="border-b border-line px-4 py-2 text-xs font-semibold text-muted lg:hidden">← {label}</Link>
            {contact && (
              <details className={cn("border-b border-line bg-panel", !compact && "2xl:hidden")}>
                <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-muted">Contato{selected?.contact ? `: ${selected.contact}` : ""}</summary>
                <div className="max-h-[45dvh] overflow-y-auto border-t border-line-2">{contact}</div>
              </details>
            )}
            <div className="flex min-h-0 flex-1">
              <div className="min-h-0 min-w-0 flex-1">{children}</div>
              {contact && !compact && <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-line bg-panel 2xl:block">{contact}</aside>}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted">Escolha uma conversa da lista para responder aqui.</div>
        )}
      </div>
    </div>
  );
}
