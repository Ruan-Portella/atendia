"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

/**
 * As etiquetas do contato em etiquetas de verdade (23/10/2026, redesenho: no lugar de um campo de
 * texto separado por vírgula). Enter ou vírgula adiciona; o X tira. Vão no campo `name`, separadas
 * por vírgula, como antes.
 */
export function TagsField({ name, initial, max = 30, placeholder = "cliente vip, pizza, zona sul…", empty = "Sem etiquetas.", idPrefix }: { name: string; initial: string[]; max?: number; placeholder?: string; empty?: string; /** o id do campo (padrão: `name`) */ idPrefix?: string }) {
  const fieldId = `${idPrefix ?? name}-new`;
  const [tags, setTags] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    setTags((cur) => [...cur, ...parts.filter((p) => !cur.includes(p))].slice(0, max));
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={name} value={tags.join(", ")} />
      {tags.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-full bg-raised py-1 pl-3 pr-1 text-[13px] text-ink">
              {t}
              <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Tirar ${t}`} className="rounded-full p-0.5 text-muted hover:bg-panel hover:text-ink">
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
      <div className="flex items-center gap-2">
        <label htmlFor={fieldId} className="sr-only">
          Nova etiqueta
        </label>
        <input
          id={fieldId}
          value={draft}
          onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
          maxLength={60}
          placeholder={placeholder}
          className="input min-w-0 flex-1"
        />
        <button type="button" onClick={() => add(draft)} className="btn-ghost shrink-0">
          <Plus size={15} />
          Adicionar
        </button>
      </div>
    </div>
  );
}
