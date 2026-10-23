"use client";

import { useMemo, useState } from "react";
import { Plus, Sparkles, X } from "lucide-react";
import { nationalHolidays } from "@/lib/holidays-br";

const DATE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/;

/**
 * Os feriados do cliente numa lista (23/10/2026, redesenho: no lugar de um campo de texto com uma
 * data por linha). Cada um numa etiqueta com o X; o campo aceita 25/12 (todo ano) ou 20/11/2026
 * (só nesse dia). Vão juntos no campo `holidays`, uma data por linha, como antes. Embaixo, a
 * sugestão dos feriados nacionais que ainda não estão na lista (rodada 2 das telas): é só tocar.
 */
export function HolidaysField({ initial }: { initial: string[] }) {
  const [list, setList] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const national = useMemo(() => nationalHolidays(new Date()), []);
  const missing = national.filter((h) => !list.includes(h.date));
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    const m = DATE.exec(v);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 31 || Number(m[2]) < 1 || Number(m[2]) > 12) {
      setError("Use dia/mês (25/12, todo ano) ou dia/mês/ano (20/11/2026).");
      return;
    }
    const norm = `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}${m[3] ? `/${m[3]}` : ""}`;
    if (!list.includes(norm)) setList([...list, norm]);
    setDraft("");
    setError(null);
  };
  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="holidays" value={list.join("\n")} />
      {list.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {list.map((h) => (
            <li key={h} className="inline-flex items-center gap-1 rounded-full bg-raised py-1 pl-3 pr-1 font-mono text-[12.5px] text-ink">
              {h}
              <span className="font-sans text-[11px] text-muted">{h.length === 5 ? "todo ano" : "só neste ano"}</span>
              <button type="button" onClick={() => setList(list.filter((x) => x !== h))} aria-label={`Tirar ${h}`} className="rounded-full p-0.5 text-muted hover:bg-panel hover:text-ink">
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nenhum feriado.</p>
      )}
      <div className="flex items-center gap-2">
        <label htmlFor="holiday-new" className="sr-only">
          Novo feriado
        </label>
        <input
          id="holiday-new"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="25/12 ou 20/11/2026"
          inputMode="numeric"
          className="input w-[200px] font-mono"
        />
        <button type="button" onClick={add} className="btn-ghost">
          <Plus size={15} />
          Adicionar
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {missing.length > 0 && (
        <div className="flex flex-col gap-2 rounded-[12px] bg-raised/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <Sparkles size={14} className="text-brand" aria-hidden />
              Sugestão: feriados nacionais
            </span>
            <button type="button" onClick={() => setList([...list, ...missing.map((h) => h.date)])} className="text-[12.5px] font-medium text-brand hover:underline">
              Adicionar todos
            </button>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {missing.map((h) => (
              <li key={h.date}>
                <button type="button" onClick={() => setList([...list, h.date])} title={`Adicionar ${h.name}`} className="inline-flex items-center gap-1 rounded-full border border-dashed border-line bg-panel py-1 pl-2 pr-3 text-[12.5px] text-ink-2 hover:border-brand hover:text-ink">
                  <Plus size={12} aria-hidden />
                  {h.name}
                  <span className="font-mono text-[11.5px] text-muted">{h.date}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-muted">Os feriados do estado e da cidade do cliente você adiciona no campo acima.</p>
        </div>
      )}
    </div>
  );
}
