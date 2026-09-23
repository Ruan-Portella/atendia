import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import type { OnboardingStep } from "@/lib/onboarding";
import { hideOnboarding } from "@/app/painel/actions";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";

/**
 * Card "Primeiros passos" da home do painel. Cada passo se marca sozinho pelos dados
 * (ver `onboardingSteps`); o próximo a fazer fica em destaque. Some quando tudo está pronto.
 */
export function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const next = steps.find((s) => !s.done)!;
  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <section aria-labelledby="onboarding-title" className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-2 px-4 py-4 sm:px-[18px]">
        <div className="min-w-0">
          <h2 id="onboarding-title" className="text-base font-bold">Primeiros passos</h2>
          <p className="text-sm text-muted">Do cadastro ao chat respondendo no site do cliente. {doneCount} de {steps.length} feitos.</p>
        </div>
        <ActionForm action={hideOnboarding}>
          <SubmitButton pendingLabel="Ocultando…" className="text-sm font-semibold text-muted hover:text-ink">Ocultar</SubmitButton>
        </ActionForm>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso">
          <div className="h-full rounded-full bg-brand transition-[width] duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ol>
        {steps.map((s, i) => {
          const current = s.key === next.key;
          return (
            <li key={s.key} className={cn("flex items-start gap-3 border-b border-line-2 px-4 py-3 last:border-0 sm:px-[18px]", current && "bg-brand-soft/50")}>
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                  s.done ? "bg-brand text-white" : current ? "border-2 border-brand text-brand" : "border border-line text-muted",
                )}
              >
                {s.done ? <Check size={13} strokeWidth={3} aria-label="Feito" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-semibold", s.done && "text-muted line-through decoration-line")}>{s.title}</p>
                {!s.done && <p className="text-[13px] text-muted">{s.hint}</p>}
              </div>
              {!s.done && (
                <Link href={s.href} className={cn("shrink-0 self-center", current ? "btn-primary" : "btn-ghost hidden sm:inline-flex")}>
                  {s.cta}
                  {current && <ArrowRight size={15} />}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
