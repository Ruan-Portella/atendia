"use client";

import { useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { parseSheet, sheetToText } from "@/lib/csv-source";

const SHOWN = 300;

/**
 * Ver e editar a planilha de uma fonte (24/10/2026): as colunas e as linhas do que o assistente lê,
 * com busca, edição das células, tirar e acrescentar linha. Salvar reprocessa a fonte (cada linha
 * vira um trecho da base).
 */
type SheetSource = { id: string; title: string; content: string | null };

export function SourceSheetModal({ botId, source, onClose, onSaved }: { botId: string; source: SheetSource | null; onClose: () => void; onSaved: () => void }) {
  // cada planilha monta o editor do zero (a key), já com as linhas dela
  return source ? <SheetEditor key={source.id} botId={botId} source={source} onClose={onClose} onSaved={onSaved} /> : null;
}

function SheetEditor({ botId, source, onClose, onSaved }: { botId: string; source: SheetSource; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [initial] = useState(() => parseSheet(source.content ?? ""));
  const cols = initial.cols;
  const [rows, setRows] = useState<string[][]>(initial.rows);
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // as linhas que aparecem, com o índice de verdade (a busca filtra sem perder a posição)
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = rows.map((r, i) => ({ r, i }));
    return q ? all.filter(({ r }) => r.some((v) => v.toLowerCase().includes(q))) : all;
  }, [rows, query]);

  const setCell = (i: number, c: number, v: string) => {
    setRows((rs) => rs.map((r, j) => (j === i ? r.map((x, k) => (k === c ? v : x)) : r)));
    setDirty(true);
  };

  async function save() {
    const content = sheetToText(cols, rows);
    if (content.trim().length < 20) {
      toast.error("A planilha ficou vazia. Deixe pelo menos uma linha preenchida.");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("content", content);
      const res = await fetch(`/api/bots/${botId}/sources?sourceId=${source.id}`, { method: "PUT", body: fd });
      const j = (await res.json().catch(() => ({}))) as { message?: string; chunks?: number };
      if (!res.ok) toast.error(j.message ?? "Não foi possível salvar. Tente de novo.");
      else {
        toast.success(`Planilha salva: ${j.chunks ?? rows.length} linhas na base.`);
        onSaved();
      }
    } catch {
      toast.error("Sem resposta do servidor. Tente de novo.");
    }
    setSaving(false);
  }

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      title={source.title}
      description="Cada linha é um item que o assistente consulta (produto, preço, convênio…). Ele responde só com o que está aqui."
      size="xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setRows((rs) => [cols.map(() => ""), ...rs]);
              setQuery("");
              setDirty(true);
            }}
            disabled={!cols.length || saving}
            className="btn-ghost"
          >
            <Plus size={15} />Linha
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="btn-ghost">Cancelar</button>
            <button type="button" onClick={save} disabled={!dirty || saving} className="btn-primary">{saving ? "Salvando…" : "Salvar"}</button>
          </div>
        </div>
      }
    >
      {cols.length === 0 ? (
        <p className="text-sm text-muted">Esta planilha está vazia. Envie uma planilha nova pelo menu da fonte.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="relative min-w-0 flex-1 sm:max-w-[320px]">
              <span className="sr-only">Buscar na planilha</span>
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar (ex.: loki)" className="input pl-9" />
            </label>
            <span className="text-xs text-muted">{query.trim() ? `${visible.length} de ${rows.length} linhas` : `${rows.length} linhas · ${cols.length} colunas`}</span>
          </div>
          <div className="max-h-[56vh] overflow-auto rounded-[12px] border border-line">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead className="sticky top-0 z-10 bg-raised">
                <tr>
                  {cols.map((c) => (
                    <th key={c} className="whitespace-nowrap border-b border-line px-2 py-2 text-left text-xs font-semibold text-ink-2">{c}</th>
                  ))}
                  <th className="w-10 border-b border-line" aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, SHOWN).map(({ r, i }) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    {r.map((v, c) => (
                      <td key={c} className="p-1">
                        <input
                          value={v}
                          onChange={(e) => setCell(i, c, e.target.value)}
                          aria-label={`${cols[c]}, linha ${i + 1}`}
                          className="w-full min-w-[90px] rounded-md border border-transparent bg-transparent px-1.5 py-1 hover:border-line focus:border-brand focus:bg-panel focus:outline-none"
                        />
                      </td>
                    ))}
                    <td className="p-1 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setRows((rs) => rs.filter((_, j) => j !== i));
                          setDirty(true);
                        }}
                        aria-label={`Tirar a linha ${i + 1}`}
                        className="rounded-md p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visible.length > SHOWN && <p className="text-xs text-muted">Mostrando {SHOWN} de {visible.length} linhas. Use a busca para achar as outras.</p>}
        </div>
      )}
    </Modal>
  );
}
