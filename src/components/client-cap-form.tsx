"use client";

import type { ActionResult } from "@/lib/action-result";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

/** Sublimite de atendimentos do mês de um cliente (vazio = sem sublimite, usa a cota da agência). */
export function ClientCapForm({ action, cap, clientName }: { action: (formData: FormData) => Promise<ActionResult>; cap: number | null; clientName: string }) {
  return (
    <ActionForm action={action} className="flex items-center justify-end gap-1.5">
      <input
        name="cap"
        inputMode="numeric"
        pattern="[0-9.]*"
        defaultValue={cap ?? ""}
        placeholder="sem limite"
        aria-label={`Limite de atendimentos por mês de ${clientName}`}
        className="input w-28 py-1 text-right tabular"
      />
      <SubmitButton className="btn-ghost px-2.5 py-1 text-xs" pendingLabel="…">Salvar</SubmitButton>
    </ActionForm>
  );
}
