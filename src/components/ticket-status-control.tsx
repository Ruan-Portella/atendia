"use client";

import type { ActionResult } from "@/lib/action-result";
import { ActionForm } from "@/components/ui/action-form";

const LABEL: Record<string, string> = { aberto: "Aberto", em_andamento: "Em andamento", aguardando_cliente: "Aguardando o cliente", resolvido: "Resolvido" };

/**
 * O status do chamado na conversa (Chamados, parte 7c): trocar já salva. Resolvido tira o chamado
 * da Caixa de entrada; a pessoa escrevendo de novo pelo acompanhamento reabre.
 */
export function TicketStatusControl({ protocol, subject, status, action }: { protocol: string; subject: string | null; status: string; action: (fd: FormData) => Promise<ActionResult> }) {
  return (
    <ActionForm action={action} className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-semibold text-brand">
        Chamado <span className="font-mono">{protocol}</span>
        {subject ? ` · ${subject}` : ""}
      </span>
      <label className="sr-only" htmlFor={`ticket-status-${protocol}`}>Status do chamado</label>
      <select id={`ticket-status-${protocol}`} name="status" defaultValue={status} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="input w-auto py-0.5 text-xs">
        {Object.entries(LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </ActionForm>
  );
}
