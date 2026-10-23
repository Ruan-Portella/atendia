import Link from "next/link";
import { ArrowLeft, Clock, Moon, Ticket, UserRound } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { BASE_QUEUES, inQueue, waitLabel, type InboxItem, type Queue } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { AutoRefresh } from "@/components/auto-refresh";
import { BotFace } from "@/components/bot-face";
import { ContactAvatar } from "@/components/contact-avatar";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ScrollRow } from "@/components/ui/scroll-row";
import { ContactPane } from "@/components/contact-pane";

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site", painel: "Teste", demo: "Demo" };
const FROM: Record<string, string> = { ia: "IA: ", equipe: "Equipe: ", contato: "" };

/** A situação da conversa, sempre numa pílula com ponto (redesenho): a cor diz quem precisa agir. */
export function statusOf(i: InboxItem, meId: string): { label: string; tone: "danger" | "amber" | "info" | "brand" | "neutral"; pulse?: boolean } {
  if (i.urgent) return { label: "Urgente", tone: "danger", pulse: true };
  if (i.state === "com_ia") return i.aiPaused ? { label: "IA pausada pela integração", tone: "neutral" } : { label: "Com a IA", tone: "brand" };
  if (i.state === "aguardando") return { label: "Esperando", tone: "amber", pulse: true };
  if (i.state === "sem_resposta") return { label: "Sem resposta há 1 h", tone: "amber" };
  if (i.assignedId === meId) return { label: "Com você", tone: "info" };
  return { label: i.assignedName ? `Com ${i.assignedName}` : "Em atendimento", tone: "neutral" };
}

const TONE = {
  danger: "bg-danger-soft text-danger",
  amber: "bg-amber-soft text-amber-ink",
  info: "bg-info-soft text-info",
  brand: "bg-brand-soft text-brand",
  neutral: "bg-raised text-ink-2",
} as const;
const DOT = { danger: "bg-danger", amber: "bg-amber", info: "bg-info", brand: "bg-brand", neutral: "bg-muted" } as const;

export function StatusPill({ status }: { status: ReturnType<typeof statusOf> }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium", TONE[status.tone])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[status.tone], status.pulse && "animate-[bv-pulse_1.4s_infinite]")} aria-hidden />
      {status.label}
    </span>
  );
}

