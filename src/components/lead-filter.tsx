"use client";

import { useRouter, useSearchParams } from "next/navigation";

/** Filtro por cliente na página de leads: troca o ?bot= da URL. */
export function LeadFilter({ bots }: { bots: Array<{ id: string; client_name: string }> }) {
  const router = useRouter();
  const sp = useSearchParams();
  const current = sp.get("bot") ?? "";
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Cliente
      <select
        value={current}
        onChange={(e) => router.replace(e.target.value ? `/painel/leads?bot=${e.target.value}` : "/painel/leads")}
        className="input w-auto py-1.5"
        aria-label="Filtrar leads por cliente"
      >
        <option value="">Todos</option>
        {bots.map((b) => (
          <option key={b.id} value={b.id}>{b.client_name}</option>
        ))}
      </select>
    </label>
  );
}
