"use client";

import { useState } from "react";

/** Texto editável com variáveis ({nome}, {volta}…) e prévia de como sai para o contato. */
export function TemplateField({
  id,
  label,
  hint,
  defaultValue,
  fallback,
  vars,
  maxLength,
}: {
  id: string;
  label: string;
  hint: string;
  defaultValue: string;
  /** O padrão, usado na prévia quando o campo fica vazio. */
  fallback: string;
  vars: Record<string, string>;
  maxLength: number;
}) {
  const [value, setValue] = useState(defaultValue);
  const preview = Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v), value.trim() || fallback);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label">{label}</label>
      <textarea id={id} name={id} value={value} onChange={(e) => setValue(e.target.value)} maxLength={maxLength} rows={2} className="input resize-y" />
      <p className="text-xs text-muted">{hint}</p>
      <div className="rounded-lg bg-ground px-3 py-2 text-sm">
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Prévia </span>
        {preview}
      </div>
    </div>
  );
}