/**
 * Caixa de entrada (parte 3; redesenho, etapa 2), igual no painel e na área do cliente: a lista
 * com as filas em pílulas no alto e a conversa ao lado (com o painel do contato nas telas largas).
 * No celular, a lista ocupa a tela e a conversa abre por cima.
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
  contactOpen = true,
  backInHeader = false,
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
  /** a área do cliente é mais estreita: sem a coluna do contato (ele abre numa faixa em cima da conversa) */
  compact?: boolean;
  /** o painel do contato da conversa aberta: coluna à direita nas telas largas, senão uma faixa que abre */
  contact?: React.ReactNode;
  /** a coluna do contato começa aberta (o cookie da pessoa; ela esconde e mostra pelo botão) */
  contactOpen?: boolean;
  /** a volta para a fila (no celular) fica no topo da conversa, e não numa linha em cima dela */
  backInHeader?: boolean;
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
      <section className={cn("flex w-full min-w-0 flex-col bg-panel shadow-[inset_-1px_0_0_var(--color-line)] md:w-[360px] md:shrink-0", selectedId && "hidden lg:flex")}>
        <div className="flex flex-col gap-3 px-4 pb-3 pt-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-normal leading-tight">Caixa de entrada</h1>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">{label} · {list.length}</p>
            </div>
            <ActionForm action={onAvailability.bind(null, !available)}>
              <SubmitButton className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors duration-[120ms]", available ? "bg-brand-soft text-brand" : "bg-raised text-muted")} pendingLabel="Salvando…" title={available ? "Você recebe conversas pelo rodízio. Clique para ficar ausente." : "Você não recebe conversas pelo rodízio. Clique para ficar disponível."}>
                {available ? <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden /> : <Moon size={12} aria-hidden />}
                {available ? "Disponível" : "Ausente"}
              </SubmitButton>
            </ActionForm>
          </div>
          {/* as filas: pílulas que rolam de lado (dedo, mouse, rodinha ou setas), com o número de cada uma */}
          <ScrollRow label="Filas" className="-mx-4" innerClassName="px-4">
            {all.map((q, k) => {
              const n = count(q.key);
              const on = q.key === queue;
              return (
                <span key={q.key} className="flex shrink-0 items-center gap-1.5">
                  {q.group && q.group !== all[k - 1]?.group && <span className="ml-1 h-4 w-px bg-line" aria-hidden />}
                  <Link
                    href={hrefFor({ queue: q.key })}
                    aria-current={on ? "page" : undefined}
                    title={q.group ? `${q.group} · ${q.label}` : undefined}
                    className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] transition-colors duration-[120ms]", on ? "bg-ink font-medium text-ground" : "bg-raised/70 text-ink-2 hover:bg-raised hover:text-ink")}
                  >
                    {q.label}
                    {n > 0 && <span className={cn("font-mono text-[10.5px]", on ? "text-ground/70" : "text-muted")}>{n}</span>}
                  </Link>
                </span>
              );
            })}
          </ScrollRow>
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
          {list.length === 0 && (
            <li className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-raised"><UserRound size={18} /></span>
              Nada nesta fila agora.
            </li>
          )}
          {list.map((i, k) => {
            const name = i.contact ?? (i.channel === "widget" ? "Visitante do site" : "Contato");
            const status = statusOf(i, meId);
            const on = i.id === selectedId;
            return (
              <li key={i.id} className="rise-in" style={{ animationDelay: `${Math.min(k, 10) * 25}ms` }}>
                <Link
                  href={hrefFor({ queue, conversationId: i.id })}
                  aria-current={on ? "true" : undefined}
                  className={cn(
                    "flex gap-3 rounded-[14px] px-2.5 py-2.5 transition-colors duration-[120ms]",
                    on ? "bg-raised shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "hover:bg-raised/60",
                    i.urgent && "shadow-[inset_3px_0_0_var(--color-danger)]",
                  )}
                >
                  <span className="relative mt-0.5 shrink-0">
                    {/* a foto (Instagram) ou as iniciais, com o canal no canto de baixo à esquerda (o rosto do chatbot fica à direita) */}
                    <ContactAvatar name={name} photo={i.photo} channel={i.channel} size={36} badge="bl" />
                    <BotFace color={i.botColor} face={i.botFace} size={16} className="absolute -bottom-1 -right-1 outline-2 outline-panel" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{name}</span>
                      <span className={cn("shrink-0 font-mono text-[11px] tabular", i.waiting ? "text-amber-ink" : "text-muted")}>{waitLabel(i.since)}</span>
                    </span>
                    {i.last ? (
                      <span className="truncate text-[13px] text-ink-2"><span className="text-muted">{FROM[i.last.from]}</span>{i.last.text || "foto ou arquivo"}</span>
                    ) : (
                      <span className="truncate text-[13px] text-muted">{i.state === "com_ia" ? "A IA está respondendo" : "Abra para ver as mensagens"}</span>
                    )}
                    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusPill status={status} />
                      <span className="min-w-0 truncate text-[11.5px] text-muted">{showClient ? `${i.clientName} · ` : ""}{CHANNEL[i.channel] ?? i.channel}</span>
                    </span>
                    {(i.sectorName || i.ticketProtocol || i.outsideHours || i.snoozedUntil || i.snoozeEnded) && (
                      <span className="mt-1 flex flex-wrap gap-1 text-[11px]">
                        {i.sectorName && <span className="rounded-md bg-raised px-1.5 py-0.5 text-ink-2">{i.sectorName}</span>}
                        {i.ticketProtocol && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 text-brand">
                            <Ticket size={11} aria-hidden />
                            <span className="font-mono">{i.ticketProtocol}</span>
                            {i.ticketStatus === "aguardando_cliente" ? " · aguardando o cliente" : ""}
                          </span>
                        )}
                        {i.outsideHours && <span className="rounded-md bg-raised px-1.5 py-0.5 text-muted">chegou fora do horário</span>}
                        {i.snoozedUntil && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-raised px-1.5 py-0.5 text-muted">
                            <Clock size={11} aria-hidden />
                            até {new Date(i.snoozedUntil).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                        {i.snoozeEnded && <span className="rounded-md bg-amber-soft px-1.5 py-0.5 font-medium text-amber-ink">voltou do adiamento</span>}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <div className={cn("min-w-0 flex-1 flex-col bg-ground", selectedId ? "flex" : "hidden lg:flex")}>
        {selectedId ? (
          <>
            {!backInHeader && (
              <Link href={hrefFor({ queue })} className="flex items-center gap-1.5 border-b border-line bg-panel px-4 py-2 text-[13px] font-medium text-muted lg:hidden">
                <ArrowLeft size={14} />
                {label}
              </Link>
            )}
            <div className="flex min-h-0 flex-1">
              <div className="min-h-0 min-w-0 flex-1">{children}</div>
              {/* o contato: coluna nas telas largas; nas outras, desliza da direita pelo botão do topo da conversa */}
              {contact && <ContactPane initialOpen={contactOpen} name={selected?.contact ?? null} photo={selected?.photo ?? null} wide={!compact}>{contact}</ContactPane>}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted">
            <span className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-raised"><UserRound size={20} /></span>
            Escolha uma conversa da lista para responder aqui.
          </div>
        )}
      </div>
    </div>
  );
}
