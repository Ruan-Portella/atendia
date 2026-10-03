"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

/**
 * Formulário do backoffice cujo resultado fica na tela (não num aviso que some): segredo mostrado
 * uma vez, resposta do Testar. `copy`: mostra o botão de copiar quando deu certo.
 */
export function ResultForm({ action, copy = false, className, children }: { action: (fd: FormData) => Promise<ActionResult>; copy?: boolean; className?: string; children: React.ReactNode }) {
  const [state, formAction] = useActionState(async (_prev: ActionResult | null, fd: FormData) => {
    try {
      return await action(fd);
    } catch {
      return { ok: false, message: "Não foi possível concluir agora. Tente de novo." } as ActionResult;
    }
  }, null);
  return (
    <form action={formAction} className={cn("flex flex-col gap-2", className)}>
      {children}
      {state?.message && (
        <div className={cn("flex flex-col gap-2 rounded-lg px-3 py-2 text-xs", state.ok ? "bg-ground" : "bg-danger-soft text-danger")}>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono">{state.message}</pre>
          {copy && state.ok && <CopyButton text={state.message.split("\n")[0]} className="btn-ghost self-start py-1 text-xs" />}
        </div>
      )}
    </form>
  );
}
