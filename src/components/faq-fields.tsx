"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Rows3, Trash2, Type } from "lucide-react";
import { faqText, parseFaq } from "@/lib/faq-text";

type Row = { key: number; q: string; a: string };
let seq = 0;

/**
 * Perguntas e respostas em linhas (redesenho, etapa 5): no lugar de escrever "P: … / R: …", uma
 * pergunta e a resposta por linha. Vai no campo content com o mesmo formato de sempre; o texto
 * fora desse formato abre em "Editar como texto".
 */
export function FaqFields({ id, defaultValue = "" }: { id: string; defaultValue?: string }) {
  const [start] = useState(() => parseFaq(defaultValue));
  const [mode, setMode] = useState<"rows" | "text">(start ? "rows" : "text");
  const [rows, setRows] = useState<Row[]>(() => (start?.length ? start : [{ q: "", a: "" }]).map((r) => ({ key: seq++, ...r })));
  const [text, setText] = useState(defaultValue);
  const [problem, setProblem] = useState<string | null>(start ? null : defaultValue.trim() ? "Este texto não está no formato de perguntas e respostas: dá para editar como texto." : null);

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const filled = rows.filter((r) => r.q.trim() || r.a.trim()).length;

  const toText = () => {
    setText(faqText(rows));
    setProblem(null);
    setMode("text");
  };
  const toRows = () => {
    const back = parseFaq(text);
    if (!back) return setProblem("Para voltar às linhas, cada parágrafo precisa começar por \"P:\" e ter a resposta em \"R:\".");
    setRows((back.length ? back : [{ q: "", a: "" }]).map((r) => ({ key: seq++, ...r })));
    setProblem(null);
    setMode("rows");
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label mb-0">{mode === "rows" ? `Perguntas e respostas (${filled})` : "Perguntas e respostas (texto)"}</span>
        <button type="button" onClick={mode === "rows" ? toText : toRows} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline">
          {mode === "rows" ? <Type size={13} /> : <Rows3 size={13} />}
          {mode === "rows" ? "Editar como texto" : "Voltar às linhas"}
        </button>
      </div>
      {problem && <p className="text-xs text-amber-ink">{problem}</p>}
      {mode === "text" ? (
        <textarea id={id} name="content" required rows={12} value={text} onChange={(e) => setText(e.target.value)} className="input font-mono text-[13px]" placeholder={"P: Aceitam Unimed?\nR: Sim, para consultas e limpeza."} />
      ) : (
        <>
          <input type="hidden" name="content" value={faqText(rows)} />
          <ol className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <li key={r.key} className="flex flex-col gap-2 rounded-[14px] border border-line p-3">
                <div className="flex items-center gap-2">
                  <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-ink-2">{i + 1}</span>
                  <input
                    id={i === 0 ? id : undefined}
                    aria-label={`Pergunta ${i + 1}`}
                    value={r.q}
                    onChange={(e) => patch(r.key, { q: e.target.value })}
                    className="input flex-1 font-medium"
                    placeholder={i === 0 ? "Aceitam Unimed?" : "A pergunta, como o cliente faria"}
                  />
                  <div className="flex shrink-0 items-center">
                    <button type="button" className="btn-icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir a pergunta ${i + 1}`}>
                      <ArrowUp size={15} />
                    </button>
                    <button type="button" className="btn-icon" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Descer a pergunta ${i + 1}`}>
                      <ArrowDown size={15} />
                    </button>
                    <button type="button" className="btn-icon hover:text-danger" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ key: seq++, q: "", a: "" }]))} aria-label={`Apagar a pergunta ${i + 1}`}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <textarea aria-label={`Resposta ${i + 1}`} rows={2} value={r.a} onChange={(e) => patch(r.key, { a: e.target.value })} className="input ml-8 w-auto" placeholder={i === 0 ? "Sim, para consultas e limpeza." : "A resposta certa"} />
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => setRows((rs) => [...rs, { key: seq++, q: "", a: "" }])} className="inline-flex items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-line-strong px-3 py-2 text-sm font-medium text-ink-2 transition-colors duration-[120ms] hover:border-brand hover:text-brand">
            <Plus size={15} /> Pergunta
          </button>
        </>
      )}
    </div>
  );
}
