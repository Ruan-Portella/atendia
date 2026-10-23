"use client";

import { useState } from "react";
import { FileText, Search } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import type { SendableTemplate } from "@/lib/template-text";
import { fold } from "@/lib/go-to";
import { cn } from "@/lib/utils";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { TemplateBody, shortText, slotName } from "@/components/template-slots";

/**
 * Envio de um modelo aprovado. Redesenho (23/10/2026, a pedido do usuário, no molde da Nova
 * campanha): os modelos em cartões com o começo do texto (com busca quando são muitos), um campo
 * por variável com o nome "Campo 1", "Campo 2"… e a prévia no balão, com a etiqueta do campo que
 * está sendo editado acesa. Sem `askPhone`, o número já vem da conversa.
 */
export function TemplateSender({ templates, action, askPhone = false, submitLabel = "Enviar modelo", defaults = [], onSent }: {
  templates: SendableTemplate[];
  action: (fd: FormData) => Promise<ActionResult | void>;
  askPhone?: boolean;
  submitLabel?: string;
  /** Valores sugeridos para as variáveis, na ordem (ex.: o nome do contato no primeiro campo). */
  defaults?: string[];
  /** Chamado depois de um envio que deu certo (ex.: fechar o modal). */
  onSent?: () => void;
}) {
  const [name, setName] = useState(templates[0]?.name ?? "");
  const [values, setValues] = useState<string[]>(defaults);
  const [active, setActive] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const t = templates.find((x) => x.name === name);

  if (!templates.length) {
    return <p className="text-sm text-muted">Nenhum modelo aprovado ainda. Crie um na aba WhatsApp do chatbot; a Meta costuma aprovar em minutos.</p>;
  }

  const set = (i: number, v: string) => setValues((prev) => Object.assign([...prev], { [i]: v }));
  const q = fold(query.trim());
  const shown = q ? templates.filter((x) => fold(`${x.name} ${x.body}`).includes(q)) : templates;

  return (
    <ActionForm action={action} onSuccess={onSent} className="flex flex-col gap-4">
      {askPhone && (
        <div>
          <label htmlFor="tpl-to" className="label">
            WhatsApp do contato (com DDD)
          </label>
          <input id="tpl-to" name="to" required inputMode="tel" className="input" placeholder="21 99999-9999" />
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="label">Modelo</legend>
        <input type="hidden" name="template" value={name} />
        {templates.length > 5 && (
          <label className="flex items-center gap-2 rounded-[10px] bg-field px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
            <Search size={14} className="shrink-0 text-muted" />
            <span className="sr-only">Buscar modelo</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar pelo nome ou pelo texto" className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none" />
          </label>
        )}
        <div role="radiogroup" aria-label="Modelo" className="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto">
          {shown.length === 0 && <p className="px-1 py-3 text-sm text-muted">Nenhum modelo com &ldquo;{query.trim()}&rdquo;.</p>}
          {shown.map((x) => {
            const on = x.name === name;
            return (
              <button
                key={x.name}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setName(x.name);
                  setActive(null);
                }}
                className={cn("flex items-start gap-2.5 rounded-[12px] border px-3 py-2.5 text-left transition-colors duration-[120ms]", on ? "border-brand bg-brand-soft/60" : "border-line hover:border-line-strong")}
              >
                <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]", on ? "bg-brand text-on-brand" : "bg-raised text-ink-2")}>
                  <FileText size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate font-mono text-[12.5px] font-medium text-ink">{x.name}</span>
                    {x.category === "MARKETING" && <span className="rounded-full bg-amber-soft px-1.5 py-px text-[11px] font-medium text-amber-ink">marketing: só quem aceitou novidades</span>}
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted">{x.body.replace(/\{\{(\d+)\}\}/g, (_, n) => `[${slotName(Number(n) - 1, x.vars)}]`)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {t && t.vars > 0 && (
        <div className="flex flex-col gap-2">
          <span className="label">O que entra no texto</span>
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: t.vars }, (_, i) => (
              <div key={`${t.name}-${i}`}>
                <label htmlFor={`param_${i + 1}`} className="text-[12.5px] font-medium text-ink-2">
                  {slotName(i, t.vars)}
                </label>
                <input id={`param_${i + 1}`} name={`param_${i + 1}`} required value={values[i] ?? ""} onChange={(e) => set(i, e.target.value)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} className="input mt-1" />
              </div>
            ))}
          </div>
        </div>
      )}

      {t && (
        <div className="flex flex-col gap-2">
          <span className="kpi-label">Como o contato recebe</span>
          <div className="rounded-[14px] bg-raised p-3">
            <TemplateBody body={t.body} active={active} label={(i) => (values[i]?.trim() ? shortText(values[i]) : slotName(i, t.vars))} />
          </div>
        </div>
      )}
      <SubmitButton pendingLabel="Enviando…" className="btn-primary self-end px-5">
        {submitLabel}
      </SubmitButton>
    </ActionForm>
  );
}
