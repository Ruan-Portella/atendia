"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { ArrowRight, Check, ChevronDown, ChevronRight, ChevronUp, PartyPopper } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import type { OnboardingStep } from "@/lib/onboarding";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { cn } from "@/lib/utils";

// o que fica neste navegador: aberto ou fechado e quantos passos estavam feitos (para comemorar o próximo)
const OPEN_KEY = "bv-passos-aberto";
const DONE_KEY = "bv-passos-feitos";
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const memory = new Map<string, string>();
function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}
function write(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // sem armazenamento: vale até recarregar
  }
  listeners.forEach((l) => l());
}

/** Deixa o widget aberto (o "Primeiros passos" do menu da conta e do Ctrl K, antes de mostrar de novo). */
export function openOnboardingWidget() {
  write(OPEN_KEY, "1");
}

/** O anel do progresso, no botão fechado. */
function Ring({ done, total }: { done: number; total: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden className="-rotate-90">
      <circle cx="12" cy="12" r={r} fill="none" strokeWidth="3" className="stroke-line-2" />
      <circle cx="12" cy="12" r={r} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - done / total)} className="stroke-brand transition-[stroke-dashoffset] duration-[420ms]" />
    </svg>
  );
}

/**
 * Primeiros passos num widget no canto direito (redesenho, etapa 5, a pedido do usuário em 22/10,
 * com o Fintra de referência): fechado, um botão com o anel do progresso; aberto, os passos, o
 * próximo em destaque com o botão de fazer. Acompanha a pessoa pelo painel (some na Caixa de
 * entrada e nas conversas, onde ficaria em cima do campo de resposta), comemora quando um passo é
 * feito e, com tudo pronto, mostra o "Tudo pronto" uma vez antes de sumir.
 */
