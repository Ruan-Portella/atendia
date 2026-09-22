"use client";

import { useState } from "react";
import type { ClientOption } from "@/lib/panel";
import { PriceInput } from "@/components/ui/price-input";

interface Props {
  clients: ClientOption[];
  /** undefined: primeiro cliente da lista; null: começa em "Novo cliente". */
  defaultClientId?: string | null;
  /** Nome sugerido para o cliente novo (ex.: o nome da demo). */
  suggestedName?: string;
  idPrefix?: string;
}

/**
 * Seletor de cliente para formulários de chatbot: escolhe um cliente existente ou
 * cria um novo na hora (campos `new_client_*`). Envia `client_id` ("new" para novo).
 */
export function ClientPicker({ clients, defaultClientId, suggestedName = "", idPrefix = "cp" }: Props) {
  const initial = defaultClientId && clients.some((c) => c.id === defaultClientId) ? defaultClientId : defaultClientId === undefined && clients.length ? clients[0].id : "new";
  const [value, setValue] = useState(initial);
  const isNew = value === "new";

  return (
    <div className="flex flex-col gap-3">
      {clients.length > 0 ? (
        <div>
          <label htmlFor={`${idPrefix}-client`} className="label">Cliente</label>
          <select id={`${idPrefix}-client`} name="client_id" value={value} onChange={(e) => setValue(e.target.value)} className="input">
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="new">+ Novo cliente</option>
          </select>
        </div>
      ) : (
        <input type="hidden" name="client_id" value="new" />
      )}
      {isNew && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-ground p-3.5">
          {clients.length > 0 && <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Novo cliente</span>}
          <div>
            <label htmlFor={`${idPrefix}-new-name`} className="label">Nome do cliente (empresa)</label>
            <input id={`${idPrefix}-new-name`} name="new_client_name" required minLength={2} maxLength={80} defaultValue={suggestedName} className="input" placeholder="Clínica Sorriso" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${idPrefix}-new-site`} className="label">Site (opcional)</label>
              <input id={`${idPrefix}-new-site`} name="new_client_site" maxLength={200} className="input" placeholder="clinicasorriso.com.br" />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-new-price`} className="label">Você cobra (R$/mês)</label>
              <PriceInput id={`${idPrefix}-new-price`} name="new_client_price" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
