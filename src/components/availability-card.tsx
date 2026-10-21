import type { ActionResult } from "@/lib/action-result";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";

/**
 * Disponível ou Ausente (Caixa de entrada, parte 2): nos setores com rodízio, a conversa só vai
 * para quem está disponível e com o painel aberto. Painel e área do cliente.
 */
export function AvailabilityCard({ available, action }: { available: boolean; action: (available: boolean) => Promise<ActionResult> }) {
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", available ? "bg-brand" : "bg-muted")} aria-hidden />
        <div>
          <h2 className="text-base font-bold">{available ? "Disponível para atender" : "Ausente"}</h2>
          <p className="text-sm text-muted">
            {available
              ? "Nos setores com rodízio, as conversas vêm para você enquanto o painel estiver aberto. Saindo para o almoço ou no fim do dia, marque ausente."
              : "O rodízio dos setores pula você. As conversas que já são suas continuam com você."}
          </p>
        </div>
      </div>
      <ActionForm action={action.bind(null, !available)}>
        <SubmitButton className={available ? "btn-ghost" : "btn-primary"} pendingLabel="Salvando…">
          {available ? "Ficar ausente" : "Ficar disponível"}
        </SubmitButton>
      </ActionForm>
    </section>
  );
}
