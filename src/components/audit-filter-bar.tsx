"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

type Option = [string, string];

/**
 * Os filtros da Auditoria (redesenho, etapa 5): cada escolha já filtra, sem o botão Filtrar; o CSV
 * baixa com os mesmos filtros.
 */
export function AuditFilterBar({ values, periods, actors, groups, clients, csvHref }: { values: { dias: string; quem: string; tipo: string; cliente: string }; periods: Option[]; actors: Option[]; groups: Option[]; clients: Option[]; csvHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (key: keyof typeof values, value: string) => {
    const p = new URLSearchParams({ aba: "auditoria" });
    const next = { ...values, [key]: value };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    start(() => router.push(`/painel/seguranca?${p.toString()}`));
  };
  const select = (key: keyof typeof values, label: string, options: Option[], all?: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <select value={values[key]} onChange={(e) => go(key, e.target.value)} className="input w-auto max-w-[220px] py-1.5 text-sm">
        {all !== undefined && <option value="">{all}</option>}
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className={cn("flex flex-wrap items-end gap-2 transition-opacity duration-[120ms]", pending && "opacity-60")}>
      {select("dias", "Período", periods)}
      {select("quem", "Quem", actors, "Todos")}
      {select("tipo", "Tipo", groups, "Todos")}
      {clients.length > 0 && select("cliente", "Cliente", clients, "Todos")}
      <a href={csvHref} className="btn-ghost ml-auto py-1.5 text-sm">
        <Download size={14} />
        Baixar CSV
      </a>
    </div>
  );
}
