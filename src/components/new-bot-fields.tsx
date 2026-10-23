"use client";

import { useState } from "react";
import { Layers } from "lucide-react";
import type { ClientOption } from "@/lib/panel";
import { ClientPicker } from "@/components/client-picker";
import { Segmented } from "@/components/template-slots";
import { cn } from "@/lib/utils";

/**
 * Os campos do chatbot novo: o cliente, o nome do assistente e o site (a tela Novo chatbot e o modal
 * da lista de Clientes; redesenho, etapa 5). Vão para createBot, que abre o chatbot criado. Com
 * modelos (pacote Plataforma, a pedido do usuário em 22/10), dá para começar de um modelo: o campo
 * `start` diz qual, e o nome vem do modelo (createDerivedAction).
 */
export function NewBotFields({ clients, defaultClientId, suggestedName = "", idPrefix, templates = [], business = false }: { clients: ClientOption[]; defaultClientId?: string; suggestedName?: string; business?: boolean; idPrefix: string; templates?: Array<{ id: string; name: string }> }) {
  const [start, setStart] = useState<"branco" | "modelo">("branco");
  const [template, setTemplate] = useState(templates[0]?.id ?? "");
  const fromTemplate = start === "modelo" && templates.length > 0;
  return (
    <>
      {templates.length > 0 && (
        <div className="flex flex-col gap-2">
          <input type="hidden" name="start" value={start} />
          <Segmented
            label="Como começar"
            value={start}
            onChange={setStart}
            options={[
              ["branco", "Em branco"],
              ["modelo", "A partir de um modelo"],
            ]}
          />
          {fromTemplate && (
            <div role="radiogroup" aria-label="Modelo" className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="template_id" value={template} />
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={template === t.id}
                  onClick={() => setTemplate(t.id)}
                  className={cn("flex items-center gap-2.5 rounded-[14px] border p-3 text-left transition-colors duration-[120ms]", template === t.id ? "border-brand bg-brand-soft/60" : "border-line hover:border-line-strong")}
                >
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]", template === t.id ? "bg-brand text-on-brand" : "bg-raised text-ink-2")}>
                    <Layers size={15} />
                  </span>
                  <span className="truncate text-sm font-medium text-ink">{t.name}</span>
                </button>
              ))}
            </div>
          )}
          {fromTemplate && <p className="text-xs text-muted">O chatbot nasce com o nome, a personalidade, as ações, os roteiros e a base do modelo, e recebe o que for publicado nele. O contexto fixo (a loja) você põe depois, na aba Ações.</p>}
        </div>
      )}
      {/* o próprio negócio: o cliente do chatbot é ele mesmo (o nome vem do primeiro acesso) */}
      <ClientPicker clients={clients} defaultClientId={defaultClientId} suggestedName={suggestedName} idPrefix={idPrefix} business={business} />
      {!fromTemplate && (
        <>
          <div>
            <label htmlFor={`${idPrefix}-name`} className="label">
              Nome do assistente
            </label>
            <input id={`${idPrefix}-name`} name="name" required minLength={2} maxLength={40} className="input" placeholder="Sofia" defaultValue="Assistente" />
            <p className="mt-1 text-xs text-muted">De 2 a 40 caracteres. É como ele se apresenta no chat.</p>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-site`} className="label">
              Site onde o chatbot vai ficar (opcional)
            </label>
            <input id={`${idPrefix}-site`} name="client_site" maxLength={200} className="input" placeholder="clinicasorriso.com.br" />
            <p className="mt-1 text-xs text-muted">Em branco, usa o site do cliente.</p>
          </div>
        </>
      )}
    </>
  );
}