export function OnboardingWidget({ steps, goal, changeProfile, hide }: { steps: OnboardingStep[]; goal: string; changeProfile: boolean; hide: () => Promise<ActionResult> }) {
  const path = usePathname() ?? "";
  const done = steps.filter((s) => s.done).length;
  const total = steps.length;
  const next = steps.find((s) => !s.done) ?? null;
  // sem preferência guardada, abre na tela de Clientes (a inicial) e fica fechado nas outras
  const stored = useSyncExternalStore(subscribe, () => read(OPEN_KEY), () => null);
  const open = stored === null ? path === "/painel/clientes" : stored === "1";
  const prev = useSyncExternalStore(subscribe, () => read(DONE_KEY), () => null);
  const celebrating = prev !== null && Number(prev) < done;

  // guarda os feitos de agora: na primeira vez na hora; depois de um passo novo, quando a comemoração
  // termina. Lê o guardado direto (na hidratação, o `prev` ainda é o do servidor, null)
  useEffect(() => {
    const saved = read(DONE_KEY);
    if (saved === null || Number(saved) > done) write(DONE_KEY, String(done));
    else if (Number(saved) < done) {
      const t = setTimeout(() => write(DONE_KEY, String(done)), 6000);
      return () => clearTimeout(t);
    }
  }, [prev, done]);

  if (path.startsWith("/painel/caixa") || path.includes("/conversas/")) return null;
  const setOpen = (v: boolean) => write(OPEN_KEY, v ? "1" : "0");
  const allDone = done === total;
  // na página do chatbot, abaixo de lg, o "Testar assistente" fica no mesmo canto
  const lift = path.startsWith("/painel/bots/") ? "bottom-20 lg:bottom-4" : "bottom-4";

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Primeiros passos: ${done} de ${total} feitos. Abrir`}
        className={cn(
          "fixed right-4 z-30 flex max-w-[calc(100vw-2rem)] items-center gap-2.5 rounded-full bg-panel py-2 pl-2.5 pr-3.5 text-sm shadow-[inset_0_0_0_1px_var(--color-line),var(--shadow-pop)] transition-transform duration-[120ms] hover:-translate-y-0.5",
          lift,
          celebrating && "[animation:bv-pop_var(--dur-slow)_var(--ease-spring)]",
        )}
      >
        {allDone ? <PartyPopper size={20} className="text-brand" /> : <Ring done={done} total={total} />}
        <span className="min-w-0 truncate font-medium text-ink">{allDone ? "Tudo pronto!" : celebrating && next ? `Feito! Próximo: ${next.title}` : `${done} de ${total} passos`}</span>
        <ChevronUp size={15} className="shrink-0 text-muted" />
      </button>
    );

  return (
    <section aria-labelledby="passos-titulo" className={cn("menu-in fixed right-4 z-30 flex max-h-[calc(100dvh-6rem)] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[18px] bg-panel shadow-[inset_0_0_0_1px_var(--color-line),var(--shadow-pop)]", lift)}>
      <div className="flex flex-col gap-2.5 border-b border-line-2 px-4 pb-3.5 pt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="passos-titulo" className="text-[15px] font-medium text-ink">
              {allDone ? "Tudo pronto!" : "Primeiros passos"}
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{allDone ? "Você fez todos os primeiros passos. Daqui em diante, é com você." : `${done} de ${total} feitos · ${goal}`}</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Minimizar os primeiros passos" className="btn-icon -mr-1.5 -mt-1 shrink-0">
            <ChevronDown size={17} />
          </button>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line-2" role="progressbar" aria-valuenow={Math.round((done / total) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso dos primeiros passos">
          <div className="h-full rounded-full bg-brand transition-[width] duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      </div>

      <ol className="min-h-0 overflow-y-auto py-1.5">
        {steps.map((s, i) => {
          const current = next?.key === s.key;
          const mark = (
            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", s.done ? "bg-brand text-on-brand" : current ? "text-brand shadow-[inset_0_0_0_2px_var(--color-brand)]" : "text-muted shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]")}>
              {s.done ? <Check size={13} strokeWidth={3} aria-label="Feito" /> : i + 1}
            </span>
          );
          if (s.done)
            return (
              <li key={s.key} className="flex items-center gap-3 px-4 py-2">
                {mark}
                <span className="text-sm text-muted line-through decoration-line-strong">{s.title}</span>
              </li>
            );
          if (current)
            return (
              <li key={s.key} className="mx-2 my-1 flex flex-col gap-2.5 rounded-[14px] bg-brand-soft/60 px-2 py-3">
                <div className="flex items-start gap-3 px-1">
                  {mark}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{s.title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-2">{s.hint}</span>
                  </span>
                </div>
                <Link href={s.href} className="btn-primary ml-10 self-start py-1.5 text-[13px]">
                  {s.cta} <ArrowRight size={14} />
                </Link>
              </li>
            );
          return (
            <li key={s.key}>
              <Link href={s.href} className="group flex items-center gap-3 px-4 py-2 transition-colors duration-[120ms] hover:bg-raised/50">
                {mark}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.title}</span>
                <ChevronRight size={15} className="shrink-0 text-muted transition-transform duration-[120ms] group-hover:translate-x-0.5" />
              </Link>
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-3 border-t border-line-2 px-4 py-2.5 text-xs">
        {changeProfile && !allDone && (
          <Link href="/comecar?editar" className="font-semibold text-brand hover:underline">
            Mudar o perfil
          </Link>
        )}
        <span className="ml-auto">
          {allDone ? (
            <ConfirmAction action={hide} title="Fechar os primeiros passos?" description="Eles somem para você em todo o painel. Para ver de novo: menu da sua conta → Primeiros passos." confirmLabel="Fechar" danger={false} className="btn-primary py-1.5 text-[13px]">
              Fechar
            </ConfirmAction>
          ) : (
            <ConfirmAction action={hide} title="Ocultar os primeiros passos?" description="Eles somem para você em todo o painel. Para ver de novo: no menu da sua conta (o seu nome, embaixo do menu) ou no Ctrl K, em Primeiros passos." confirmLabel="Ocultar" danger={false} className="font-semibold text-muted hover:text-ink">
              Ocultar
            </ConfirmAction>
          )}
        </span>
      </div>
    </section>
  );
}
