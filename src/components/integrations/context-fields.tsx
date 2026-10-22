"use client";

import { useState } from "react";
import { Braces, Plus, Rows3, Trash2 } from "lucide-react";

/*
 * Pares de nome e valor no lugar do JSON (redesenho, etapa 5, a pedido do usuário em 22/10): o
 * contexto fixo e os dados da loja do chatbot. Vai para o servidor como o JSON de sempre (o campo
 * `name`); quem prefere ainda edita o JSON direto. As regras de verdade são as do servidor
 * (lib/bot-context: até 10 pares, valores texto, número ou sim/não).
 */

type Kind = "texto" | "numero" | "sim";
type Row = { key: number; name: string; kind: Kind; value: string };
const MAX = 10;
let seq = 0;

/** O nome do par como o servidor aceita: letras sem acento, números, "_", "." e "-". */
const cleanKey = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_.-]/g, "")
    .slice(0, 64);

function rowsOf(v: unknown): Row[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).map(([name, x]) => ({ key: seq++, name, kind: typeof x === "number" ? "numero" : typeof x === "boolean" ? "sim" : "texto", value: typeof x === "boolean" ? (x ? "sim" : "nao") : String(x) }));
}

function jsonOf(rows: Row[]): string {
  const out: Record<string, string | number | boolean> = {};
  for (const r of rows) {
    const k = r.name.trim();
    if (!k) continue;
    // número vazio vai como texto vazio: o servidor recusa com a mensagem do campo
    out[k] = r.kind === "numero" ? (r.value.trim() ? Number(r.value.replace(",", ".")) : "") : r.kind === "sim" ? r.value === "sim" : r.value;
  }
  return Object.keys(out).length ? JSON.stringify(out) : "";
}

/**
 * Os pares de um objeto plano. `typed`: escolhe o tipo de cada valor (no contexto, o tipo conta para
 * as etiquetas das fontes); sem, tudo é texto. `suggestions`: atalhos que já criam o par.
 */
export function KeyValueField({
  name,
  initial,
  typed = false,
  suggestions = [],
  keyLabel,
  keyPlaceholder,
  valuePlaceholder,
  empty,
}: {
  name: string;
  initial: unknown;
  typed?: boolean;
  suggestions?: Array<{ key: string; label: string }>;
  keyLabel: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  empty: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => rowsOf(initial));
  const [mode, setMode] = useState<"rows" | "json">("rows");
  const [json, setJson] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const add = (keyName = "") => setRows((rs) => (rs.length >= MAX ? rs : [...rs, { key: seq++, name: keyName, kind: "texto", value: "" }]));
  const unused = suggestions.filter((s) => !rows.some((r) => r.name === s.key));

  const toJson = () => {
    const v = jsonOf(rows);
    setJson(v ? JSON.stringify(JSON.parse(v), null, 2) : "");
    setProblem(null);
    setMode("json");
  };
  const toRows = () => {
    try {
      const v = json.trim() ? (JSON.parse(json) as unknown) : null;
      if (v !== null && (typeof v !== "object" || Array.isArray(v) || Object.values(v as object).some((x) => typeof x === "object"))) {
        return setProblem("As linhas só mostram pares simples (texto, número ou sim/não): continue no JSON.");
      }
      setRows(rowsOf(v));
      setProblem(null);
      setMode("rows");
    } catch {
      setProblem("O JSON não é válido: corrija para voltar às linhas.");
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      {mode === "rows" && <input type="hidden" name={name} value={jsonOf(rows)} />}
      <div className="flex justify-end">
        <button type="button" onClick={mode === "rows" ? toJson : toRows} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline">
          {mode === "rows" ? <Braces size={13} /> : <Rows3 size={13} />}
          {mode === "rows" ? "Editar como JSON" : "Voltar às linhas"}
        </button>
      </div>
      {problem && <p className="text-xs text-danger">{problem}</p>}
      {mode === "json" ? (
        <textarea name={name} aria-label={`${keyLabel} em JSON`} rows={6} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} className="input font-mono text-xs" />
      ) : (
        <>
          {rows.length === 0 && <p className="rounded-[12px] border border-dashed border-line-strong px-3 py-3 text-center text-xs text-muted">{empty}</p>}
          {rows.map((r) => (
            <div key={r.key} className={typed ? "grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_auto_1.3fr_auto] sm:items-center" : "grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1.6fr_auto] sm:items-center"}>
              <input aria-label={keyLabel} value={r.name} onChange={(e) => patch(r.key, { name: cleanKey(e.target.value) })} className="input font-mono text-sm" placeholder={keyPlaceholder} />
              <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Apagar ${r.name || "o par"}`} className="btn-icon hover:text-danger sm:order-last">
                <Trash2 size={15} />
              </button>
              {typed && (
                <select aria-label={`Tipo de ${r.name || "valor"}`} value={r.kind} onChange={(e) => patch(r.key, { kind: e.target.value as Kind, value: e.target.value === "sim" ? "sim" : r.kind === "sim" ? "" : r.value })} className="input col-span-2 w-auto sm:col-span-1">
                  <option value="texto">Texto</option>
                  <option value="numero">Número</option>
                  <option value="sim">Sim ou não</option>
                </select>
              )}
              {r.kind === "sim" ? (
                <select aria-label={`Valor de ${r.name || "par"}`} value={r.value} onChange={(e) => patch(r.key, { value: e.target.value })} className="input col-span-2 sm:col-span-1">
                  <option value="sim">Sim</option>
                  <option value="nao">Não</option>
                </select>
              ) : (
                <input aria-label={`Valor de ${r.name || "par"}`} type={r.kind === "numero" ? "number" : "text"} step="any" maxLength={200} value={r.value} onChange={(e) => patch(r.key, { value: e.target.value })} className="input col-span-2 sm:col-span-1" placeholder={valuePlaceholder} />
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-1.5">
            {rows.length < MAX && (
              <button type="button" onClick={() => add()} className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-3 py-1 text-xs font-semibold text-ink-2 hover:border-brand hover:text-brand">
                <Plus size={13} /> Outro
              </button>
            )}
            {rows.length < MAX &&
              unused.map((s) => (
                <button key={s.key} type="button" onClick={() => add(s.key)} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-2 hover:border-brand hover:text-brand">
                  <Plus size={12} /> {s.label}
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
