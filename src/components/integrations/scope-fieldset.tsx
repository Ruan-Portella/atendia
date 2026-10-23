"use client";

import { useState } from "react";
import { MultiSelect } from "@/components/ui/multi-select";
import { Segmented } from "@/components/template-slots";

type ScopeType = "bots" | "client" | "all";

/**
 * Escopo de chave de API ou webhook: chatbots escolhidos, todos de um cliente ou todos da agência.
 * Redesenho, etapa 5 (a pedido do usuário em 22/10): a escolha em botões lado a lado e os chatbots
 * num campo de escolha múltipla com busca, agrupados pelo cliente, no lugar das caixinhas. Os campos
 * do formulário não mudam (scope_type, bot, client_id).
 */
export function ScopeFieldset({
  bots,
  clients,
  allLabel = "Todos os chatbots da agência (inclusive os futuros)",
  value,
}: {
  bots: Array<{ id: string; name: string; clientName: string }>;
  clients: Array<{ id: string; name: string }>;
  allLabel?: string;
  /** escopo já gravado (edição) */
  value?: { type: string; botIds: string[]; clientId: string | null };
}) {
  const [type, setType] = useState<ScopeType>((["bots", "client", "all"].includes(value?.type ?? "") ? value?.type : "bots") as ScopeType);
  return (
    <div className="flex flex-col gap-2">
      <span className="label mb-0">Escopo</span>
      <input type="hidden" name="scope_type" value={type} />
      <Segmented
        label="Escopo"
        value={type}
        onChange={setType}
        options={[
          ["bots", "Alguns chatbots"],
          ["client", "Um cliente"],
          ["all", "Toda a conta"],
        ]}
      />
      {/* os três ficam no formulário (o servidor lê só o do tipo escolhido); só o do tipo aparece */}
      <div className={type === "bots" ? "flex flex-col gap-1" : "hidden"}>
        <MultiSelect name="bot" label="Chatbots" placeholder="Escolha os chatbots…" options={[...bots].sort((a, b) => a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name)).map((b) => ({ value: b.id, label: b.name, group: b.clientName }))} defaultValue={value?.botIds ?? []} empty="Nenhum chatbot com esse nome." />
        <p className="text-xs text-muted">Só os chatbots escolhidos; os novos não entram sozinhos.</p>
      </div>
      <div className={type === "client" ? "flex flex-col gap-1" : "hidden"}>
        <select name="client_id" className="input" defaultValue={value?.clientId ?? ""} aria-label="Cliente">
          <option value="">Escolha o cliente…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted">Todos os chatbots do cliente, inclusive os que ele ganhar depois.</p>
      </div>
      {type === "all" && <p className="rounded-[12px] bg-raised px-3 py-2 text-sm text-ink-2">{allLabel}.</p>}
    </div>
  );
}
