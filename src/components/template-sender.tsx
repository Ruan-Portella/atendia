"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { renderTemplate, type SendableTemplate } from "@/lib/template-text";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Envio de um modelo aprovado: escolhe o modelo e aparecem só os campos das variáveis dele,
 * com a mensagem montada ao vivo. Sem `askPhone`, o número já vem da conversa.
 */
export function TemplateSender({ templates, action, askPhone = false, submitLabel = "Enviar modelo", defaults = [], onSent }: {
  templates: SendableTemplate[];
  action: (fd: FormData) => Promise<ActionResult | void>;
  askPhone?: boolean;
  submitLabel?: string;
  /** Valores sugeridos para as variáveis, na ordem (ex.: o nome do contato em {{1}}). */
  defaults?: string[];
  /** Chamado depois de um envio que deu certo (ex.: fechar o modal). */
  onSent?: () => void;
}) {
  const [name, setName] = useState(templates[0]?.name ?? "");
  const [values, setValues] = useState<string[]>(defaults);
  const t = templates.find((x) => x.name === name);

  if (!templates.length) {
    return <p className="text-sm text-muted">Nenhum modelo aprovado ainda. Crie um na aba WhatsApp do chatbot; a Meta costuma aprovar em minutos.</p>;
  }

  const set = (i: number, v: string) => setValues((prev) => Object.assign([...prev], { [i]: v }));

  return (
    <ActionForm action={action} onSuccess={onSent} className="flex flex-col gap-3">
      {askPhone && (
        <div>
          <label htmlFor="tpl-to" className="label">WhatsApp do contato (com DDD)</label>
          <input id="tpl-to" name="to" required inputMode="tel" className="input" placeholder="21 99999-9999" />
        </div>
      )}
      <div>
        <label htmlFor="tpl-name" className="label">Modelo</label>
        <select id="tpl-name" name="template" value={name} onChange={(e) => setName(e.target.value)} className="input">
          {templates.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
        </select>
      </div>
      {t && t.vars > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: t.vars }, (_, i) => (
            <div key={`${t.name}-${i}`}>
              <label htmlFor={`param_${i + 1}`} className="label">{`{{${i + 1}}}`}</label>
              <input id={`param_${i + 1}`} name={`param_${i + 1}`} required value={values[i] ?? ""} onChange={(e) => set(i, e.target.value)} className="input" />
            </div>
          ))}
        </div>
      )}
      {t && (
        <div className="rounded-xl bg-[#e7f7dc] px-3.5 py-2.5 text-sm text-ink">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Prévia</div>
          <p className="whitespace-pre-line">{renderTemplate(t.body, values)}</p>
        </div>
      )}
      <SubmitButton pendingLabel="Enviando…" className="btn-primary self-start">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
