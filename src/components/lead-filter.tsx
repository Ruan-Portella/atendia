"use client";

import { useRouter, useSearchParams } from "next/navigation";

/** Filtro por cliente na página de leads: troca o ?cliente= da URL. */
export function LeadFilter({ clients }: { clients: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const sp = useSearchParams();
  const current = sp.get("cliente") ?? "";
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Cliente
      <select
        value={current}
        onChange={(e) => router.replace(e.target.value ? `/painel/leads?cliente=${e.target.value}` : "/painel/leads")}
        className="input w-auto py-1.5"
        aria-label="Filtrar leads por cliente"
      >
        <option value="">Todos</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </label>
  );
}
